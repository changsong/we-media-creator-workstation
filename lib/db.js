'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.WB_DATA_DIR
  ? path.resolve(process.env.WB_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'workbench.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LEGACY_DIR = path.join(DATA_DIR, 'legacy');
const SCHEMA_VERSION = 6;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 主理人资料：单行记录，头像以 BLOB 直接存库
CREATE TABLE IF NOT EXISTS profile (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  name              TEXT NOT NULL,
  avatar_mime       TEXT,
  avatar_blob       BLOB,
  avatar_updated_at TEXT,
  updated_at        TEXT NOT NULL
);

-- 选题池
CREATE TABLE IF NOT EXISTS topics (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  platform      TEXT NOT NULL,
  angle         TEXT,
  status        TEXT NOT NULL DEFAULT '待写',
  score         REAL CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  tags          TEXT NOT NULL DEFAULT '[]',
  reference_url TEXT,
  created_on    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_platform ON topics(platform);
CREATE INDEX IF NOT EXISTS idx_topics_status   ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_score    ON topics(score DESC);

-- 内容日历（一条排期对应一个选题，选题删除后保留原编号，不级联）
CREATE TABLE IF NOT EXISTS schedules (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  topic_code  TEXT,
  title       TEXT NOT NULL,
  platform    TEXT NOT NULL,
  publish_at  TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT '选题确认',
  owner       TEXT,
  format      TEXT,
  publish_url TEXT,
  note        TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  original_claim  INTEGER NOT NULL DEFAULT 0,
  ai_generated    INTEGER NOT NULL DEFAULT 0,
  visibility      TEXT NOT NULL DEFAULT '公开',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_publish  ON schedules(publish_at);
CREATE INDEX IF NOT EXISTS idx_schedules_platform ON schedules(platform);
CREATE INDEX IF NOT EXISTS idx_schedules_stage    ON schedules(stage);
CREATE INDEX IF NOT EXISTS idx_schedules_topic    ON schedules(topic_code);

-- 数据复盘：同一条排期每天只允许一条快照
CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  schedule_code TEXT NOT NULL,
  platform     TEXT NOT NULL,
  stat_date    TEXT NOT NULL,
  reads        INTEGER DEFAULT 0 CHECK (reads IS NULL OR reads >= 0),
  likes        INTEGER DEFAULT 0 CHECK (likes IS NULL OR likes >= 0),
  followers    INTEGER DEFAULT 0,
  conversions  INTEGER DEFAULT 0 CHECK (conversions IS NULL OR conversions >= 0),
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (schedule_code, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_reviews_stat     ON reviews(stat_date);
CREATE INDEX IF NOT EXISTS idx_reviews_schedule ON reviews(schedule_code);
CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews(platform);

-- 素材库：正文与配图说明按 Markdown 原文存
CREATE TABLE IF NOT EXISTS assets (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  topic_code        TEXT,
  schedule_code     TEXT,
  title             TEXT NOT NULL,
  platform          TEXT,
  manuscript_md     TEXT,
  image_spec        TEXT,
  keywords          TEXT NOT NULL DEFAULT '[]',
  archived_on       TEXT,
  word_count        INTEGER CHECK (word_count IS NULL OR word_count >= 0),
  publish_url       TEXT,
  manuscript_doc_url TEXT,
  image_doc_url     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_topic    ON assets(topic_code);
CREATE INDEX IF NOT EXISTS idx_assets_schedule ON assets(schedule_code);
CREATE INDEX IF NOT EXISTS idx_assets_archive  ON assets(archived_on);

-- 语音速记：音频文件落盘到 data/recordings，元数据与转写文本存库
CREATE TABLE IF NOT EXISTS recordings (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  mime              TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  duration_sec      REAL NOT NULL DEFAULT 0,
  transcript        TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'none',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at);

-- 发布素材：视频落盘到 data/videos，图片落盘到 data/images；schedule_id 为 schedules.id
CREATE TABLE IF NOT EXISTS media (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('video','image')),
  role         TEXT NOT NULL DEFAULT 'content',
  file_name    TEXT NOT NULL,
  original_name TEXT,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  schedule_id  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_schedule ON media(schedule_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_created  ON media(created_at);

-- 发布任务素材快照：任务创建时固定顺序，之后修改日历不影响已排队任务
CREATE TABLE IF NOT EXISTS publish_task_media (
  task_id    TEXT NOT NULL,
  media_id   TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_ptm_task ON publish_task_media(task_id, sort_order);

-- 发布任务：把一条排期、一组素材和发布参数排队交给渠道适配器执行
CREATE TABLE IF NOT EXISTS publish_tasks (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  schedule_code TEXT NOT NULL,
  platform      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  scheduled_at  TEXT,
  mode          TEXT NOT NULL DEFAULT 'confirm',
  status        TEXT NOT NULL DEFAULT 'draft',
  publish_url   TEXT,
  work_id       TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT,
  finished_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_status    ON publish_tasks(status);
CREATE INDEX IF NOT EXISTS idx_publish_scheduled ON publish_tasks(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_publish_schedule  ON publish_tasks(schedule_code);

-- 业务编号计数器：只增不减，删除记录后编号不复用
CREATE TABLE IF NOT EXISTS sequences (
  table_key TEXT PRIMARY KEY,
  month     TEXT NOT NULL,
  value     INTEGER NOT NULL
);
`;

let db = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(LEGACY_DIR, { recursive: true });
}

function open() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(DDL);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  } else if (Number(row.value) > SCHEMA_VERSION) {
    throw new Error(`数据文件版本 ${row.value} 高于当前程序支持的 ${SCHEMA_VERSION}，请升级程序`);
  } else if (Number(row.value) < SCHEMA_VERSION) {
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(SCHEMA_VERSION), 'schema_version');
  }
  return db;
}

function close() {
  if (!db) return;
  try {
    db.close();
  } catch (err) {
    /* 已关闭 */
  }
  db = null;
}

function transaction(fn) {
  const conn = open();
  conn.exec('BEGIN');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch (e) {
      /* 事务已经结束 */
    }
    throw err;
  }
}

/** 每天第一次写入前做一次整库快照，保留 7 天 */
function backupDaily() {
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `workbench-${day}.db`);
  if (fs.existsSync(target)) return null;
  try {
    open().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const olds = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^workbench-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    while (olds.length > 7) {
      fs.unlinkSync(path.join(BACKUP_DIR, olds.shift()));
    }
    return target;
  } catch (err) {
    console.warn('[db] 备份失败：', err.message);
    return null;
  }
}

function integrity() {
  const conn = open();
  const checks = conn.prepare('PRAGMA integrity_check').all();
  return checks.map((r) => r.integrity_check).join('; ');
}

/**
 * 一次性迁移：放开 reviews.followers 的非负约束，使「净增粉」可记录负值（取关多于新增的日子）。
 * 仅当建表语句里仍带 followers >= 0 的 CHECK 时才重建，已迁移/新建库直接跳过。
 */
function tableExists(conn, name) {
  return !!conn
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

/**
 * 一次性迁移：旧版 videos 表 + publish_tasks.video_id → 统一的 media 表与 publish_task_media。
 * 按实际表结构判断，可重复执行；素材 ID 保持不变，任务与素材文件不受影响。
 */
function migrateMedia() {
  const conn = open();
  const hasVideos = tableExists(conn, 'videos');
  const taskCols = conn.prepare('PRAGMA table_info(publish_tasks)').all().map((r) => r.name);
  const hasVideoId = taskCols.indexOf('video_id') >= 0;
  if (!hasVideos && !hasVideoId) return null;

  const report = { videos: 0, tasks: 0, droppedVideos: false };
  conn.exec('BEGIN');
  try {
    if (hasVideos) {
      const before = conn.prepare('SELECT COUNT(*) AS n FROM videos').get().n;
      conn.exec(`
        INSERT OR IGNORE INTO media
          (id, kind, file_name, original_name, mime, size_bytes, duration_sec, schedule_id, sort_order, created_at)
        SELECT id, 'video', file_name, original_name, mime, size_bytes, duration_sec, NULL, 0, created_at
        FROM videos
      `);
      const copied = conn
        .prepare('SELECT COUNT(*) AS n FROM media WHERE id IN (SELECT id FROM videos)')
        .get().n;
      if (copied !== before) {
        throw new Error(`素材迁移校验失败：videos ${before} 条，media ${copied} 条`);
      }
      report.videos = before;
    }

    if (hasVideoId) {
      conn.exec(`
        INSERT OR IGNORE INTO publish_task_media (task_id, media_id, sort_order)
        SELECT id, video_id, 0 FROM publish_tasks WHERE video_id IS NOT NULL AND video_id <> ''
      `);
      report.tasks = conn.prepare('SELECT COUNT(*) AS n FROM publish_task_media').get().n;
      conn.exec(`
        CREATE TABLE publish_tasks_new (
          id            TEXT PRIMARY KEY,
          code          TEXT NOT NULL UNIQUE,
          schedule_code TEXT NOT NULL,
          platform      TEXT NOT NULL,
          title         TEXT NOT NULL,
          description   TEXT,
          tags          TEXT NOT NULL DEFAULT '[]',
          scheduled_at  TEXT,
          mode          TEXT NOT NULL DEFAULT 'confirm',
          status        TEXT NOT NULL DEFAULT 'draft',
          publish_url   TEXT,
          work_id       TEXT,
          error         TEXT,
          attempts      INTEGER NOT NULL DEFAULT 0,
          started_at    TEXT,
          finished_at   TEXT,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
        INSERT INTO publish_tasks_new
          (id, code, schedule_code, platform, title, description, tags, scheduled_at, mode, status,
           publish_url, work_id, error, attempts, started_at, finished_at, created_at, updated_at)
        SELECT id, code, schedule_code, platform, title, description, tags, scheduled_at, mode, status,
               publish_url, work_id, error, attempts, started_at, finished_at, created_at, updated_at
        FROM publish_tasks;
        DROP TABLE publish_tasks;
        ALTER TABLE publish_tasks_new RENAME TO publish_tasks;
        CREATE INDEX IF NOT EXISTS idx_publish_status    ON publish_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_publish_scheduled ON publish_tasks(scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_publish_schedule  ON publish_tasks(schedule_code);
      `);
    }

    if (hasVideos) {
      conn.exec('DROP TABLE videos');
      report.droppedVideos = true;
    }

    conn.exec('COMMIT');
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch (e) {
      /* 事务已经结束 */
    }
    throw err;
  }
  return report;
}

/** 旧库补齐 media.role：content（正文素材）/ cover（封面），默认 content */
function ensureMediaRole() {
  const conn = open();
  const cols = conn.prepare('PRAGMA table_info(media)').all().map((r) => r.name);
  if (cols.indexOf('role') >= 0) return false;
  conn.exec("ALTER TABLE media ADD COLUMN role TEXT NOT NULL DEFAULT 'content'");
  return true;
}

/** 旧库补齐 schedules 的发布设置字段：标签 / 原创声明 / AI 生成 / 可见范围 */
function ensureScheduleFields() {
  const conn = open();
  const cols = conn.prepare('PRAGMA table_info(schedules)').all().map((r) => r.name);
  const additions = [
    ['tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['original_claim', 'INTEGER NOT NULL DEFAULT 0'],
    ['ai_generated', 'INTEGER NOT NULL DEFAULT 0'],
    ['visibility', "TEXT NOT NULL DEFAULT '公开'"]
  ];
  const added = [];
  additions.forEach(([name, def]) => {
    if (cols.indexOf(name) >= 0) return;
    conn.exec(`ALTER TABLE schedules ADD COLUMN ${name} ${def}`);
    added.push(name);
  });
  return added;
}

/** 内容日历平台改为多选后，把旧的单值字符串转成 JSON 数组 */
function ensureCalendarPlatformJson() {
  const conn = open();
  const rows = conn.prepare('SELECT id, platform FROM schedules').all();
  const upd = conn.prepare('UPDATE schedules SET platform = ? WHERE id = ?');
  let changed = 0;
  rows.forEach((row) => {
    const raw = row.platform == null ? '' : String(row.platform).trim();
    if (raw.charAt(0) === '[') {
      try {
        if (Array.isArray(JSON.parse(raw))) return;
      } catch (err) {
        /* 非法 JSON，按单值转换 */
      }
    }
    upd.run(JSON.stringify(raw ? [raw] : []), row.id);
    changed++;
  });
  return changed;
}

function relaxFollowersCheck() {
  const conn = open();
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").get();
  const createSql = row && row.sql ? row.sql : '';
  if (!/followers\s+INTEGER[^,]*CHECK\s*\(\s*followers[^)]*>=?\s*0\s*\)/i.test(createSql)) {
    return false;
  }
  conn.exec(`
    CREATE TABLE reviews_new (
      id            TEXT PRIMARY KEY,
      code          TEXT NOT NULL UNIQUE,
      schedule_code TEXT NOT NULL,
      platform      TEXT NOT NULL,
      stat_date     TEXT NOT NULL,
      reads         INTEGER DEFAULT 0 CHECK (reads IS NULL OR reads >= 0),
      likes         INTEGER DEFAULT 0 CHECK (likes IS NULL OR likes >= 0),
      followers     INTEGER DEFAULT 0,
      conversions   INTEGER DEFAULT 0 CHECK (conversions IS NULL OR conversions >= 0),
      note          TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (schedule_code, stat_date)
    );
    INSERT INTO reviews_new
      (id, code, schedule_code, platform, stat_date, reads, likes, followers, conversions, note, created_at, updated_at)
    SELECT
      id, code, schedule_code, platform, stat_date, reads, likes, followers, conversions, note, created_at, updated_at
    FROM reviews;
    DROP TABLE reviews;
    ALTER TABLE reviews_new RENAME TO reviews;
    CREATE INDEX IF NOT EXISTS idx_reviews_stat     ON reviews(stat_date);
    CREATE INDEX IF NOT EXISTS idx_reviews_schedule ON reviews(schedule_code);
    CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews(platform);
  `);
  return true;
}

module.exports = {
  open,
  close,
  transaction,
  backupDaily,
  integrity,
  relaxFollowersCheck,
  ensureMediaRole,
  ensureScheduleFields,
  ensureCalendarPlatformJson,
  migrateMedia,
  DATA_DIR,
  DB_FILE,
  BACKUP_DIR,
  LEGACY_DIR,
  SCHEMA_VERSION
};
