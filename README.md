# Parkline — Smart Parking Reservation System

A complete smart-parking web app: live bay availability, reservation booking with overlap protection,
gate check-in / check-out with overstay penalties, and an admin console for occupancy, revenue and bay status.

Built as a DBMS project. The **submission schema is `database/schema.sql` (MySQL 8)**; the runnable demo uses the
same tables through Node's built-in SQLite (`database/schema.sqlite.sql`) so it starts with **zero installs, zero npm packages**.

---

## Quick start (10 seconds)

```bash
node --version        # needs v22.5+ (node:sqlite)
npm start             # → http://localhost:3000
```

Fresh database? `npm run reset` (deletes `data/smartpark.db` and reseeds). The database is created automatically on first run.

### Demo logins

| Role | Email | Password |
|------|-------|----------|
| Customer | `aarav@example.com` | `demo123` |
| Admin | `admin@smartpark.in` | `admin123` |

More seeded customers: `diya@example.com`, `rohan@example.com`, `ananya@example.com`, `kabir@example.com`,
`meera@example.com` (all `demo123`). Registration is also enabled from the sign-in screen.

---

## Features

**Customer**
- Register / sign in (users table, role-based redirect).
- Live bay map per lot and floor, colour-coded **available / booked / under maintenance**.
- Date + time window booking, per-bay hourly rate (CAR / EV / BIKE) and billable duration pricing.
- Double-booking prevention: overlapping reservations are rejected by the API (half-open `[start, end)` rule).
- Vehicle garage: add cars, EVs and bikes; choose the vehicle for each booking.
- Reservations page: status, reference code, total, **cancel**, **check in**, **check out** (final invoice with overstay penalty).

**Admin**
- KPI cards: revenue, active sessions, occupancy %, operational bays, users, vehicles, penalties.
- Revenue by lot (view `v_revenue_by_lot`) and reservations by status.
- Bay status control (`ACTIVE / MAINTENANCE / INACTIVE`) with mandatory audit trail into `slot_status_logs`.
- Audit log viewer.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | HTML + CSS + vanilla JS (single page, no build step) |
| API | Node.js `node:http`, REST/JSON, zero npm dependencies |
| Database (submission) | **MySQL 8** — `database/schema.sql` |
| Database (demo runtime) | SQLite via `node:sqlite` — identical tables/constraints |

```
smartPark_final/
├── server.js                 # REST API + static file server (no deps)
├── package.json
├── database/
│   ├── schema.sql            # MySQL schema + seed + views  ← submission script
│   └── schema.sqlite.sql     # portable port used by the demo server
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/smartpark.db         # created at runtime (git-ignored)
└── README.md
```

Run the MySQL script:

```bash
mysql -u root -p < database/schema.sql
```

---

## Database design

7 tables, 3NF, InnoDB, foreign keys with `RESTRICT` / `CASCADE` as appropriate.

```
users 1───┬──< vehicles
          └──< reservations >─── parking_slots >─── parking_lots
                    │ 1
                    └─── parking_sessions (1:1)
parking_slots 1───< slot_status_logs
```

| Table | Purpose | Key constraints |
|-------|---------|-----------------|
| `users` | Customers & admins, local password | `UNIQUE(email)`, role enum |
| `vehicles` | Garage per user | `UNIQUE(registration_number)`, FK → users |
| `parking_lots` | Locations, floors | — |
| `parking_slots` | Individual bays + hourly rate | `UNIQUE(lot_id, slot_number)`, status enum |
| `reservations` | Booking window and price | `UNIQUE(reference_code)`, `CHECK(end_time > start_time)`, indexes on `(slot_id, start_time, end_time)` |
| `parking_sessions` | Actual entry/exit, duration, penalty | `UNIQUE(reservation_id)` (1:1 with reservation) |
| `slot_status_logs` | Audit trail for bay status | FK → parking_slots |

**Views:** `v_slot_availability` (available / occupied / unavailable right now), `v_revenue_by_lot`.

**Business rules enforced in the API**
1. A slot can only be booked if `operational_status = 'ACTIVE'`.
2. Overlap test: reject when `existing.start < new.end AND existing.end > new.start` for `PENDING`/`CONFIRMED`.
3. `end_time > start_time`, maximum 24 h, start time cannot be in the past.
4. Price = `ceil(minutes / 30) / 2 × hourly_rate` (half-hour billing).
5. Check-in requires a `CONFIRMED` reservation; check-out closes the session, computes duration and an overstay
   penalty of `ceil(overstay_minutes / 30) / 2 × hourly_rate × 1.5`, then marks the reservation `COMPLETED`.
6. Changing a bay to maintenance/inactive is blocked while a vehicle is checked in, and always writes a log row.

> **Note:** passwords are stored as plain text in the seed to match the project brief ("password saved here").
> Production systems must hash with bcrypt/argon2.

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | `{email, password}` → user + vehicles |
| POST | `/api/auth/register` | Create customer account |
| GET | `/api/lots?start_time&end_time` | Lots with live free-bay counts |
| GET | `/api/lots/:id/slots?start_time&end_time&floor` | Bays + availability for a window |
| GET | `/api/vehicles?user_id` | Vehicle list |
| POST | `/api/vehicles` | Add a vehicle |
| GET | `/api/reservations?user_id=&status=` | Reservations (joined slot, lot, vehicle) |
| POST | `/api/reservations` | Book `{user_id, vehicle_id, slot_id, start_time, end_time}` |
| POST | `/api/reservations/:id/cancel` | Cancel |
| POST | `/api/reservations/:id/checkin` | Gate entry |
| POST | `/api/reservations/:id/checkout` | Gate exit + invoice |
| GET | `/api/admin/summary` | KPIs, revenue by lot, live slots |
| GET | `/api/admin/logs` | Status audit log |
| PATCH | `/api/slots/:id/status` | `{status, reason, actor}` + audit row |

All timestamps are exchanged as ISO-8601 UTC and displayed in the browser's local timezone.

---

## Test cases to demo

1. **Login** as `aarav@example.com / demo123` → home shows live free bays.
2. **Book** a green bay: pick date/time and confirm → reference code + row in reservations.
3. **Double booking**: try the same bay/window from another account → `409` "already booked".
4. **Maintenance**: bay `A109` is grey and cannot be selected.
5. **Cancel** a future booking; **check in** a confirmed one; **check out** → session row, final total.
6. **Admin login** `admin@smartpark.in / admin123` → dashboard → set a bay to MAINTENANCE → audit log gains a row.

---

## License

MIT — academic project use.
