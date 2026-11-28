import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, ensureDir, nowIso, todayKey } from './util.mjs';

const DB_FILE = process.env.MARKETING_DB || path.join(DATA_DIR, 'marketing.db');
ensureDir(path.dirname(DB_FILE));

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS comment_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    video_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL DEFAULT '',
    author_url TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    keyword TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, video_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    parent_comment_id TEXT NOT NULL DEFAULT '',
    root_comment_id TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL DEFAULT '',
    author_url TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    thread_text TEXT NOT NULL DEFAULT '',
    likes INTEGER NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL DEFAULT '',
    intent TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    draft TEXT NOT NULL DEFAULT '',
    draft_model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, comment_id)
  );
  CREATE TABLE IF NOT EXISTS comment_touches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    draft TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sent_day TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, score, likes);
  CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform, status);
  CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, id);
  CREATE INDEX IF NOT EXISTS idx_comments_dedupe ON comments(platform, video_id, author_id);
  CREATE INDEX IF NOT EXISTS idx_comment_touches_day ON comment_touches(action, sent_day, platform);
  CREATE TABLE IF NOT EXISTS collect_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    keyword TEXT NOT NULL,
    video_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    comments INTEGER NOT NULL DEFAULT 0,
    comment_limit INTEGER NOT NULL DEFAULT -1,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, keyword, video_id)
  );
  CREATE INDEX IF NOT EXISTS idx_collect_progress ON collect_progress(platform, keyword, status);
