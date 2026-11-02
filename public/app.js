'use strict';
/* Parkline frontend — talks to the Node API in server.js (SQLite/MySQL schema). */

const screenEl = document.getElementById('screen');
const toastEl = document.getElementById('toast');
const userArea = document.getElementById('userArea');
const postcard = document.getElementById('postcard');

const state = {
  user: null,
  screen: 'login',
  lots: [],
  lotSlots: [],
  vehicles: [],
  myReservations: [],
  resFilter: 'ALL',
  booking: { lotId: null, floor: '', date: '', from: '', to: '', type: '', slotId: null, vehicleId: null }
};
let authMode = 'login';

/* ------------------------------- utilities ------------------------------- */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let data = {};
  try { data = await res.json(); } catch { data = { ok: false, error: 'Unexpected server response' }; }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const iconCar = () => '<svg class="slot-car" viewBox="0 0 24 30" aria-hidden="true"><path d="M5 18.5 3.8 16a2 2 0 0 1-.2-.9v-3.3a2 2 0 0 1 1.2-1.8l2.1-.9 1.5-4.1A2 2 0 0 1 10.3 3h3.4a2 2 0 0 1 1.9 1.4l1.5 4.1 2.1.9a2 2 0 0 1 1.2 1.8v3.3a2 2 0 0 1-.2.9L19 18.5v4H16v-2H8v2H5z"/><path d="M6 13h12M7 16h.1M17 16h.1"/></svg>';
const loadingHTML = text => `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`;

const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const floorLabel = f => Number(f) === 0 ? 'Ground floor · G' : `Level 0${Number(f)}`;

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
const fmtDateTime = iso => iso ? `${fmtDate(iso)} · ${fmtTime(iso)}` : '—';

function defaultWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(now.getMinutes() < 30 ? 30 : 60);
  let end = new Date(start.getTime() + 2 * 3600 * 1000);
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 0, 0);
  if (end > endOfDay) end = endOfDay;
  if (end - start < 30 * 60000) end = new Date(start.getTime() + 30 * 60000);
  return { date: toDateInput(start), from: toTimeInput(start), to: toTimeInput(end) };
}

