import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, ensureDir, nowIso, todayKey } from './util.mjs';

const DB_FILE = process.env.MARKETING_DB || path.join(DATA_DIR, 'marketing.db');
ensureDir(path.dirname(DB_FILE));

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_url TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL DEFAULT '',
    followers INTEGER NOT NULL DEFAULT 0,
    last_active TEXT NOT NULL DEFAULT '',
    niche TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    last_touch_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS touches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    template_id TEXT NOT NULL DEFAULT '',
    draft TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    sent_day TEXT NOT NULL DEFAULT '',
    reply_text TEXT NOT NULL DEFAULT '',
    reply_intent TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    sent_at TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, last_touch_at);
  CREATE INDEX IF NOT EXISTS idx_touches_lead ON touches(lead_id, id);
`);

const toInt = (value) => {
  const n = Number(String(value || '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function importLeads(rows) {
  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO leads (profile_url, nickname, followers, last_active, niche, source, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
  `);
  const update = db.prepare(`
    UPDATE leads SET nickname = ?, followers = ?, last_active = ?, niche = ?, source = ?, note = ?, updated_at = ?
    WHERE profile_url = ?
  `);
  const find = db.prepare('SELECT id FROM leads WHERE profile_url = ?');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const profileUrl = String(row.profile_url || '').trim();
    if (!/^https?:\/\//i.test(profileUrl)) {
      skipped++;
      continue;
    }
    const nickname = String(row.nickname || '').trim() || profileUrl;
    const followers = toInt(row.followers);
    const lastActive = String(row.last_active || '').trim();
    const niche = String(row.niche || '').trim();
    const source = String(row.source || '').trim();
    const note = String(row.note || '').trim();
    if (find.get(profileUrl)) {
      update.run(nickname, followers, lastActive, niche, source, note, now, profileUrl);
      updated++;
    } else {
      insert.run(profileUrl, nickname, followers, lastActive, niche, source, note, now, now);
      inserted++;
    }
  }
  return { inserted, updated, skipped };
}

export function stats() {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM leads GROUP BY status ORDER BY count DESC').all();
  const total = db.prepare('SELECT COUNT(*) AS count FROM leads').get().count;
  const sentToday = db.prepare("SELECT COUNT(*) AS count FROM touches WHERE status = 'sent' AND sent_day = ?").get(todayKey()).count;
  const replied = db.prepare("SELECT COUNT(DISTINCT lead_id) AS count FROM touches WHERE reply_text <> ''").get().count;
  return { total, byStatus, sentToday, replied };
}

export function queue({ limit = 20, cooldownDays = 30, minFollowers = 0 } = {}) {
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM leads
    WHERE status IN ('new', 'queued')
      AND followers >= ?
      AND (last_touch_at IS NULL OR last_touch_at < ?)
    ORDER BY followers DESC, id ASC
    LIMIT ?
  `).all(minFollowers, cutoff, limit);
}

export function getLead(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) || null;
}

export function markSent(leadId, templateId, draft) {
  const now = nowIso();
  const day = todayKey();
  db.prepare("UPDATE leads SET status = 'sent', last_touch_at = ?, updated_at = ? WHERE id = ?").run(now, now, leadId);
  db.prepare(`
    INSERT INTO touches (lead_id, template_id, draft, status, sent_day, created_at, sent_at)
    VALUES (?, ?, ?, 'sent', ?, ?, ?)
  `).run(leadId, templateId, draft, day, now, now);
}

export function markSkipped(leadId, templateId, draft, reason = '') {
  const now = nowIso();
  db.prepare(`
    INSERT INTO touches (lead_id, template_id, draft, status, note, created_at)
    VALUES (?, ?, ?, 'skipped', ?, ?)
  `).run(leadId, templateId, draft, reason, now);
}

export function markReplied(leadId, replyText, intent) {
  const now = nowIso();
  db.prepare("UPDATE leads SET status = 'replied', updated_at = ? WHERE id = ?").run(now, leadId);
  const last = db.prepare('SELECT id FROM touches WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId);
  if (last) {
    db.prepare('UPDATE touches SET reply_text = ?, reply_intent = ? WHERE id = ?').run(replyText, intent, last.id);
  } else {
    db.prepare(`
      INSERT INTO touches (lead_id, status, reply_text, reply_intent, created_at)
      VALUES (?, 'replied', ?, ?, ?)
    `).run(leadId, replyText, intent, now);
  }
}

export function listLeads({ status = '', limit = 50 } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY followers DESC, id ASC LIMIT ?').all(status, limit);
  }
  return db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ?').all(limit);
}

export function dbFile() {
  return DB_FILE;
}