`);

const progressColumns = db.prepare('PRAGMA table_info(collect_progress)').all().map((col) => col.name);
if (!progressColumns.includes('comment_limit')) {
  db.exec('ALTER TABLE collect_progress ADD COLUMN comment_limit INTEGER NOT NULL DEFAULT -1');
}

const ALLOWED_STATUS = new Set(['new', 'ignored', 'drafted', 'queued', 'sent', 'skipped', 'blocked']);

const toInt = (value) => {
  const n = Number(String(value == null ? 0 : value).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function commentKey(comment, videoRowId) {
  if (comment.comment_id) return String(comment.comment_id);
  // 兜底 ID 不包含相对时间（1天前/1周前会变），避免跨天重跑产生重复评论。
  const raw = [
    comment.platform || '',
    videoRowId || '',
    comment.author_id || comment.author || '',
    comment.text || '',
  ].join('|');
  return 'h_' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

export function upsertVideo(video) {
  const now = nowIso();
  const platform = String(video.platform || '').trim();
  const videoId = String(video.video_id || '').trim();
  if (!platform || !videoId) throw new Error('视频缺少 platform / video_id');
  const existing = db.prepare('SELECT id FROM comment_videos WHERE platform = ? AND video_id = ?').get(platform, videoId);
  const values = [
    String(video.video_url || ''),
    String(video.title || ''),
    String(video.description || ''),
    String(video.author || ''),
    String(video.author_id || ''),
    String(video.author_url || ''),
    String(video.published_at || ''),
    toInt(video.like_count),
    toInt(video.comment_count),
    String(video.keyword || ''),
  ];
  if (existing) {
    db.prepare(`
      UPDATE comment_videos SET video_url = ?, title = ?, description = ?, author = ?, author_id = ?,
        author_url = ?, published_at = ?, like_count = ?, comment_count = ?, keyword = ?, updated_at = ?
      WHERE id = ?
    `).run(...values, now, existing.id);
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO comment_videos (platform, video_id, video_url, title, description, author, author_id,
      author_url, published_at, like_count, comment_count, keyword, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(platform, videoId, ...values, now, now);
  return Number(info.lastInsertRowid);
}

export function upsertComment(videoRowId, comment, { intent = '', score = 0, status = 'new' } = {}) {
  const now = nowIso();
  const platform = String(comment.platform || '').trim();
  const key = commentKey(comment, videoRowId);
  const authorId = String(comment.author_id || '');
  const author = String(comment.author || '');
  const text = String(comment.text || '');
  const values = [
    Number(videoRowId),
    platform,
    key,
    String(comment.parent_comment_id || ''),
    String(comment.root_comment_id || key),
    author,
    authorId,
    String(comment.author_url || ''),
    text,
    String(comment.thread_text || ''),
    toInt(comment.likes),
    String(comment.published_at || ''),
  ];
  // 先按「同视频 + 同作者 + 同内容」判重，再按平台评论 ID 判重。
  // 这样即使平台改版导致 comment_id 变化，也不会重复入库。
  const existing = db.prepare(`
    SELECT id FROM comments
    WHERE platform = ? AND video_id = ? AND text = ?
      AND ((author_id <> '' AND author_id = ?) OR (author_id = '' AND author = ?))
    LIMIT 1
  `).get(platform, Number(videoRowId), text, authorId, author)
    || db.prepare('SELECT id FROM comments WHERE platform = ? AND comment_id = ?').get(platform, key);
  if (existing) {
    db.prepare(`
      UPDATE comments SET
        likes = ?, text = ?, thread_text = ?,
        intent = CASE WHEN status IN ('new', 'ignored') THEN ? ELSE intent END,
        score = CASE WHEN status IN ('new', 'ignored') THEN ? ELSE score END,
        status = CASE WHEN status = 'ignored' AND ? = 'new' THEN 'new' ELSE status END,
        updated_at = ?
      WHERE id = ?
    `).run(
      toInt(comment.likes),
      String(comment.text || ''),
      String(comment.thread_text || ''),
      intent,
      toInt(score),
      status,
      now,
      existing.id
    );
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO comments (video_id, platform, comment_id, parent_comment_id, root_comment_id,
      author, author_id, author_url, text, thread_text, likes, published_at, intent, score, status,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ...values,
    intent,
    toInt(score),
    ALLOWED_STATUS.has(status) ? status : 'new',
    now,
    now
  );
  return Number(info.lastInsertRowid);
}

export function getComment(id) {
  return db.prepare(`
    SELECT c.*, v.title AS video_title, v.description AS video_description, v.video_url,
      v.author AS video_author, v.author_id AS video_author_id, v.keyword AS video_keyword,
      v.platform AS video_platform
    FROM comments c
    JOIN comment_videos v ON v.id = c.video_id
    WHERE c.id = ?
  `).get(id) || null;
}

export function getCommentByKey(platform, commentId) {
  return db.prepare(`
    SELECT c.*, v.title AS video_title, v.video_url, v.author AS video_author, v.keyword AS video_keyword
    FROM comments c
    JOIN comment_videos v ON v.id = c.video_id
    WHERE c.platform = ? AND c.comment_id = ?
  `).get(platform, String(commentId)) || null;
}

export function listComments({
  status = '',
  statuses = [],
  platform = '',
  intent = '',
  search = '',
  limit = 50,
  includeIgnored = false,
} = {}) {
  const clauses = [];
  const params = [];
  if (statuses.length) {
    clauses.push(`c.status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  } else if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  } else if (!includeIgnored) {
    clauses.push("c.status <> 'ignored'");
  }
  if (platform) {
    clauses.push('c.platform = ?');
    params.push(platform);
  }
  if (intent) {
    clauses.push('c.intent = ?');
    params.push(intent);
  }
  if (search) {
    const like = `%${search}%`;
    clauses.push('(c.text LIKE ? OR c.author LIKE ? OR v.title LIKE ?)');
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(Math.max(1, Math.min(Number(limit) || 50, 500)));
  return db.prepare(`
    SELECT c.*, v.title AS video_title, v.description AS video_description, v.video_url,
      v.author AS video_author, v.author_id AS video_author_id, v.keyword AS video_keyword
    FROM comments c
    JOIN comment_videos v ON v.id = c.video_id
    ${where}
    ORDER BY c.score DESC, c.likes DESC, c.published_at DESC, c.id DESC
    LIMIT ?
  `).all(...params);
}

