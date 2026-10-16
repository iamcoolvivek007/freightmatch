import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.sqlite');
export const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  shipper TEXT NOT NULL,
  shipper_phone TEXT DEFAULT '',
  commodity TEXT NOT NULL,
  origin_city TEXT NOT NULL,
  origin_state TEXT NOT NULL,
  dest_city TEXT NOT NULL,
  dest_state TEXT NOT NULL,
  pickup_date TEXT NOT NULL,          -- ISO yyyy-mm-dd
  equipment TEXT NOT NULL,             -- dryvan|reefer|flatbed|stepdeck|tanker
  weight_lb INTEGER NOT NULL,
  offered_rate_cents INTEGER NOT NULL, -- shipper's posted rate
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',-- open|negotiating|booked|cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver TEXT NOT NULL,
  phone TEXT NOT NULL,
  truck_number TEXT DEFAULT '',
  equipment TEXT NOT NULL,
  capacity_lb INTEGER NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  available_date TEXT NOT NULL,
  min_rate_cents INTEGER NOT NULL,     -- driver's all-in floor
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available', -- available|booked
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One negotiation thread per (load, truck). Offers/counters live as rows.
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id INTEGER NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  by TEXT NOT NULL,                    -- broker|truck
  rate_cents INTEGER NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', -- open|accepted|rejected|withdrawn
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id INTEGER NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  rate_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_lt ON offers(load_id, truck_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assign_load ON assignments(load_id);
`);

export const nowISO = () => new Date().toISOString().slice(0, 10);