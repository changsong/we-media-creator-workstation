import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS checkout_orders (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  email TEXT NOT NULL,
  email_norm TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_id TEXT,
  prepay_payload TEXT,
  keygate_license_id TEXT,
  keygate_valid_until TEXT,
  keygate_prior_valid_until TEXT,
  refund_no TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_queried_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  fulfilled_at TEXT,
  refunded_at TEXT
);
CREATE INDEX IF NOT EXISTS checkout_orders_status ON checkout_orders(status, created_at);
CREATE INDEX IF NOT EXISTS checkout_orders_email ON checkout_orders(email_norm, created_at);

CREATE TABLE IF NOT EXISTS checkout_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(order_id, type, external_id)
);
`;

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA);
  return db;
}

export function immediate(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction is already gone */
    }
    throw error;
  }
}

export function closeDb(db) {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