function bookingWindow() {
  const b = state.booking;
  if (!b.date || !b.from || !b.to) return null;
  const start = new Date(`${b.date}T${b.from}:00`);
  const end = new Date(`${b.date}T${b.to}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) end.setDate(end.getDate() + 1); // overnight stay
  const minutes = (end - start) / 60000;
  if (minutes <= 0 || minutes > 24 * 60) return null;
  return { start, end, minutes, hours: Math.ceil(minutes / 30) / 2 };
}

/* --------------------------------- auth --------------------------------- */
function renderTopbar() {
  if (!state.user) {
    userArea.innerHTML = '<span class="top-label">Smart parking · City access</span>';
    return;
  }
  const initials = state.user.name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('');
  userArea.innerHTML = `
    <div class="user-chip">
      <span class="avatar">${esc(initials)}</span>
      <span class="user-meta"><strong>${esc(state.user.name)}</strong><span>${esc(state.user.role)}</span></span>
    </div>
    <button class="icon-button" type="button" data-action="logout" aria-label="Log out" title="Log out">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>
    </button>`;
}

function renderLogin() {
  const isLogin = authMode === 'login';
  screenEl.innerHTML = `
    <div class="panel auth-layout">
      <div class="auth-copy">
        <div class="eyebrow">A little more room to move</div>
        <h1>Your space.<br>Your time.</h1>
        <p class="lead">Reserve a bay before you reach the gate. Parkline checks live availability from the parking database, prices your stay per bay, and keeps every booking on one page.</p>
        <div class="stat-strip">
          <div class="stat-mini"><strong>3</strong><span>City lots</span></div>
          <div class="stat-mini"><strong>48</strong><span>Parking bays</span></div>
          <div class="stat-mini"><strong>24/7</strong><span>Live status</span></div>
        </div>
        <div class="auth-note">Customer and admin demo logins are beside the form.</div>
      </div>
      <div class="auth-card">
        <div class="auth-card-head">
          <div>
            <h3>${isLogin ? 'Sign in to park' : 'Create your account'}</h3>
            <p>${isLogin ? 'Use your Parkline email and password.' : 'New customers can book bays straight away.'}</p>
          </div>
        </div>
        <form class="form-stack" id="authForm" novalidate>
          <div class="form-error" id="authError"></div>
          ${isLogin ? '' : `
            <div class="field"><label for="nameInput">Full name</label><input id="nameInput" type="text" autocomplete="name" placeholder="Aarav Mehta" required></div>
            <div class="field"><label for="phoneInput">Phone</label><input id="phoneInput" type="tel" autocomplete="tel" placeholder="+91 98200 11223" required></div>`}
          <div class="field"><label for="emailInput">Email</label><input id="emailInput" type="email" autocomplete="email" placeholder="you@example.com" value="${isLogin ? 'aarav@example.com' : ''}" required></div>
          <div class="field"><label for="passwordInput">Password</label><input id="passwordInput" type="password" autocomplete="current-password" placeholder="••••••••" value="${isLogin ? 'demo123' : ''}" required></div>
          <button class="primary-button" type="submit" style="justify-content:center;margin-top:4px">${isLogin ? 'Sign in' : 'Create account'} <span aria-hidden="true">→</span></button>
        </form>
        ${isLogin ? `
        <div class="demo-box">
          <p>Demo accounts</p>
          <div class="demo-chips">
            <button type="button" class="demo-chip" data-action="demo-login" data-email="aarav@example.com" data-password="demo123"><b>Aarav</b><span>customer · demo123</span></button>
            <button type="button" class="demo-chip" data-action="demo-login" data-email="admin@smartpark.in" data-password="admin123"><b>Priya</b><span>admin · admin123</span></button>
          </div>
        </div>` : ''}
        <div class="switch-line">
          <span>${isLogin ? 'New to Parkline?' : 'Already registered?'}</span>
          <button type="button" class="link-button" data-action="toggle-auth">${isLogin ? 'Create an account' : 'Sign in instead'}</button>
        </div>
      </div>
    </div>`;
  document.getElementById('authForm').addEventListener('submit', onAuthSubmit);
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const errorEl = document.getElementById('authError');
  errorEl.classList.remove('show');
  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  try {
    let data;
    if (authMode === 'login') {
      data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    } else {
      data = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('nameInput').value.trim(),
          phone: document.getElementById('phoneInput').value.trim(),
          email, password
        })
      });
    }
    signedIn(data.user, data.vehicles);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('show');
  }
}

function signedIn(user, vehicles = []) {
  state.user = user;
  state.vehicles = vehicles;
  state.booking = { lotId: null, floor: '', date: '', from: '', to: '', type: '', slotId: null, vehicleId: null };
  state.resFilter = 'ALL';
  sessionStorage.setItem('parkline:user', JSON.stringify(user));
  renderTopbar();
  showToast(`Welcome, ${user.name.split(' ')[0]}`);
  loadScreen('home');
}

function logout() {
  state.user = null;
  state.vehicles = [];
  state.lots = [];
  state.lotSlots = [];
  state.myReservations = [];
  sessionStorage.removeItem('parkline:user');
  renderTopbar();
  loadScreen('login');
}

/* -------------------------------- screens -------------------------------- */
const renderers = {
  login: renderLogin,
  home: renderHome,
  booking: renderBookingScreen,
  reservations: renderReservationsScreen,
  admin: renderAdminScreen
};

function loadScreen(name) {
  if (!state.user && name !== 'login') name = 'login';
  state.screen = name;
  screenEl.innerHTML = `<div class="panel">${loadingHTML('Loading Parkline…')}</div>`;
  Promise.resolve(renderers[name]())
    .catch(err => {
      screenEl.innerHTML = `<div class="panel"><div class="empty-state"><strong>Something went wrong</strong><p style="margin:10px 0 18px">${esc(err.message)}</p><button class="secondary-button" data-action="home">Back home</button></div></div>`;
    });
  if (postcard) postcard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------ home screen ------------------------------ */
async function renderHome() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3600 * 1000);
  const [lotsData, reservationsData] = await Promise.all([
    api(`/lots?start_time=${encodeURIComponent(now.toISOString())}&end_time=${encodeURIComponent(soon.toISOString())}`),
    api(`/reservations?user_id=${state.user.id}`)
  ]);
  state.lots = lotsData.lots;
  if (!state.vehicles.length) {
    try { await loadVehicles(); } catch { /* vehicle list is optional on home */ }
  }

  const available = state.lots.reduce((sum, lot) => sum + lot.available_slots, 0);
  const totalSlots = state.lots.reduce((sum, lot) => sum + lot.total_slots, 0);
  const activeBookings = reservationsData.reservations.filter(r => ['PENDING', 'CONFIRMED'].includes(r.status) && new Date(r.end_time) > now).length;
  const first = state.lots[0];
  const availableRatio = first && first.total_slots ? first.available_slots / first.total_slots : 0.6;
  const liveCells = Math.max(1, Math.round(16 * availableRatio));

  const cells = Array.from({ length: 16 }, (_, i) => {
    if (i === 6) return '<div class="mini-slot selected"></div>';
    return `<div class="mini-slot${i < liveCells ? '' : ' occupied'}"></div>`;
  }).join('');

  screenEl.innerHTML = `
    <div class="panel home-panel">
      <div class="home-layout">
        <div class="home-copy">
          <div class="eyebrow">A little more room to move</div>
          <div class="home-greeting">Hi ${esc(state.user.name.split(' ')[0])} · signed in as ${esc(state.user.role.toLowerCase())}</div>
          <h1>Your space.<br>Your time.</h1>
          <p class="lead">Find a parking spot before you arrive. Choose a location, pick a bay that is genuinely free for your window, and keep your day moving.</p>
          <div class="home-actions">
            <button class="action-card" data-action="book">
              <span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 7h8M8 17h8M8 12h8"/></svg></span>
              <span class="action-text"><strong>Book a parking spot</strong><span>Live floors, time window and per-bay pricing</span></span>
              <span class="arrow">→</span>
            </button>
            <button class="action-card" data-action="reservations">
              <span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3"/></svg></span>
              <span class="action-text"><strong>View spot reservations</strong><span>${activeBookings} active · cancel, check in or check out</span></span>
              <span class="arrow">→</span>
            </button>
            ${state.user.role === 'ADMIN' ? `
            <button class="action-card admin-card" data-action="admin">
              <span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Z"/><path d="M9 12h6M12 9v6"/></svg></span>
              <span class="action-text"><strong>Admin dashboard</strong><span>Occupancy, revenue, slot status &amp; audit log</span></span>
              <span class="arrow">→</span>
            </button>` : ''}
          </div>
          <div class="stat-strip">
            <div class="stat-mini"><strong>${available}</strong><span>Free right now</span></div>
            <div class="stat-mini"><strong>${totalSlots}</strong><span>Total bays</span></div>
            <div class="stat-mini"><strong>${state.vehicles.length || '—'}</strong><span>Your vehicles</span></div>
          </div>
        </div>
        <div class="home-visual" aria-hidden="true">
          <div class="visual-glow"></div>
          <div class="mini-map">
            <div class="map-head"><span>${first ? esc(first.name) : 'City Centre'} · ${first ? esc(first.city) : 'Level 01'}</span><span class="live-pill">Live layout</span></div>
            <div class="mini-slots">${cells}</div>
            <div class="map-foot"><span>Spaces available</span><strong>${first ? first.available_slots : available} / ${first ? first.total_slots : totalSlots}</strong></div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ----------------------------- booking screen ---------------------------- */
async function loadVehicles() {
  const data = await api(`/vehicles?user_id=${state.user.id}`);
  state.vehicles = data.vehicles;
}
async function loadLots() {
  const data = await api('/lots');
  state.lots = data.lots;
}

async function renderBookingScreen() {
  await Promise.all([loadLots(), loadVehicles()]);
  if (!state.lots.length) throw new Error('No parking lots are configured yet.');

  const b = state.booking;
  if (!b.date) Object.assign(b, defaultWindow());
  if (!state.lots.some(lot => lot.id === b.lotId)) b.lotId = state.lots[0].id;
  if (b.vehicleId == null && state.vehicles[0]) b.vehicleId = state.vehicles[0].id;
  if (b.vehicleId && !state.vehicles.some(v => v.id === b.vehicleId)) b.vehicleId = state.vehicles[0] ? state.vehicles[0].id : null;
  drawBookingPanel();
  await refreshSlots();
}

function drawBookingPanel() {
  const b = state.booking;
  const lot = state.lots.find(l => l.id === b.lotId) || state.lots[0];
  const floors = [...new Set((lot?.floors || []))].sort((x, y) => x - y);

  screenEl.innerHTML = `
    <div class="panel">
      <div class="section-heading">
        <div>
          <div class="eyebrow">Reservation / 01</div>
          <h2>Choose your spot.</h2>
          <p class="lead">Live availability from the parking database. Pick a location, date and time window, then choose a green bay.</p>
        </div>
        <button class="back-button" data-action="home">← Back home</button>
      </div>

      <div class="form-row">
        <div class="field"><label for="lotSelect">Parking location</label>
          <select id="lotSelect">
            ${state.lots.map(l => `<option value="${l.id}" ${l.id === lot.id ? 'selected' : ''}>${esc(l.name)} · ${esc(l.city)} · ${l.available_slots ?? '—'}/${l.total_slots ?? '—'} free</option>`).join('')}
          </select>
        </div>
        <button class="camera-button" type="button" data-action="reservations" aria-label="Open reservations to check in at the gate" title="Gate entry: check in from your reservations">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>
        </button>
      </div>

      <div class="controls">
        <div class="field"><label for="dateInput">Date</label><input id="dateInput" type="date" value="${b.date}" min="${toDateInput(new Date())}"></div>
        <div class="field"><label for="floorSelect">Floor</label>
          <select id="floorSelect">
            <option value="">All floors</option>
            ${floors.map(f => `<option value="${f}" ${String(b.floor) === String(f) ? 'selected' : ''}>${floorLabel(f)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="fromInput">From</label><input id="fromInput" type="time" value="${b.from}"></div>
        <div class="field"><label for="toInput">To</label><input id="toInput" type="time" value="${b.to}"></div>
        <div class="field span-2"><label for="vehicleSelect">Vehicle</label>
          <select id="vehicleSelect">
            ${state.vehicles.length
              ? state.vehicles.map(v => `<option value="${v.id}" ${v.id === b.vehicleId ? 'selected' : ''}>${esc(v.registration_number)} · ${esc(v.model)} (${v.vehicle_type})</option>`).join('')
              : '<option value="">No vehicle saved — add one below</option>'}
          </select>
        </div>
        <div class="field span-2"><label for="typeSelect">Bay type</label>
          <select id="typeSelect">
            <option value="">All bay types</option>
            ${['CAR', 'EV', 'BIKE'].map(t => `<option value="${t}" ${b.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>

      <details class="add-vehicle">
        <summary>+ Add a vehicle</summary>
        <div class="controls" style="grid-template-columns:1fr 1fr 1.2fr auto;margin-top:12px">
          <div class="field"><label for="vehReg">Registration</label><input id="vehReg" type="text" placeholder="GJ05AB1234" maxlength="20"></div>
          <div class="field"><label for="vehType">Type</label><select id="vehType"><option>CAR</option><option>EV</option><option>BIKE</option></select></div>
          <div class="field"><label for="vehModel">Model</label><input id="vehModel" type="text" placeholder="Hyundai Creta" maxlength="80"></div>
          <div class="field"><label>&nbsp;</label><button class="secondary-button" type="button" data-action="add-vehicle">Add vehicle</button></div>
        </div>
      </details>

      <div class="location-line" style="margin-top:30px">
        <div><div class="location-title" id="lotTitle">${esc(lot.name)}</div><div class="location-sub" id="lotSubtitle">${esc(lot.address)}, ${esc(lot.city)} · ${lot.available_slots}/${lot.total_slots} bays bookable</div></div>
        <div class="legend"><span><i class="lg-green"></i>Available</span><span><i class="lg-red"></i>Booked</span><span><i class="lg-yellow"></i>Selected</span></div>
      </div>
      <div id="slotGrid">${loadingHTML('Checking live availability…')}</div>
      <div class="slot-note">Hover a bay to see its number, type and hourly rate. Grey bays are under maintenance. Availability is checked against overlapping reservations.</div>
      <div id="bookingSummary" class="booking-summary hidden"></div>
    </div>`;
}

async function refreshSlots() {
  const b = state.booking;
  const grid = document.getElementById('slotGrid');
  const w = bookingWindow();
  if (!grid) return;
  if (!b.lotId) {
    grid.innerHTML = '<div class="empty-state">Choose a parking location to see bays.</div>';
    return;
  }
  if (!w) {
    grid.innerHTML = '<div class="empty-state">Choose a valid date and time window to see bays.</div>';
    renderSummary();
    return;
  }
  grid.innerHTML = loadingHTML('Checking live availability…');
  try {
    const query = new URLSearchParams({ start_time: w.start.toISOString(), end_time: w.end.toISOString() });
    const data = await api(`/lots/${b.lotId}/slots?${query}`);
    state.lotSlots = data.slots;
    if (b.slotId) {
      const current = data.slots.find(s => s.id === b.slotId);
      if (!current || !current.available) b.slotId = null;
    }
    renderSlots();
    renderSummary();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

function renderSlots() {
  const grid = document.getElementById('slotGrid');
  if (!grid) return;
  const b = state.booking;
  let slots = state.lotSlots.slice();
  if (b.floor !== '' && b.floor !== null) slots = slots.filter(s => Number(s.floor_number) === Number(b.floor));
  if (b.type) slots = slots.filter(s => s.slot_type === b.type);

  if (!slots.length) {
    grid.innerHTML = '<div class="empty-state">No bays match this floor and type. Try “All floors” or another bay type.</div>';
    return;
  }
  const floors = [...new Set(slots.map(s => s.floor_number))].sort((x, y) => x - y);
  grid.innerHTML = floors.map(floor => {
    const onFloor = slots.filter(s => s.floor_number === floor);
    const free = onFloor.filter(s => s.available).length;
    return `<div class="floor-tag">${floorLabel(floor).toUpperCase()} / ${free} OF ${onFloor.length} FREE</div>
      <div class="floor-row">${onFloor.map(slotButtonHTML).join('')}</div>`;
  }).join('');
}

function slotButtonHTML(slot) {
  const selected = state.booking.slotId === slot.id;
  const underMaintenance = slot.operational_status !== 'ACTIVE';
  const unavailable = underMaintenance || !slot.available;
  const cls = selected ? 'selected' : underMaintenance ? 'maintenance' : slot.available ? 'available' : 'reserved';
  const stateText = underMaintenance ? slot.operational_status.toLowerCase() : slot.available ? 'available' : 'booked';
  const tip = `${slot.slot_number} · ${slot.slot_type} · ₹${slot.hourly_rate}/hr · ${stateText}`;
  return `<button type="button" class="slot ${cls}" data-action="pick-slot" data-id="${slot.id}" ${unavailable ? 'disabled' : ''} aria-label="${esc(tip)}">
    ${iconCar()}<span class="slot-type">${esc(slot.slot_type)}</span><span class="slot-id">${esc(slot.slot_number)}</span><span class="slot-tip">${esc(tip)}</span>
  </button>`;
}

function renderSummary() {
  const box = document.getElementById('bookingSummary');
  if (!box) return;
  const b = state.booking;
  const slot = state.lotSlots.find(s => s.id === b.slotId);
  const w = bookingWindow();
  if (!slot || !w) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const price = Math.round(w.hours * slot.hourly_rate * 100) / 100;
  const lot = state.lots.find(l => l.id === b.lotId);
  box.classList.remove('hidden');
  box.innerHTML = `
    <div>
      <div class="summary-label">Your selection · ready to reserve</div>
      <div class="summary-title">${esc(slot.slot_number)} <span style="font-weight:500;color:#8b958d;font-size:12px;letter-spacing:0">${esc(slot.slot_type)} bay · ${esc(floorLabel(slot.floor_number))}</span></div>
      <div class="summary-meta">
        <div class="meta-item">LOCATION<strong>${esc(lot?.name || '')}</strong></div>
        <div class="meta-item">DATE<strong>${esc(fmtDate(w.start.toISOString()))}</strong></div>
        <div class="meta-item">TIME RESERVED<strong>${esc(fmtTime(w.start.toISOString()))} – ${esc(fmtTime(w.end.toISOString()))}</strong></div>
        <div class="meta-item">VEHICLE<strong>${esc(state.vehicles.find(v => v.id === b.vehicleId)?.registration_number || '—')}</strong></div>
      </div>
    </div>
    <div class="price-block">
      <div class="price-caption">Estimated total</div>
      <div class="price">${money(price)}</div>
      <div class="price-note">₹${slot.hourly_rate}/hour · ${w.hours} hour${w.hours === 1 ? '' : 's'} billable</div>
    </div>
    <div class="summary-actions">
      <button class="secondary-button" type="button" data-action="clear-slot">Change spot</button>
      <button class="primary-button" type="button" data-action="confirm-booking">Pay &amp; reserve <span aria-hidden="true">→</span></button>
    </div>`;
}

async function confirmBooking(button) {
  const b = state.booking;
  const w = bookingWindow();
  if (!b.slotId) return showToast('Pick a parking bay first.');
  if (!w) return showToast('Choose a valid date and time window.');
  if (!b.vehicleId) return showToast('Select or add a vehicle first.');
  if (w.start < new Date(Date.now() - 60 * 1000)) return showToast('That start time is in the past.');

  button.disabled = true;
  button.textContent = 'Reserving…';
  try {
    const data = await api('/reservations', {
      method: 'POST',
      body: JSON.stringify({
        user_id: state.user.id,
        vehicle_id: b.vehicleId,
        slot_id: b.slotId,
        start_time: w.start.toISOString(),
        end_time: w.end.toISOString()
      })
    });
    b.slotId = null;
    state.resFilter = 'ALL';
    showToast(`${data.reservation.reference_code} confirmed · ${data.reservation.slot_number}`);
    loadScreen('reservations');
  } catch (err) {
    showToast(err.message);
    button.disabled = false;
    button.innerHTML = 'Pay &amp; reserve <span aria-hidden="true">→</span>';
    refreshSlots();
  }
}

/* --------------------------- reservations screen ------------------------- */
async function renderReservationsScreen() {
  const data = await api(`/reservations?user_id=${state.user.id}`);
  state.myReservations = data.reservations;
  screenEl.innerHTML = `
    <div class="panel">
      <div class="section-heading">
        <div>
          <div class="eyebrow">Reservations / 02</div>
          <h2>Your bookings.</h2>
          <p class="lead">Every row comes from the reservations table. Check in at the gate, check out to close the session, or cancel before you arrive.</p>
        </div>
        <button class="back-button" data-action="home">← Back home</button>
      </div>
      <div class="filter-tabs">
        ${['ALL', 'CONFIRMED', 'PENDING', 'COMPLETED', 'CANCELLED'].map(f =>
          `<button type="button" class="filter-tab ${state.resFilter === f ? 'active' : ''}" data-action="res-filter" data-filter="${f}">${f.replace('_', ' ')}</button>`
        ).join('')}
      </div>
      <div class="reservation-list" id="reservationList"></div>
    </div>`;
  paintReservations();
}

function paintReservations() {
  const root = document.getElementById('reservationList');
  if (!root) return;
  const items = state.resFilter === 'ALL'
    ? state.myReservations
    : state.myReservations.filter(r => r.status === state.resFilter);

  if (!items.length) {
    root.innerHTML = `<div class="empty-state">No ${state.resFilter === 'ALL' ? '' : state.resFilter.replace('_', ' ').toLowerCase() + ' '}bookings yet.<br><br><button class="secondary-button" data-action="book">Book a parking spot</button></div>`;
    return;
  }

  root.innerHTML = items.map(r => {
    const started = Boolean(r.actual_entry) && !r.actual_exit;
    const canCancel = ['PENDING', 'CONFIRMED'].includes(r.status) && !r.actual_entry;
    const canCheckIn = r.status === 'CONFIRMED' && !r.actual_entry;
    const canCheckOut = Boolean(r.actual_entry) && !r.actual_exit;
    return `<article class="reservation-row">
      <div>
        <h3>${esc(r.slot_number)} <span style="font-weight:400;color:#7b867d">/ ${esc(r.lot_name)}</span> <small>${esc(r.reference_code)}</small></h3>
        <p>${esc(floorLabel(r.floor_number))} · ${esc(r.slot_type)} bay</p>
        <div class="reservation-meta">
          <span>When<b>${esc(fmtDate(r.start_time))} · ${esc(fmtTime(r.start_time))} – ${esc(fmtTime(r.end_time))}</b></span>
          <span>Vehicle<b>${esc(r.registration_number || '—')}</b></span>
          <span>Total<b>${money(r.final_total ?? r.estimated_total)}${r.overstay_penalty > 0 ? ` incl. ${money(r.overstay_penalty)} penalty` : ''}</b></span>
          ${started ? `<span>Session<b>Started ${esc(fmtTime(r.actual_entry))}</b></span>` : ''}
        </div>
      </div>
      <div class="row-actions">
        <span class="status-pill status-${esc(r.status)}">${esc(r.status.replace('_', ' '))}</span>
        ${canCheckIn ? `<button class="mini-button" type="button" data-action="res-checkin" data-id="${r.id}">Check in</button>` : ''}
        ${canCheckOut ? `<button class="mini-button primary" type="button" data-action="res-checkout" data-id="${r.id}">Check out</button>` : ''}
        ${canCancel ? `<button class="mini-button danger" type="button" data-action="res-cancel" data-id="${r.id}">Cancel</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

/* ------------------------------ admin screen ----------------------------- */
async function renderAdminScreen() {
  if (state.user.role !== 'ADMIN') throw new Error('Admin access required. Sign in with admin@smartpark.in.');
  const [summary, logsData] = await Promise.all([api('/admin/summary'), api('/admin/logs')]);
  state.admin = summary;
  const t = summary.totals;
  const statuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
  const maxRevenue = Math.max(1, ...summary.revenue_by_lot.map(r => r.revenue));

  screenEl.innerHTML = `
    <div class="panel">
      <div class="section-heading">
        <div>
          <div class="eyebrow">Admin / 03</div>
          <h2>Operations desk.</h2>
          <p class="lead">Occupancy, revenue and bay status across all ${t.lots} parking lots. Changing a bay status writes to <span class="mono">slot_status_logs</span>.</p>
        </div>
        <button class="back-button" data-action="home">← Back home</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><strong>${money(t.revenue)}</strong><span>Total revenue</span></div>
        <div class="stat-card"><strong>${t.active_sessions}</strong><span>Active sessions</span></div>
        <div class="stat-card"><strong>${summary.occupancy_percent}%</strong><span>Occupancy</span></div>
        <div class="stat-card"><strong>${t.slots_operational}/${t.slots}</strong><span>Bays operational</span></div>
        <div class="stat-card"><strong>${t.reservations}</strong><span>Reservations</span></div>
        <div class="stat-card"><strong>${t.users}</strong><span>Users</span></div>
        <div class="stat-card"><strong>${t.vehicles}</strong><span>Vehicles</span></div>
        <div class="stat-card"><strong>${money(t.penalties)}</strong><span>Overstay penalties</span></div>
      </div>

      <div class="two-col">
        <div class="panel-block">
          <h3>Revenue by lot</h3>
          <p class="block-sub">Completed sessions only · <span class="mono">v_revenue_by_lot</span></p>
          <table class="data-table">
            <thead><tr><th>Lot</th><th>Reservations</th><th>Revenue</th><th></th></tr></thead>
            <tbody>
              ${summary.revenue_by_lot.map(row => `<tr>
                <td>${esc(row.lot_name)}</td>
                <td>${row.total_reservations}</td>
                <td>${money(row.revenue)}</td>
                <td><div class="bar"><i style="width:${Math.round(row.revenue / maxRevenue * 100)}%"></i></div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="panel-block">
          <h3>Reservation status</h3>
          <p class="block-sub">Snapshot of the reservations table</p>
          <table class="data-table">
            <thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>
            <tbody>
              ${statuses.map(s => {
                const n = summary.reservations_by_status[s] || 0;
                const pct = t.reservations ? Math.round(n / t.reservations * 100) : 0;
                return `<tr><td><span class="status-pill status-${s}">${s.replace('_', ' ')}</span></td><td><span class="badge-count">${n}</span></td><td><div class="bar"><i style="width:${pct}%"></i></div><div class="bar-label">${pct}%</div></td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel-block">
        <h3>Bay status control</h3>
        <p class="block-sub">Move a bay to maintenance or inactive — updates the slot and appends an audit row.</p>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Slot</th><th>Lot</th><th>Floor</th><th>Type</th><th>Live</th><th>Status</th></tr></thead>
            <tbody>
              ${summary.live_slots.map(s => `<tr>
                <td class="mono">${esc(s.slot_number)}</td>
                <td>${esc(s.lot_name)}</td>
                <td>${esc(floorLabel(s.floor_number))}</td>
                <td>${esc(s.slot_type)}</td>
                <td><span class="status-pill status-${s.live_status === 'OCCUPIED' ? 'CONFIRMED' : s.live_status === 'AVAILABLE' ? 'ACTIVE' : 'INACTIVE'}">${s.live_status}</span></td>
                <td><select data-action="slot-status" data-id="${s.slot_id}" aria-label="Status for ${esc(s.slot_number)}">
                  ${['ACTIVE', 'MAINTENANCE', 'INACTIVE'].map(v => `<option value="${v}" ${s.operational_status === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel-block">
        <h3>Slot status audit log</h3>
        <p class="block-sub">Latest maintenance changes</p>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Slot</th><th>Lot</th><th>Change</th><th>By</th><th>Reason</th><th>When</th></tr></thead>
            <tbody>
              ${logsData.logs.length ? logsData.logs.map(l => `<tr>
                <td class="mono">${esc(l.slot_number)}</td>
                <td>${esc(l.lot_name)}</td>
                <td><span class="status-pill status-${l.old_status}">${l.old_status}</span> → <span class="status-pill status-${l.new_status}">${l.new_status}</span></td>
                <td>${esc(l.changed_by)}</td>
                <td>${esc(l.reason || '—')}</td>
                <td>${esc(fmtDateTime(l.changed_at))}</td>
              </tr>`).join('') : '<tr><td colspan="6">No status changes logged yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ------------------------------ interaction ------------------------------ */
async function handleAction(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;

  if (trigger.tagName === 'SELECT') return; // handled by change listener

  if (action === 'home') {
    if (state.user) loadScreen('home'); else loadScreen('login');
    return;
  }
  if (action === 'book') { loadScreen('booking'); return; }
  if (action === 'reservations') { loadScreen('reservations'); return; }
  if (action === 'admin') { loadScreen('admin'); return; }
  if (action === 'logout') { logout(); return; }
  if (action === 'toggle-auth') { authMode = authMode === 'login' ? 'register' : 'login'; renderLogin(); return; }

  if (action === 'demo-login') {
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: trigger.dataset.email, password: trigger.dataset.password })
      });
      signedIn(data.user, data.vehicles);
    } catch (err) { showToast(err.message); }
    return;
  }

  if (action === 'pick-slot') {
    state.booking.slotId = Number(trigger.dataset.id);
    renderSlots();
    renderSummary();
    return;
  }
  if (action === 'clear-slot') {
    state.booking.slotId = null;
    renderSlots();
    renderSummary();
    return;
  }
  if (action === 'confirm-booking') { confirmBooking(trigger); return; }

  if (action === 'add-vehicle') {
    const registration_number = document.getElementById('vehReg')?.value.trim();
    const vehicle_type = document.getElementById('vehType')?.value;
    const model = document.getElementById('vehModel')?.value.trim();
    if (!registration_number || !model) return showToast('Enter the registration number and model.');
    try {
      const data = await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({ user_id: state.user.id, registration_number, vehicle_type, model })
      });
      state.vehicles.push(data.vehicle);
      state.booking.vehicleId = data.vehicle.id;
      showToast(`${data.vehicle.registration_number} added`);
      drawBookingPanel();
      await refreshSlots();
    } catch (err) { showToast(err.message); }
    return;
  }

  if (action === 'res-filter') {
    state.resFilter = trigger.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.filter === state.resFilter));
    paintReservations();
    return;
  }

  if (['res-cancel', 'res-checkin', 'res-checkout'].includes(action)) {
    const id = trigger.dataset.id;
    if (action === 'res-cancel' && !window.confirm('Cancel this reservation?')) return;
    trigger.disabled = true;
    try {
      const path = action === 'res-cancel' ? `/reservations/${id}/cancel`
        : action === 'res-checkin' ? `/reservations/${id}/checkin`
        : `/reservations/${id}/checkout`;
      const data = await api(path, { method: 'POST', body: '{}' });
      if (action === 'res-checkout') {
        showToast(`Checked out · final ${money(data.invoice.final_total)}${data.invoice.overstay_penalty ? ` (incl. ${money(data.invoice.overstay_penalty)} penalty)` : ''}`);
      } else if (action === 'res-checkin') {
        showToast(`Checked in at ${fmtTime(data.reservation.actual_entry)}`);
      } else {
        showToast('Reservation cancelled');
      }
      loadScreen('reservations');
    } catch (err) {
      showToast(err.message);
      trigger.disabled = false;
    }
  }
}

screenEl.addEventListener('change', async event => {
  const target = event.target;
  const b = state.booking;

  if (target.id === 'lotSelect') {
    b.lotId = Number(target.value);
    b.floor = '';
    b.slotId = null;
    drawBookingPanel();
    await refreshSlots();
    return;
  }
  if (target.id === 'floorSelect') {
    b.floor = target.value === '' ? '' : Number(target.value);
    b.slotId = null;
    renderSlots();
    renderSummary();
    return;
  }
  if (target.id === 'vehicleSelect') {
    b.vehicleId = target.value ? Number(target.value) : null;
    renderSummary();
    return;
  }
  if (target.id === 'typeSelect') {
    b.type = target.value;
    b.slotId = null;
    renderSlots();
    renderSummary();
    return;
  }
  if (['dateInput', 'fromInput', 'toInput'].includes(target.id)) {
    b.date = document.getElementById('dateInput').value;
    b.from = document.getElementById('fromInput').value;
    b.to = document.getElementById('toInput').value;
    b.slotId = null;
    await refreshSlots();
    return;
  }
  if (target.dataset.action === 'slot-status') {
    const slotId = Number(target.dataset.id);
    const next = target.value;
    const reason = window.prompt(`Reason for setting slot to ${next}?`, next === 'ACTIVE' ? 'Repair completed' : 'Maintenance required');
    if (reason === null) {
      loadScreen('admin');
      return;
    }
    try {
      await api(`/slots/${slotId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, reason, actor: state.user.name })
      });
      showToast(`Slot updated to ${next.toLowerCase()}`);
      loadScreen('admin');
    } catch (err) {
      showToast(err.message);
      loadScreen('admin');
    }
  }
});

document.addEventListener('click', handleAction);

/* -------------------------------- boot ---------------------------------- */
(function init() {
  try {
    const stored = sessionStorage.getItem('parkline:user');
    if (stored) state.user = JSON.parse(stored);
  } catch { state.user = null; }
  renderTopbar();
  loadScreen(state.user ? 'home' : 'login');

  const cursor = document.getElementById('cursorRing');
  if (cursor && window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('mousemove', event => {
      cursor.style.left = event.clientX + 'px';
      cursor.style.top = event.clientY + 'px';
      cursor.classList.add('active');
    });
    document.addEventListener('mouseleave', () => cursor.classList.remove('active'));
    document.addEventListener('mouseover', event => {
      cursor.classList.toggle('big', Boolean(event.target.closest('button, select, input, summary, a')));
    });
  }
})();