export function listQualifiedComments({ platform = '', intent = '', limit = 200 } = {}) {
  const clauses = ["c.status IN ('new', 'drafted', 'sent')", "c.intent <> ''"];
  const params = [];
  if (platform) {
    clauses.push('c.platform = ?');
    params.push(platform);
  }
  if (intent) {
    clauses.push('c.intent = ?');
    params.push(intent);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 200, 1000)));
  return db.prepare(`
    SELECT c.*, v.title AS video_title, v.description AS video_description, v.video_url,
      v.author AS video_author, v.author_id AS video_author_id, v.keyword AS video_keyword,
      v.published_at AS video_published_at
    FROM comments c
    JOIN comment_videos v ON v.id = c.video_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY v.id DESC, c.score DESC, c.likes DESC, c.id ASC
    LIMIT ?
  `).all(...params);
}

export function queueComments({
  limit = 20,
  platform = '',
  excludePlatforms = [],
  minScore = 0,
} = {}) {
  const clauses = ["c.status IN ('new', 'drafted', 'queued')", 'c.score >= ?'];
  const params = [Number(minScore) || 0];
  if (platform) {
    clauses.push('c.platform = ?');
    params.push(platform);
  }
  if (excludePlatforms.length) {
    clauses.push(`c.platform NOT IN (${excludePlatforms.map(() => '?').join(', ')})`);
    params.push(...excludePlatforms);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 20, 200)));
  return db.prepare(`
    SELECT c.*, v.title AS video_title, v.description AS video_description, v.video_url,
      v.author AS video_author, v.author_id AS video_author_id, v.keyword AS video_keyword
    FROM comments c
    JOIN comment_videos v ON v.id = c.video_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY c.score DESC, c.likes DESC, c.published_at DESC, c.id DESC
    LIMIT ?
  `).all(...params);
}

export function saveDraft(id, draft, model = '') {
  const now = nowIso();
  return db.prepare(`
    UPDATE comments SET draft = ?, draft_model = ?, updated_at = ?,
      status = CASE WHEN status IN ('new', 'queued') THEN 'drafted' ELSE status END
    WHERE id = ?
  `).run(String(draft || ''), String(model || ''), now, id).changes > 0;
}

export function markCommentSent(id, draft = '') {
  const now = nowIso();
  const day = todayKey();
  const comment = db.prepare('SELECT platform FROM comments WHERE id = ?').get(id);
  if (!comment) return false;
  db.prepare("UPDATE comments SET status = 'sent', draft = ?, updated_at = ? WHERE id = ?")
    .run(String(draft || ''), now, id);
  db.prepare(`
    INSERT INTO comment_touches (comment_id, platform, action, draft, sent_day, created_at)
    VALUES (?, ?, 'sent', ?, ?, ?)
  `).run(id, comment.platform || '', String(draft || ''), day, now);
  return true;
}

export function markCommentSkipped(id, reason = '') {
  const now = nowIso();
  const comment = db.prepare('SELECT platform FROM comments WHERE id = ?').get(id);
  if (!comment) return false;
  db.prepare("UPDATE comments SET status = 'skipped', updated_at = ? WHERE id = ?").run(now, id);
  db.prepare(`
    INSERT INTO comment_touches (comment_id, platform, action, note, created_at)
    VALUES (?, ?, 'skipped', ?, ?)
  `).run(id, comment.platform || '', String(reason || ''), now);
  return true;
}

export function commentsForRescore() {
  return db.prepare("SELECT id, text FROM comments WHERE status IN ('new', 'ignored')").all();
}

export function updateCommentScore(id, intent, score, status) {
  return db.prepare(`
    UPDATE comments SET intent = ?, score = ?, status = ?, updated_at = ?
    WHERE id = ? AND status IN ('new', 'ignored')
  `).run(String(intent || ''), toInt(score), status, nowIso(), id).changes > 0;
}

export function setCommentStatus(id, status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`未知状态 ${status}，可选：${[...ALLOWED_STATUS].join(', ')}`);
  }
  return db.prepare('UPDATE comments SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), id).changes > 0;
}

export function todaySentCount(platform = '') {
  const sql = platform
    ? "SELECT COUNT(*) AS count FROM comment_touches WHERE action = 'sent' AND sent_day = ? AND platform = ?"
    : "SELECT COUNT(*) AS count FROM comment_touches WHERE action = 'sent' AND sent_day = ?";
  const row = platform
    ? db.prepare(sql).get(todayKey(), platform)
    : db.prepare(sql).get(todayKey());
  return row ? row.count : 0;
}

