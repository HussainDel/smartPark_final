-- SQLite port of the Smart Parking schema (used by the zero-dependency demo server).
-- Same tables / columns / constraints as database/schema.sql (MySQL).

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS slot_status_logs;
DROP TABLE IF EXISTS parking_sessions;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS parking_slots;
DROP TABLE IF EXISTS parking_lots;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  registration_number TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('CAR','EV','BIKE')),
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vehicles_user ON vehicles(user_id);

CREATE TABLE parking_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  floor_count INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE parking_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  slot_number TEXT NOT NULL,
  floor_number INTEGER NOT NULL,
  slot_type TEXT NOT NULL CHECK (slot_type IN ('CAR','EV','BIKE')),
  hourly_rate REAL NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (operational_status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lot_id, slot_number)
);
CREATE INDEX idx_slots_lot_floor ON parking_slots(lot_id, floor_number);

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES parking_slots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW')),
  estimated_total REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_res_slot_time ON reservations(slot_id, start_time, end_time);

CREATE TABLE parking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  actual_entry TEXT,
  actual_exit TEXT,
  duration_minutes INTEGER,
  overstay_penalty REAL NOT NULL DEFAULT 0,
  final_total REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE slot_status_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES parking_slots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  old_status TEXT NOT NULL CHECK (old_status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  new_status TEXT NOT NULL CHECK (new_status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);
CREATE INDEX idx_logs_slot ON slot_status_logs(slot_id);

-- ========== SEED ==========
INSERT INTO users (id, name, email, phone, password, role) VALUES
(1, 'Aarav Mehta',  'aarav@example.com',  '+919820011223', 'demo123',  'CUSTOMER'),
(2, 'Priya Sharma', 'admin@smartpark.in', '+919833044556', 'admin123', 'ADMIN'),
(3, 'Diya Patel',   'diya@example.com',   '+919820011224', 'demo123',  'CUSTOMER'),
(4, 'Rohan Iyer',   'rohan@example.com',  '+919820011225', 'demo123',  'CUSTOMER'),
(5, 'Ananya Rao',   'ananya@example.com', '+919820011226', 'demo123',  'CUSTOMER'),
(6, 'Kabir Shah',   'kabir@example.com',  '+919820011227', 'demo123',  'CUSTOMER'),
(7, 'Meera Nair',   'meera@example.com',  '+919820011228', 'demo123',  'CUSTOMER'),
(8, 'Vivaan Joshi', 'vivaan@example.com', '+919820011229', 'admin123', 'ADMIN');

INSERT INTO vehicles (id, user_id, registration_number, vehicle_type, model) VALUES
(1, 1, 'MH01AB1234', 'CAR',  'Hyundai Creta'),
(2, 1, 'GJ05EV7788', 'EV',   'Tata Nexon EV'),
(3, 1, 'GJ05BK4412', 'BIKE', 'Royal Enfield Classic'),
(4, 3, 'MH02XY9900', 'CAR',  'Honda City'),
(5, 4, 'GJ01CD5678', 'EV',   'MG ZS EV'),
(6, 5, 'MH03EF9012', 'BIKE', 'Bajaj Pulsar'),
(7, 2, 'GJ05AD0001', 'CAR',  'Honda City Admin');

INSERT INTO parking_lots (id, name, city, address, floor_count, is_active) VALUES
(1, 'Phoenix Marketcity', 'Mumbai', 'Ring Road, Kurla West', 3, 1),
(2, 'Riverside Business Park', 'Ahmedabad', 'Off Ashram Road', 2, 1),
(3, 'Surat Central Mall', 'Surat', 'Vesu Main Road', 3, 1);

INSERT INTO parking_slots (id, lot_id, slot_number, floor_number, slot_type, hourly_rate, operational_status) VALUES
(1, 1, 'A101', 0, 'CAR', 40.00, 'ACTIVE'), (2, 1, 'A102', 0, 'CAR', 40.00, 'ACTIVE'),
(3, 1, 'A103', 0, 'CAR', 40.00, 'ACTIVE'), (4, 1, 'A104', 0, 'CAR', 40.00, 'ACTIVE'),
(5, 1, 'A105', 0, 'EV', 55.00, 'ACTIVE'), (6, 1, 'A106', 0, 'EV', 55.00, 'ACTIVE'),
(7, 1, 'A107', 0, 'BIKE', 20.00, 'ACTIVE'), (8, 1, 'A108', 0, 'BIKE', 20.00, 'ACTIVE'),
(9, 1, 'A109', 0, 'CAR', 40.00, 'MAINTENANCE'), (10, 1, 'A110', 0, 'CAR', 40.00, 'ACTIVE'),
(11, 1, 'B101', 1, 'CAR', 40.00, 'ACTIVE'), (12, 1, 'B102', 1, 'CAR', 40.00, 'ACTIVE'),
(13, 1, 'B103', 1, 'CAR', 40.00, 'ACTIVE'), (14, 1, 'B104', 1, 'CAR', 40.00, 'ACTIVE'),
(15, 1, 'B105', 1, 'EV', 55.00, 'ACTIVE'), (16, 1, 'B106', 1, 'EV', 55.00, 'ACTIVE'),
(17, 1, 'B107', 1, 'BIKE', 20.00, 'ACTIVE'), (18, 1, 'B108', 1, 'BIKE', 20.00, 'ACTIVE'),
(19, 1, 'B109', 1, 'CAR', 40.00, 'ACTIVE'), (20, 1, 'B110', 1, 'CAR', 40.00, 'INACTIVE'),
(21, 1, 'C101', 2, 'CAR', 40.00, 'ACTIVE'), (22, 1, 'C102', 2, 'CAR', 40.00, 'ACTIVE'),
(23, 1, 'C103', 2, 'EV', 55.00, 'ACTIVE'), (24, 1, 'C104', 2, 'BIKE', 20.00, 'ACTIVE'),
(25, 2, 'A101', 0, 'CAR', 30.00, 'ACTIVE'), (26, 2, 'A102', 0, 'CAR', 30.00, 'ACTIVE'),
(27, 2, 'A103', 0, 'EV', 45.00, 'ACTIVE'), (28, 2, 'A104', 0, 'EV', 45.00, 'ACTIVE'),
(29, 2, 'A105', 0, 'BIKE', 15.00, 'ACTIVE'), (30, 2, 'A106', 0, 'BIKE', 15.00, 'ACTIVE'),
(31, 2, 'A107', 0, 'CAR', 30.00, 'ACTIVE'), (32, 2, 'A108', 0, 'CAR', 30.00, 'MAINTENANCE'),
(33, 2, 'B101', 1, 'CAR', 30.00, 'ACTIVE'), (34, 2, 'B102', 1, 'EV', 45.00, 'ACTIVE'),
(35, 2, 'B103', 1, 'CAR', 30.00, 'ACTIVE'), (36, 2, 'B104', 1, 'BIKE', 15.00, 'ACTIVE'),
(37, 3, 'A101', 0, 'CAR', 35.00, 'ACTIVE'), (38, 3, 'A102', 0, 'CAR', 35.00, 'ACTIVE'),
(39, 3, 'A103', 0, 'EV', 50.00, 'ACTIVE'), (40, 3, 'A104', 0, 'EV', 50.00, 'ACTIVE'),
(41, 3, 'A105', 0, 'BIKE', 18.00, 'ACTIVE'), (42, 3, 'B101', 1, 'CAR', 35.00, 'ACTIVE'),
(43, 3, 'B102', 1, 'BIKE', 18.00, 'ACTIVE'), (44, 3, 'B103', 1, 'CAR', 35.00, 'ACTIVE'),
(45, 3, 'B104', 1, 'EV', 50.00, 'ACTIVE'), (46, 3, 'C101', 2, 'CAR', 35.00, 'ACTIVE'),
(47, 3, 'C102', 2, 'CAR', 35.00, 'ACTIVE'), (48, 3, 'C103', 2, 'EV', 50.00, 'ACTIVE');

INSERT INTO reservations (id, reference_code, user_id, vehicle_id, slot_id, lot_id, start_time, end_time, status, estimated_total) VALUES
(1, 'SP-2026-1001', 1, 1, 1, 1, datetime('now','+26 hours'), datetime('now','+28 hours'), 'CONFIRMED', 80.00),
(2, 'SP-2026-1002', 1, 2, 5, 1, datetime('now','+50 hours'), datetime('now','+53 hours'), 'PENDING', 165.00),
(3, 'SP-2026-1003', 1, 1, 1, 1, datetime('now','-26 hours'), datetime('now','-24 hours'), 'COMPLETED', 80.00),
(4, 'SP-2026-1004', 3, 4, 11,1, datetime('now','-5 hours'), datetime('now','-3 hours'), 'COMPLETED', 80.00),
(5, 'SP-2026-1005', 4, 5, 27,2, datetime('now','-2 days'), datetime('now','-46 hours'), 'CANCELLED', 90.00),
(6, 'SP-2026-1006', 5, 6, 29,2, datetime('now','-1 day'), datetime('now','-23 hours'), 'NO_SHOW', 15.00),
(7, 'SP-2026-1007', 6, 1, 2, 1, datetime('now','-30 minutes'), datetime('now','+90 minutes'), 'CONFIRMED', 80.00),
(8, 'SP-2026-1008', 5, 6, 42,3, datetime('now','+1 hour'), datetime('now','+3 hours'), 'CONFIRMED', 70.00),
(9, 'SP-2026-1009', 7, 1, 3, 1, datetime('now','-10 minutes'), datetime('now','+110 minutes'), 'CONFIRMED', 80.00),
(10,'SP-2026-1010', 3, 4, 25,2, datetime('now','-3 hours'), datetime('now','-1 hour'), 'COMPLETED', 60.00),
(11,'SP-2026-1011', 8, 7, 37,3, datetime('now','-4 hours'), datetime('now','-2 hours'), 'COMPLETED', 70.00);

INSERT INTO parking_sessions (reservation_id, actual_entry, actual_exit, duration_minutes, overstay_penalty, final_total) VALUES
(3, datetime('now','-26 hours'), datetime('now','-24 hours'), 120, 0.00, 80.00),
(4, datetime('now','-5 hours'), datetime('now','-3 hours'), 120, 0.00, 80.00),
(7, datetime('now','-25 minutes'), NULL, NULL, 0.00, NULL),
(9, datetime('now','-8 minutes'), NULL, NULL, 0.00, NULL),
(10, datetime('now','-3 hours'), datetime('now','-1 hour'), 120, 0.00, 60.00),
(11, datetime('now','-4 hours'), datetime('now','-2 hours'), 120, 0.00, 70.00);

INSERT INTO slot_status_logs (slot_id, old_status, new_status, changed_by, reason) VALUES
(9, 'ACTIVE', 'MAINTENANCE', 'Priya Sharma', 'Sensor fault'),
(20,'ACTIVE','INACTIVE','Priya Sharma','Floor B repainting'),
(32,'ACTIVE','MAINTENANCE','Priya Sharma','EV charger repair');

-- Views
CREATE VIEW v_slot_availability AS
SELECT s.id AS slot_id, s.lot_id, l.name AS lot_name, s.slot_number, s.floor_number,
       s.slot_type, s.hourly_rate, s.operational_status,
       CASE WHEN s.operational_status <> 'ACTIVE' THEN 'UNAVAILABLE'
            WHEN EXISTS (SELECT 1 FROM parking_sessions ps
                          JOIN reservations r ON r.id = ps.reservation_id
                         WHERE r.slot_id = s.id AND r.status = 'CONFIRMED'
                           AND ps.actual_entry IS NOT NULL AND ps.actual_exit IS NULL)
              THEN 'OCCUPIED'
            ELSE 'AVAILABLE' END AS live_status
FROM parking_slots s JOIN parking_lots l ON l.id = s.lot_id;

CREATE VIEW v_revenue_by_lot AS
SELECT l.id AS lot_id, l.name AS lot_name, COUNT(r.id) AS total_reservations,
       COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN ps.final_total END), 0) AS revenue
FROM parking_lots l
LEFT JOIN reservations r ON r.lot_id = l.id
LEFT JOIN parking_sessions ps ON ps.reservation_id = r.id
GROUP BY l.id, l.name;
