import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, detectPlatform, ensureDir, normalizePlatform, nowIso, todayKey } from './util.mjs';

const DB_FILE = process.env.MARKETING_DB || path.join(DATA_DIR, 'marketing.db');
ensureDir(path.dirname(DB_FILE));

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL DEFAULT 'douyin',
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

// 老库迁移：补 platform / extra 列（新库建表时已包含）。
const leadColumns = db.prepare('PRAGMA table_info(leads)').all().map((col) => col.name);
if (!leadColumns.includes('platform')) {
  db.exec("ALTER TABLE leads ADD COLUMN platform TEXT NOT NULL DEFAULT 'douyin'");
}
if (!leadColumns.includes('extra')) {
  db.exec("ALTER TABLE leads ADD COLUMN extra TEXT NOT NULL DEFAULT ''");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform, status, last_touch_at)');

const ALLOWED_STATUS = new Set(['new', 'queued', 'sent', 'replied', 'converted', 'blocked']);

const toInt = (value) => {
  const n = Number(String(value || '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function importLeads(rows) {
  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO leads (platform, profile_url, nickname, followers, last_active, niche, source, note, extra, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
  `);
  const update = db.prepare(`
    UPDATE leads SET nickname = ?, followers = ?, last_active = ?, niche = ?, source = ?, note = ?, extra = ?, platform = ?, updated_at = ?
    WHERE profile_url = ?
  `);
  const find = db.prepare('SELECT id, platform FROM leads WHERE profile_url = ?');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const byPlatform = {};
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
    const extra = String(row.extra || '').trim();
    const detected = normalizePlatform(row.platform) || detectPlatform(profileUrl);
    const existing = find.get(profileUrl);
    if (existing) {
      const platform = detected || existing.platform || 'unknown';
      update.run(nickname, followers, lastActive, niche, source, note, extra, platform, now, profileUrl);
      updated++;
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    } else {
      const platform = detected || 'unknown';
      insert.run(platform, profileUrl, nickname, followers, lastActive, niche, source, note, extra, now, now);
      inserted++;
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    }
  }
  return { inserted, updated, skipped, byPlatform };
}

export function stats() {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM leads GROUP BY status ORDER BY count DESC').all();
  const total = db.prepare('SELECT COUNT(*) AS count FROM leads').get().count;
  const sentToday = db.prepare("SELECT COUNT(*) AS count FROM touches WHERE status = 'sent' AND sent_day = ?").get(todayKey()).count;
  const replied = db.prepare("SELECT COUNT(DISTINCT lead_id) AS count FROM touches WHERE reply_text <> ''").get().count;
  const converted = db.prepare("SELECT COUNT(*) AS count FROM leads WHERE status = 'converted'").get().count;
  const byPlatform = db.prepare(`
    SELECT platform,
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('sent', 'replied', 'converted') THEN 1 ELSE 0 END) AS contacted,
      SUM(CASE WHEN status IN ('replied', 'converted') THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
    FROM leads
    GROUP BY platform
    ORDER BY total DESC
  `).all();
  return { total, byStatus, sentToday, replied, converted, byPlatform };
}

export function queue({ limit = 20, cooldownDays = 30, minFollowers = 0, maxFollowers = 0, platform = '' } = {}) {
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  const clauses = ["status IN ('new', 'queued')", 'followers >= ?'];
  const params = [minFollowers];
  if (maxFollowers > 0) {
    clauses.push('followers <= ?');
    params.push(maxFollowers);
  }
  if (platform) {
    clauses.push('platform = ?');
    params.push(platform);
  }
  clauses.push('(last_touch_at IS NULL OR last_touch_at < ?)');
  params.push(cutoff);
  params.push(limit);
  return db.prepare(`
    SELECT * FROM leads
    WHERE ${clauses.join(' AND ')}
    ORDER BY followers DESC, id ASC
    LIMIT ?
  `).all(...params);
}

export function getLead(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) || null;
}

export function setLeadStatus(leadId, status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`未知状态 ${status}，可选：${[...ALLOWED_STATUS].join(', ')}`);
  }
  const now = nowIso();
  const result = db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, now, leadId);
  return result.changes > 0;
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

export function listLeads({ status = '', platform = '', search = '', limit = 50 } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (platform) {
    clauses.push('platform = ?');
    params.push(platform);
  }
  if (search) {
    const like = `%${search}%`;
    clauses.push('(nickname LIKE ? OR profile_url LIKE ? OR niche LIKE ?)');
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return db.prepare(`SELECT * FROM leads ${where} ORDER BY followers DESC, id ASC LIMIT ?`).all(...params);
}

export function findLeadByUrl(profileUrl) {
  const url = String(profileUrl || '').trim();
  if (!url) return null;
  return db.prepare('SELECT nickname, followers FROM leads WHERE profile_url = ?').get(url) || null;
}

export function updateLeadFollowers(profileUrl, followers) {
  const url = String(profileUrl || '').trim();
  const count = toInt(followers);
  if (!url) return false;
  return db.prepare('UPDATE leads SET followers = ?, updated_at = ? WHERE profile_url = ?').run(count, nowIso(), url).changes > 0;
}

export function kuaishouLeadsWithoutFollowers(limit = 0) {
  const sql = "SELECT id, profile_url, nickname FROM leads WHERE platform = 'kuaishou' AND followers = 0 ORDER BY id ASC" + (limit > 0 ? ' LIMIT ?' : '');
  return limit > 0 ? db.prepare(sql).all(limit) : db.prepare(sql).all();
}

export function kuaishouFollowerStats() {
  return db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN followers > 0 THEN 1 ELSE 0 END) AS known,
      SUM(CASE WHEN followers = 0 THEN 1 ELSE 0 END) AS unknown
    FROM leads WHERE platform = 'kuaishou'
  `).get();
}

export function dbFile() {
  return DB_FILE;
}