export function videoSentCount(videoRowId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM comment_touches t
    JOIN comments c ON c.id = t.comment_id
    WHERE t.action = 'sent' AND c.video_id = ?
  `).get(videoRowId);
  return row ? row.count : 0;
}

export function lastUserTouch(platform, authorId) {
  if (!platform || !authorId) return null;
  const row = db.prepare(`
    SELECT MAX(t.created_at) AS last_at
    FROM comment_touches t
    JOIN comments c ON c.id = t.comment_id
    WHERE t.action = 'sent' AND c.platform = ? AND c.author_id = ?
  `).get(platform, String(authorId));
  return row && row.last_at ? row.last_at : null;
}

export function recentDrafts(limit = 30) {
  return db.prepare(`
    SELECT draft FROM comments
    WHERE draft <> ''
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 30, 200))).map((row) => row.draft);
}

export function commentStats() {
  const total = db.prepare('SELECT COUNT(*) AS count FROM comments').get().count;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM comments GROUP BY status ORDER BY count DESC').all();
  const byPlatform = db.prepare(`
    SELECT platform,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status IN ('drafted', 'queued') THEN 1 ELSE 0 END) AS drafted,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM comments
    GROUP BY platform
    ORDER BY total DESC
  `).all();
  const byIntent = db.prepare(`
    SELECT intent, COUNT(*) AS count FROM comments
    WHERE intent <> '' AND status <> 'ignored'
    GROUP BY intent ORDER BY count DESC
  `).all();
  const sentToday = todaySentCount();
  const sentTotal = db.prepare("SELECT COUNT(*) AS count FROM comment_touches WHERE action = 'sent'").get().count;
  const videos = db.prepare('SELECT COUNT(*) AS count FROM comment_videos').get().count;
  return { total, videos, sentToday, sentTotal, byStatus, byPlatform, byIntent };
}

const PROGRESS_STATUS = new Set(['pending', 'in_progress', 'done', 'skipped', 'error']);

export function ensureCollectProgress(platform, keyword, videoId) {
  const now = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO collect_progress (platform, keyword, video_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(String(platform), String(keyword), String(videoId), now, now);
}

export function getCollectProgress(platform, keyword, videoId) {
  return db.prepare(`
    SELECT * FROM collect_progress
    WHERE platform = ? AND keyword = ? AND video_id = ?
  `).get(String(platform), String(keyword), String(videoId)) || null;
}

export function setCollectProgress(platform, keyword, videoId, status, { comments = 0, error = '', commentLimit = -1 } = {}) {
  if (!PROGRESS_STATUS.has(status)) throw new Error(`未知进度状态 ${status}`);
  const now = nowIso();
  db.prepare(`
    INSERT INTO collect_progress (platform, keyword, video_id, status, comments, comment_limit, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, keyword, video_id) DO UPDATE SET
      status = excluded.status,
      comments = excluded.comments,
      comment_limit = excluded.comment_limit,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    String(platform),
    String(keyword),
    String(videoId),
    status,
    Number(comments) || 0,
    Number(commentLimit),
    String(error || ''),
    now,
    now
  );
}

export function collectProgressSummary({ platform = '', keyword = '' } = {}) {
  const clauses = [];
  const params = [];
  if (platform) {
    clauses.push('platform = ?');
    params.push(platform);
  }
  if (keyword) {
    clauses.push('keyword = ?');
    params.push(keyword);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT platform, keyword,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS pending,
      SUM(comments) AS comments
    FROM collect_progress
    ${where}
    GROUP BY platform, keyword
    ORDER BY platform, keyword
  `).all(...params);
}

export function resetCollectProgress({ platform = '', keyword = '' } = {}) {
  const clauses = [];
  const params = [];
  if (platform) {
    clauses.push('platform = ?');
    params.push(platform);
  }
  if (keyword) {
    clauses.push('keyword = ?');
    params.push(keyword);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`DELETE FROM collect_progress ${where}`).run(...params).changes;
}

export function dbFile() {
  return DB_FILE;
}
