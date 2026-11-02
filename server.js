'use strict';
/**
 * Parkline — Smart Parking backend
 * Zero npm dependencies: Node >= 22 (node:http + node:sqlite).
 *
 *   npm start        → http://localhost:3000
 *   npm run reset    → wipe + reseed the demo database, then start
 *
 * The SQL model lives in database/schema.sql (MySQL 8, submission copy)
 * and database/schema.sqlite.sql (portable copy used by this server).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'smartpark.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
const fresh = process.env.RESET_DB === '1' || !fs.existsSync(DB_FILE);
if (fresh && fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON;');
if (fresh) {
  db.exec(fs.readFileSync(path.join(__dirname, 'database', 'schema.sqlite.sql'), 'utf8'));
  console.log('[db] created + seeded', DB_FILE);
}

/* ------------------------------- helpers ------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers
  });
  res.end(body);
}
const ok = (res, data = {}) => send(res, 200, { ok: true, ...data });
const fail = (res, status, error) => send(res, status, { ok: false, error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Accepts ISO / "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" and stores UTC "YYYY-MM-DD HH:MM:SS". */
function toSqlDate(value, label = 'date') {
  if (!value) throw new Error(`${label} is required`);
  const iso = String(value).trim().replace(' ', 'T');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${label}`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const toIso = sql => (sql ? sql.replace(' ', 'T') + 'Z' : null);

/** Half-hour billing, same formula the UI previews. */
function billableHours(startSql, endSql) {
  const minutes = (new Date(endSql.replace(' ', 'T') + 'Z') - new Date(startSql.replace(' ', 'T') + 'Z')) / 60000;
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 30) / 2;
}
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Overlapping reservations are rejected using the half-open interval rule: s1 < e2 AND e1 > s2.
const OVERLAP_SQL = `
  SELECT r.id, r.reference_code FROM reservations r
  WHERE r.slot_id = ? AND r.status IN ('PENDING','CONFIRMED')
    AND r.start_time < ? AND r.end_time > ?`;

function reservationView(row) {
  return {
    id: row.id,
    reference_code: row.reference_code,
    user_id: row.user_id,
    user_name: row.user_name,
    vehicle_id: row.vehicle_id,
    registration_number: row.registration_number,
    slot_id: row.slot_id,
    slot_number: row.slot_number,
    slot_type: row.slot_type,
    floor_number: row.floor_number,
    lot_id: row.lot_id,
    lot_name: row.lot_name,
    start_time: toIso(row.start_time),
    end_time: toIso(row.end_time),
    status: row.status,
    estimated_total: row.estimated_total,
    actual_entry: toIso(row.actual_entry),
    actual_exit: toIso(row.actual_exit),
    final_total: row.final_total,
    overstay_penalty: row.overstay_penalty,
    duration_minutes: row.duration_minutes,
    created_at: toIso(row.created_at)
  };
}

const RESERVATION_SELECT = `
  SELECT r.*, u.name AS user_name, v.registration_number, s.slot_number, s.slot_type,
         s.floor_number, s.hourly_rate, l.name AS lot_name, ps.actual_entry, ps.actual_exit,
         ps.duration_minutes, ps.overstay_penalty, ps.final_total
  FROM reservations r
  JOIN users u ON u.id = r.user_id
  JOIN parking_slots s ON s.id = r.slot_id
  JOIN parking_lots l ON l.id = r.lot_id
  LEFT JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN parking_sessions ps ON ps.reservation_id = r.id`;

/* --------------------------------- API --------------------------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/health$/, (req, res) => {
  ok(res, { service: 'parkline-smart-parking', time: toIso(nowSql()) });
});

/* ---- auth ---- */
route('POST', /^\/api\/auth\/login$/, async (req, res) => {
  const { email, password } = await readBody(req);
  if (!email || !password) return fail(res, 400, 'Email and password are required');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
  if (!user || user.password !== password) return fail(res, 401, 'Invalid email or password');
  ok(res, {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    vehicles: db.prepare('SELECT id, registration_number, vehicle_type, model FROM vehicles WHERE user_id = ?').all(user.id)
  });
});

route('POST', /^\/api\/auth\/register$/, async (req, res) => {
  const { name, email, phone, password } = await readBody(req);
  if (!name || !email || !phone || !password) return fail(res, 400, 'Name, email, phone and password are required');
  if (String(password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return fail(res, 400, 'Enter a valid email address');
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(email).trim()))
    return fail(res, 409, 'That email is already registered');
  const info = db.prepare(
    `INSERT INTO users (name, email, phone, password, role) VALUES (?,?,?,?, 'CUSTOMER')`
  ).run(String(name).trim(), String(email).trim().toLowerCase(), String(phone).trim(), String(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  ok(res, {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    vehicles: []
  });
});

route('GET', /^\/api\/users\/(\d+)$/, (req, res, m) => {
  const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(Number(m[1]));
  if (!user) return fail(res, 404, 'User not found');
  ok(res, { user });
});

/* ---- vehicles ---- */
route('GET', /^\/api\/vehicles$/, (req, res, _m, url) => {
  const userId = Number(url.searchParams.get('user_id'));
  if (!userId) return fail(res, 400, 'user_id is required');
  ok(res, { vehicles: db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY id').all(userId) });
});

route('POST', /^\/api\/vehicles$/, async (req, res) => {
  const { user_id, registration_number, vehicle_type, model } = await readBody(req);
  if (!user_id || !registration_number || !vehicle_type || !model)
    return fail(res, 400, 'user_id, registration_number, vehicle_type and model are required');
  if (!['CAR', 'EV', 'BIKE'].includes(vehicle_type)) return fail(res, 400, 'vehicle_type must be CAR, EV or BIKE');
  if (db.prepare('SELECT id FROM vehicles WHERE upper(registration_number) = upper(?)').get(String(registration_number).trim()))
    return fail(res, 409, 'That registration number is already registered');
  const info = db.prepare(
    'INSERT INTO vehicles (user_id, registration_number, vehicle_type, model) VALUES (?,?,?,?)'
  ).run(Number(user_id), String(registration_number).toUpperCase().trim(), vehicle_type, String(model).trim());
  ok(res, { vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid) });
});

/* ---- lots + slots ---- */
function availabilityFor(lotId, startSql, endSql) {
  const slots = db.prepare(`
    SELECT * FROM parking_slots WHERE lot_id = ? ORDER BY floor_number, slot_number`).all(lotId);
  return slots.map(s => {
    let booked = null;
    if (startSql && endSql) {
      booked = db.prepare(OVERLAP_SQL).get(s.id, endSql, startSql);
    }
    const available = s.operational_status === 'ACTIVE' && !booked;
    return {
      id: s.id, lot_id: s.lot_id, slot_number: s.slot_number, floor_number: s.floor_number,
      slot_type: s.slot_type, hourly_rate: s.hourly_rate, operational_status: s.operational_status,
      available, booked_by: booked ? booked.reference_code : null
    };
  });
}

route('GET', /^\/api\/lots$/, (req, res, _m, url) => {
  let startSql = null, endSql = null;
  try {
    if (url.searchParams.get('start_time') && url.searchParams.get('end_time')) {
      startSql = toSqlDate(url.searchParams.get('start_time'), 'start_time');
      endSql = toSqlDate(url.searchParams.get('end_time'), 'end_time');
    }
  } catch (e) { return fail(res, 400, e.message); }

  const lots = db.prepare('SELECT * FROM parking_lots WHERE is_active = 1 ORDER BY id').all();
  ok(res, {
    lots: lots.map(l => {
      const slots = availabilityFor(l.id, startSql, endSql);
      return {
        ...l,
        total_slots: slots.length,
        available_slots: slots.filter(s => s.available).length,
        floors: [...new Set(slots.map(s => s.floor_number))],
        rates: {
          CAR: Math.min(...slots.filter(s => s.slot_type === 'CAR').map(s => s.hourly_rate), Infinity),
          EV: Math.min(...slots.filter(s => s.slot_type === 'EV').map(s => s.hourly_rate), Infinity),
          BIKE: Math.min(...slots.filter(s => s.slot_type === 'BIKE').map(s => s.hourly_rate), Infinity)
        }
      };
    })
  });
});

route('GET', /^\/api\/lots\/(\d+)\/slots$/, (req, res, m, url) => {
  const lotId = Number(m[1]);
  const lot = db.prepare('SELECT * FROM parking_lots WHERE id = ?').get(lotId);
  if (!lot) return fail(res, 404, 'Parking lot not found');
  let startSql = null, endSql = null;
  try {
    if (url.searchParams.get('start_time') && url.searchParams.get('end_time')) {
      startSql = toSqlDate(url.searchParams.get('start_time'), 'start_time');
      endSql = toSqlDate(url.searchParams.get('end_time'), 'end_time');
    }
  } catch (e) { return fail(res, 400, e.message); }
  const floor = url.searchParams.get('floor');
  let slots = availabilityFor(lotId, startSql, endSql);
  if (floor !== null && floor !== '') slots = slots.filter(s => s.floor_number === Number(floor));
  ok(res, { lot, slots, window: startSql ? { start_time: toIso(startSql), end_time: toIso(endSql) } : null });
});

/* ---- reservations ---- */
route('GET', /^\/api\/reservations$/, (req, res, _m, url) => {
  const userId = Number(url.searchParams.get('user_id'));
  const status = url.searchParams.get('status');
  const all = url.searchParams.get('all') === '1';
  let sql = RESERVATION_SELECT;
  const params = [];
  const where = [];
  if (userId && !all) { where.push('r.user_id = ?'); params.push(userId); }
  if (status) { where.push('r.status = ?'); params.push(status.toUpperCase()); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY r.start_time DESC, r.id DESC LIMIT 200';
  ok(res, { reservations: db.prepare(sql).all(...params).map(reservationView) });
});

route('GET', /^\/api\/reservations\/(\d+)$/, (req, res, m) => {
  const row = db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(Number(m[1]));
  if (!row) return fail(res, 404, 'Reservation not found');
  ok(res, { reservation: reservationView(row) });
});

route('POST', /^\/api\/reservations$/, async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return fail(res, 400, e.message); }
  const { user_id, vehicle_id, slot_id } = body;
  if (!user_id || !slot_id) return fail(res, 400, 'user_id and slot_id are required');

  let startSql, endSql;
  try {
    startSql = toSqlDate(body.start_time, 'start_time');
    endSql = toSqlDate(body.end_time, 'end_time');
  } catch (e) { return fail(res, 400, e.message); }

  const start = new Date(startSql.replace(' ', 'T') + 'Z');
  const end = new Date(endSql.replace(' ', 'T') + 'Z');
  if (end <= start) return fail(res, 400, 'end_time must be after start_time');
  if (end - start > 24 * 3600 * 1000) return fail(res, 400, 'A reservation can be at most 24 hours');
  if (start < new Date(Date.now() - 5 * 60 * 1000)) return fail(res, 400, 'start_time cannot be in the past');
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(Number(user_id))) return fail(res, 404, 'User not found');

  const slot = db.prepare('SELECT * FROM parking_slots WHERE id = ?').get(Number(slot_id));
  if (!slot) return fail(res, 404, 'Parking slot not found');
  if (slot.operational_status !== 'ACTIVE')
    return fail(res, 409, `Slot ${slot.slot_number} is ${slot.operational_status.toLowerCase()} and cannot be booked`);

  if (vehicle_id && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?').get(Number(vehicle_id), Number(user_id)))
    return fail(res, 400, 'That vehicle does not belong to this user');

  const clash = db.prepare(OVERLAP_SQL).get(slot.id, endSql, startSql);
  if (clash) return fail(res, 409, `Slot ${slot.slot_number} is already booked for that time (${clash.reference_code})`);

  const hours = billableHours(startSql, endSql);
  const total = money(hours * slot.hourly_rate);

  const dbRun = db.prepare(`INSERT INTO reservations
      (reference_code, user_id, vehicle_id, slot_id, lot_id, start_time, end_time, status, estimated_total)
      VALUES (?,?,?,?,?,?,?, 'CONFIRMED', ?)`);
  let reference, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    reference = 'SP-2026-' + String(Math.floor(1000 + Math.random() * 9000));
    try {
      info = dbRun.run(reference, Number(user_id), vehicle_id ? Number(vehicle_id) : null,
        slot.id, slot.lot_id, startSql, endSql, total);
      break;
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
  if (!info) return fail(res, 500, 'Could not allocate a booking reference');

  db.prepare('INSERT INTO parking_sessions (reservation_id) VALUES (?)').run(info.lastInsertRowid);
  const row = db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(info.lastInsertRowid);
  ok(res, { reservation: reservationView(row), message: `Reserved ${slot.slot_number} · ${hours} hour(s)` });
});

route('POST', /^\/api\/reservations\/(\d+)\/cancel$/, async (req, res, m) => {
  const row = db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(Number(m[1]));
  if (!row) return fail(res, 404, 'Reservation not found');
  if (!['PENDING', 'CONFIRMED'].includes(row.status)) return fail(res, 409, `Cannot cancel a ${row.status.toLowerCase()} reservation`);
  if (row.actual_entry) return fail(res, 409, 'This parking session has already started');
  db.prepare(`UPDATE reservations SET status = 'CANCELLED' WHERE id = ?`).run(row.id);
  ok(res, { reservation: reservationView(db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(row.id)) });
});

/* ---- sessions (gate entry / exit) ---- */
route('POST', /^\/api\/reservations\/(\d+)\/checkin$/, async (req, res, m) => {
  const row = db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(Number(m[1]));
  if (!row) return fail(res, 404, 'Reservation not found');
  if (row.status !== 'CONFIRMED') return fail(res, 409, `Only CONFIRMED reservations can check in (this one is ${row.status})`);
  if (row.actual_entry) return fail(res, 409, 'Vehicle has already checked in');
  const entry = nowSql();
  db.prepare('INSERT INTO parking_sessions (reservation_id) VALUES (?) ON CONFLICT(reservation_id) DO NOTHING').run(row.id);
  db.prepare('UPDATE parking_sessions SET actual_entry = ? WHERE reservation_id = ?').run(entry, row.id);
  ok(res, { reservation: reservationView(db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(row.id)) });
});

route('POST', /^\/api\/reservations\/(\d+)\/checkout$/, async (req, res, m) => {
  const row = db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(Number(m[1]));
  if (!row) return fail(res, 404, 'Reservation not found');
  if (!row.actual_entry) return fail(res, 409, 'Vehicle has not checked in yet');
  if (row.actual_exit) return fail(res, 409, 'Vehicle has already checked out');

  const exit = nowSql();
  const minutes = Math.max(1, Math.round((new Date(exit.replace(' ', 'T') + 'Z') - new Date(row.actual_entry.replace(' ', 'T') + 'Z')) / 60000));
  const overstayMinutes = Math.max(0, Math.round((new Date(exit.replace(' ', 'T') + 'Z') - new Date(row.end_time.replace(' ', 'T') + 'Z')) / 60000));
  const penalty = money((Math.ceil(overstayMinutes / 30) / 2) * row.hourly_rate * 1.5);
  const finalTotal = money(row.estimated_total + penalty);

  db.prepare(`UPDATE parking_sessions SET actual_exit = ?, duration_minutes = ?, overstay_penalty = ?, final_total = ?
              WHERE reservation_id = ?`).run(exit, minutes, penalty, finalTotal, row.id);
  db.prepare(`UPDATE reservations SET status = 'COMPLETED' WHERE id = ?`).run(row.id);
  ok(res, {
    reservation: reservationView(db.prepare(RESERVATION_SELECT + ' WHERE r.id = ?').get(row.id)),
    invoice: { minutes, overstay_minutes: overstayMinutes, overstay_penalty: penalty, final_total: finalTotal }
  });
});

/* ---- admin ---- */
route('GET', /^\/api\/admin\/summary$/, (req, res) => {
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status').all()
    .reduce((acc, r) => (acc[r.status] = r.n, acc), {});
  const revenue = db.prepare(`SELECT COALESCE(SUM(final_total),0) AS revenue, COALESCE(SUM(overstay_penalty),0) AS penalties
                               FROM parking_sessions`).get();
  const slotsTotal = count('SELECT COUNT(*) AS n FROM parking_slots');
  const slotsOperational = count(`SELECT COUNT(*) AS n FROM parking_slots WHERE operational_status = 'ACTIVE'`);
  const occupied = count(`SELECT COUNT(*) AS n FROM parking_sessions WHERE actual_entry IS NOT NULL AND actual_exit IS NULL`);
  ok(res, {
    totals: {
      users: count('SELECT COUNT(*) AS n FROM users'),
      vehicles: count('SELECT COUNT(*) AS n FROM vehicles'),
      lots: count('SELECT COUNT(*) AS n FROM parking_lots'),
      slots: slotsTotal,
      slots_operational: slotsOperational,
      active_sessions: occupied,
      reservations: count('SELECT COUNT(*) AS n FROM reservations'),
      revenue: money(revenue.revenue),
      penalties: money(revenue.penalties)
    },
    reservations_by_status: byStatus,
    occupancy_percent: slotsOperational ? money((occupied / slotsOperational) * 100) : 0,
    revenue_by_lot: db.prepare('SELECT * FROM v_revenue_by_lot ORDER BY revenue DESC').all(),
    live_slots: db.prepare(`SELECT slot_id, lot_name, slot_number, floor_number, slot_type, live_status
                             FROM v_slot_availability ORDER BY lot_id, floor_number, slot_number`).all()
  });
});

route('GET', /^\/api\/admin\/logs$/, (req, res) => {
  ok(res, {
    logs: db.prepare(`SELECT g.*, s.slot_number, l.name AS lot_name
                      FROM slot_status_logs g
                      JOIN parking_slots s ON s.id = g.slot_id
                      JOIN parking_lots l ON l.id = s.lot_id
                      ORDER BY g.changed_at DESC, g.id DESC LIMIT 100`).all()
  });
});

route('GET', /^\/api\/admin\/sessions$/, (req, res) => {
  ok(res, {
    sessions: db.prepare(`SELECT ps.*, r.reference_code, r.status, r.estimated_total, s.slot_number,
                                 l.name AS lot_name, u.name AS user_name
                          FROM parking_sessions ps
                          JOIN reservations r ON r.id = ps.reservation_id
                          JOIN parking_slots s ON s.id = r.slot_id
                          JOIN parking_lots l ON l.id = r.lot_id
                          JOIN users u ON u.id = r.user_id
                          ORDER BY ps.id DESC LIMIT 100`).all()
  });
});

route('PATCH', /^\/api\/slots\/(\d+)\/status$/, async (req, res, m) => {
  const slot = db.prepare('SELECT * FROM parking_slots WHERE id = ?').get(Number(m[1]));
  if (!slot) return fail(res, 404, 'Parking slot not found');
  const { status, reason, actor } = await readBody(req);
  const next = String(status || '').toUpperCase();
  if (!['ACTIVE', 'MAINTENANCE', 'INACTIVE'].includes(next))
    return fail(res, 400, 'status must be ACTIVE, MAINTENANCE or INACTIVE');
  if (next === slot.operational_status) return fail(res, 409, `Slot is already ${next.toLowerCase()}`);
  if (next !== 'ACTIVE') {
    const active = db.prepare(`SELECT r.reference_code FROM reservations r
        JOIN parking_sessions ps ON ps.reservation_id = r.id
        WHERE r.slot_id = ? AND r.status = 'CONFIRMED' AND ps.actual_entry IS NOT NULL AND ps.actual_exit IS NULL`).get(slot.id);
    if (active) return fail(res, 409, `Slot is currently occupied (${active.reference_code}); check the vehicle out first`);
  }
  db.prepare('UPDATE parking_slots SET operational_status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, slot.id);
  db.prepare('INSERT INTO slot_status_logs (slot_id, old_status, new_status, changed_by, reason) VALUES (?,?,?,?,?)')
    .run(slot.id, slot.operational_status, next, String(actor || 'Admin').slice(0, 100), reason ? String(reason).slice(0, 255) : null);
  ok(res, {
    slot: db.prepare('SELECT * FROM parking_slots WHERE id = ?').get(slot.id),
    log: db.prepare('SELECT * FROM slot_status_logs WHERE slot_id = ? ORDER BY id DESC LIMIT 1').get(slot.id)
  });
});

/* ------------------------------ static files ------------------------------ */
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback for unknown non-API routes
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return fail(res, 404, 'Not found');
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
      }
      return fail(res, 404, 'Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* -------------------------------- server -------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (!pathname.startsWith('/api')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = pathname.match(r.pattern);
    if (!match) continue;
    try {
      return await r.handler(req, res, match, url);
    } catch (err) {
      console.error('[api]', pathname, err);
      return fail(res, 500, err.message || 'Internal server error');
    }
  }
  fail(res, 404, `No API route for ${req.method} ${pathname}`);
});

server.listen(PORT, HOST, () => {
  console.log(`Parkline running on http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_FILE}${fresh ? ' (freshly seeded)' : ''}`);
});
