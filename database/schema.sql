-- =====================================================================
-- SMART PARKING  ·  MySQL 8 schema + seed data
-- Run:  mysql -u root -p < database/schema.sql
-- =====================================================================

-- DROP+CLEAN (safe if DB already gone)
DROP DATABASE IF EXISTS smart_parking;
CREATE DATABASE smart_parking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_parking;

SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS slot_status_logs;
DROP TABLE IF EXISTS parking_sessions;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS parking_slots;
DROP TABLE IF EXISTS parking_lots;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS=1;

-- 1. USERS — local login, password saved here (no auth API)
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('CUSTOMER','ADMIN') NOT NULL DEFAULT 'CUSTOMER',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- 2. VEHICLES
CREATE TABLE vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  registration_number VARCHAR(20) NOT NULL,
  vehicle_type ENUM('CAR','EV','BIKE') NOT NULL,
  model VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vehicles_reg (registration_number),
  KEY idx_vehicles_user (user_id),
  CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 3. PARKING LOTS
CREATE TABLE parking_lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  city VARCHAR(80) NOT NULL,
  address VARCHAR(255) NOT NULL,
  floor_count TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. PARKING SLOTS
CREATE TABLE parking_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lot_id INT NOT NULL,
  slot_number VARCHAR(20) NOT NULL,
  floor_number TINYINT NOT NULL,
  slot_type ENUM('CAR','EV','BIKE') NOT NULL,
  hourly_rate DECIMAL(6,2) NOT NULL,
  operational_status ENUM('ACTIVE','MAINTENANCE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slot_lot_number (lot_id, slot_number),
  KEY idx_slots_lot_floor (lot_id, floor_number),
  CONSTRAINT fk_slots_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. RESERVATIONS — half-open [start,end)
CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_code VARCHAR(20) NOT NULL,
  user_id INT NOT NULL,
  vehicle_id INT NULL,
  slot_id INT NOT NULL,
  lot_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status ENUM('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW') NOT NULL DEFAULT 'PENDING',
  estimated_total DECIMAL(8,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_res_reference (reference_code),
  KEY idx_res_slot_time (slot_id, start_time, end_time),
  CONSTRAINT fk_res_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_res_slot FOREIGN KEY (slot_id) REFERENCES parking_slots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_res_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_res_time CHECK (end_time > start_time)
) ENGINE=InnoDB;

-- 6. PARKING SESSIONS
CREATE TABLE parking_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  actual_entry DATETIME NULL,
  actual_exit DATETIME NULL,
  duration_minutes INT NULL,
  overstay_penalty DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  final_total DECIMAL(8,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_session_reservation (reservation_id),
  CONSTRAINT fk_session_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 7. SLOT STATUS LOGS
CREATE TABLE slot_status_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slot_id INT NOT NULL,
  old_status ENUM('ACTIVE','MAINTENANCE','INACTIVE') NOT NULL,
  new_status ENUM('ACTIVE','MAINTENANCE','INACTIVE') NOT NULL,
  changed_by VARCHAR(100) NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(255) NULL,
  KEY idx_logs_slot (slot_id),
  CONSTRAINT fk_logs_slot FOREIGN KEY (slot_id) REFERENCES parking_slots(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

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
(1, 'SP-2026-1001', 1, 1, 1, 1, DATE_ADD(NOW(), INTERVAL 26 HOUR), DATE_ADD(NOW(), INTERVAL 28 HOUR), 'CONFIRMED', 80.00),
(2, 'SP-2026-1002', 1, 2, 5, 1, DATE_ADD(NOW(), INTERVAL 50 HOUR), DATE_ADD(NOW(), INTERVAL 53 HOUR), 'PENDING', 165.00),
(3, 'SP-2026-1003', 1, 1, 1, 1, DATE_SUB(NOW(), INTERVAL 26 HOUR), DATE_SUB(NOW(), INTERVAL 24 HOUR), 'COMPLETED', 80.00),
(4, 'SP-2026-1004', 3, 4, 11,1, DATE_SUB(NOW(), INTERVAL 5 HOUR), DATE_SUB(NOW(), INTERVAL 3 HOUR), 'COMPLETED', 80.00),
(5, 'SP-2026-1005', 4, 5, 27,2, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 2 DAY), INTERVAL 2 HOUR), 'CANCELLED', 90.00),
(6, 'SP-2026-1006', 5, 6, 29,2, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 1 DAY), INTERVAL 1 HOUR), 'NO_SHOW', 15.00),
(7, 'SP-2026-1007', 6, 1, 2, 1, DATE_SUB(NOW(), INTERVAL 30 MINUTE), DATE_ADD(NOW(), INTERVAL 90 MINUTE), 'CONFIRMED', 80.00),
(8, 'SP-2026-1008', 5, 6, 42,3, DATE_ADD(NOW(), INTERVAL 1 HOUR), DATE_ADD(NOW(), INTERVAL 3 HOUR), 'CONFIRMED', 70.00),
(9, 'SP-2026-1009', 7, 1, 3, 1, DATE_SUB(NOW(), INTERVAL 10 MINUTE), DATE_ADD(NOW(), INTERVAL 110 MINUTE), 'CONFIRMED', 80.00),
(10,'SP-2026-1010', 3, 4, 25,2, DATE_SUB(NOW(), INTERVAL 3 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR), 'COMPLETED', 60.00),
(11,'SP-2026-1011', 8, 7, 37,3, DATE_SUB(NOW(), INTERVAL 4 HOUR), DATE_SUB(NOW(), INTERVAL 2 HOUR), 'COMPLETED', 70.00);
ALTER TABLE reservations AUTO_INCREMENT = 1012;

INSERT INTO parking_sessions (reservation_id, actual_entry, actual_exit, duration_minutes, overstay_penalty, final_total) VALUES
(3, DATE_SUB(NOW(), INTERVAL 26 HOUR), DATE_SUB(NOW(), INTERVAL 24 HOUR), 120, 0.00, 80.00),
(4, DATE_SUB(NOW(), INTERVAL 5 HOUR), DATE_SUB(NOW(), INTERVAL 3 HOUR), 120, 0.00, 80.00),
(7, DATE_SUB(NOW(), INTERVAL 25 MINUTE), NULL, NULL, 0.00, NULL),
(9, DATE_SUB(NOW(), INTERVAL 8 MINUTE), NULL, NULL, 0.00, NULL),
(10,DATE_SUB(NOW(), INTERVAL 3 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR), 120, 0.00, 60.00),
(11,DATE_SUB(NOW(), INTERVAL 4 HOUR), DATE_SUB(NOW(), INTERVAL 2 HOUR), 120, 0.00, 70.00);

INSERT INTO slot_status_logs (slot_id, old_status, new_status, changed_by, reason) VALUES
(9, 'ACTIVE', 'MAINTENANCE', 'Priya Sharma', 'Sensor fault'),
(20,'ACTIVE','INACTIVE','Priya Sharma','Floor B repainting'),
(32,'ACTIVE','MAINTENANCE','Priya Sharma','EV charger repair');

-- =====================================================================
-- Helper views (presentation queries)
-- =====================================================================
CREATE OR REPLACE VIEW v_slot_availability AS
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

CREATE OR REPLACE VIEW v_revenue_by_lot AS
SELECT l.id AS lot_id, l.name AS lot_name, COUNT(r.id) AS total_reservations,
       COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN ps.final_total END), 0) AS revenue
FROM parking_lots l
LEFT JOIN reservations r ON r.lot_id = l.id
LEFT JOIN parking_sessions ps ON ps.reservation_id = r.id
GROUP BY l.id, l.name;
