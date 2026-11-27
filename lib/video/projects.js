'use strict';

/**
 * 视频工坊数据层：项目 / 脚本版本 / 分镜 / 角色。
 *
 * 数据按账号隔离，素材目录为 <账号数据根>/video/<项目编号>/，
 * 下分 assets（生成素材）、segments（场景片段）、final（成片）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const ASPECTS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
};
const FPS = 30;
const STATUSES = ['draft', 'briefing', 'scripting', 'storyboarding', 'rendering', 'done'];
const RENDER_MODES = ['image', 'video'];
const SCENE_STATUSES = ['pending', 'generating', 'ready', 'failed', 'locked'];

function now() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function conn() {
  return db.open();
}

function safeJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function clipText(v, max) {
  const s = v == null ? '' : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function projectRoot(code) {
  return path.join(db.accountRoot(), 'video', code);
}

function ensureProjectDirs(code) {
  ['assets', 'segments', 'final'].forEach((sub) => {
    fs.mkdirSync(path.join(projectRoot(code), sub), { recursive: true });
  });
}

function newCode() {
  const d = new Date();
  const day = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  for (let i = 0; i < 5; i++) {
    const code = 'VP-' + day + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const hit = conn().prepare('SELECT 1 AS ok FROM video_projects WHERE code = ?').get(code);
    if (!hit) return code;
  }
  return 'VP-' + day + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function mapProject(row) {
  return {
    id: row.id,
    code: row.code,
    topicCode: row.topic_code || '',
    topicTitle: row.topic_title || '',
    title: row.title,
    status: row.status,
    aspect: row.aspect,
    width: row.width,
    height: row.height,
    fps: row.fps,
    style: row.style || '',
    brief: row.brief || '',
    provider: safeJSON(row.provider, {}),
    settings: safeJSON(row.settings, {}),
    sceneCount: row.scene_count == null ? undefined : Number(row.scene_count),
    scriptVersion: row.script_version == null ? undefined : Number(row.script_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapScene(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    idx: row.idx,
    title: row.title || '',
    durationMs: row.duration_ms,
    shot: row.shot || '',
    camera: row.camera || '',
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    narration: row.narration || '',
    onScreenText: row.on_screen_text || '',
    characterIds: safeJSON(row.character_ids, []),
    transition: row.transition || '',
    renderMode: row.render_mode,
    status: row.status,
    imageAssetId: row.image_asset_id,
    videoAssetId: row.video_asset_id,
    audioAssetId: row.audio_asset_id,
    segmentAssetId: row.segment_asset_id,
    paramsHash: row.params_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCharacter(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description || '',
    refs: safeJSON(row.refs, []),
    anchorAssetId: row.anchor_asset_id,
    style: row.style || '',
    anchors: safeJSON(row.anchors, []),
    profile: safeJSON(row.profile, {}) || {},
    voiceId: row.voice_id || '',
    seed: row.seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapScript(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    contentMd: row.content_md,
    scenes: safeJSON(row.scenes_json, []),
    source: row.source,
    note: row.note || '',
    createdAt: row.created_at
  };
}

/* ---------------- 项目 ---------------- */

function listProjects() {
  const rows = conn()
    .prepare(
      `SELECT p.*, t.title AS topic_title,
        (SELECT COUNT(*) FROM video_scenes s WHERE s.project_id = p.id) AS scene_count,
        (SELECT MAX(version) FROM video_script_versions v WHERE v.project_id = p.id) AS script_version
       FROM video_projects p
       LEFT JOIN topics t ON t.code = p.topic_code
       ORDER BY p.updated_at DESC`
    )
    .all();
  return rows.map(mapProject);
}

function getProjectRow(id) {
  return conn().prepare('SELECT * FROM video_projects WHERE id = ?').get(id);
}

function getProject(id) {
  const row = getProjectRow(id);
  if (!row) return null;
  const project = mapProject(row);
  const topic = project.topicCode
    ? conn().prepare('SELECT title FROM topics WHERE code = ?').get(project.topicCode)
    : null;
  project.topicTitle = topic ? topic.title : '';
  project.characters = listCharacters();
  project.scenes = listScenes(id);
  project.script = getLatestScript(id);
  project.versions = conn()
    .prepare('SELECT version, source, note, created_at FROM video_script_versions WHERE project_id = ? ORDER BY version DESC')
    .all(id)
    .map((v) => ({ version: v.version, source: v.source, note: v.note || '', createdAt: v.created_at }));
  const lastRender = conn()
    .prepare(
      `SELECT id, output_asset_id, status, created_at FROM video_renders
       WHERE project_id = ? AND status = 'done' AND output_asset_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(id);
  project.outputAssetId = lastRender ? lastRender.output_asset_id : '';
  project.lastRenderId = lastRender ? lastRender.id : '';
  project.outputCreatedAt = lastRender ? lastRender.created_at : '';
  return project;
}

function createProject(input) {
  const body = input || {};
  let topic = null;
  if (body.topicCode) {
    topic = conn()
      .prepare('SELECT code, title, angle, reference_url, source_text FROM topics WHERE code = ?')
      .get(String(body.topicCode).trim());
  }
  const title = clipText(body.title || (topic && topic.title) || '', 120).trim() || '未命名视频';
  const aspect = ASPECTS[body.aspect] ? body.aspect : '16:9';
  const size = ASPECTS[aspect];
  const id = uid();
  const code = newCode();
  const ts = now();
  const briefParts = [];
  const sourceText = topic && topic.source_text ? String(topic.source_text).trim() : '';
  if (sourceText) {
    // 选题里已有完整参考文案时，创作简报只放文案本身，不再拼接选题/切入角度等其它信息
    briefParts.push(sourceText);
  } else if (topic) {
    briefParts.push('选题：' + topic.title);
    if (topic.angle) briefParts.push('切入角度：' + topic.angle);
    if (topic.reference_url) briefParts.push('参考链接：' + topic.reference_url);
  }
  if (body.brief) {
    const extra = String(body.brief).trim();
    if (extra && briefParts.indexOf(extra) < 0) briefParts.push(extra);
  }
  const brief = clipText(briefParts.join('\n'), 30000);

  db.transaction((c) => {
    c.prepare(
      `INSERT INTO video_projects
        (id, code, topic_code, title, status, aspect, width, height, fps, style, brief, provider, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`
    ).run(
      id,
      code,
      topic ? topic.code : null,
      title,
      aspect,
      size.width,
      size.height,
      FPS,
      clipText(body.style || '', 500),
      brief,
      ts,
      ts
    );
    c.prepare(
      `INSERT INTO video_script_versions (id, project_id, version, content_md, scenes_json, source, note, created_at)
       VALUES (?, ?, 1, '', '[]', 'user', '初始版本', ?)`
    ).run(uid(), id, ts);
  });

  ensureProjectDirs(code);
  return getProject(id);
}

const PROJECT_FIELDS = {
  title: 'title',
  status: 'status',
  style: 'style',
  brief: 'brief'
};

function updateProject(id, patch) {
  const row = getProjectRow(id);
  if (!row) throw httpError(404, '视频项目不存在');
  const body = patch || {};
  const sets = [];
  const values = [];

  Object.keys(PROJECT_FIELDS).forEach((key) => {
    if (typeof body[key] === 'undefined') return;
    sets.push(`${PROJECT_FIELDS[key]} = ?`);
    values.push(key === 'title' || key === 'brief' || key === 'style' ? clipText(body[key], key === 'brief' ? 30000 : 4000) : body[key]);
  });

  if (typeof body.aspect !== 'undefined' && body.aspect !== row.aspect) {
    if (!ASPECTS[body.aspect]) throw httpError(400, '不支持的画幅：' + body.aspect);
    const size = ASPECTS[body.aspect];
    sets.push('aspect = ?', 'width = ?', 'height = ?');
    values.push(body.aspect, size.width, size.height);
  }
  if (body.status && STATUSES.indexOf(body.status) < 0) throw httpError(400, '不支持的项目状态');
  if (body.provider && typeof body.provider === 'object') {
    sets.push('provider = ?');
    values.push(JSON.stringify(body.provider));
  }
  if (body.settings && typeof body.settings === 'object') {
    sets.push('settings = ?');
    values.push(JSON.stringify(body.settings));
  }

  if (!sets.length) return getProject(id);
  sets.push('updated_at = ?');
  values.push(now(), id);
  conn().prepare(`UPDATE video_projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

function deleteProject(id) {
  const row = getProjectRow(id);
  if (!row) throw httpError(404, '视频项目不存在');
  db.transaction((c) => {
    ['video_scenes', 'video_script_versions', 'video_assets', 'video_renders', 'video_jobs'].forEach((table) => {
      c.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(id);
    });
    c.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
  });
  try {
    fs.rmSync(projectRoot(row.code), { recursive: true, force: true });
  } catch (err) {
    /* 文件可能已被手动清理 */
  }
  return { ok: true };
}

function touchProject(id) {
  conn().prepare('UPDATE video_projects SET updated_at = ? WHERE id = ?').run(now(), id);
}

/** 角色是账号级共享，只有旧数据仍带着来源项目时才刷新该项目时间 */
function touchCharacterOrigin(projectId) {
  if (!projectId) return;
  if (!getProjectRow(projectId)) return;
  touchProject(projectId);
}

/* ---------------- 脚本版本 ---------------- */

function getLatestScript(projectId) {
  return mapScript(
    conn()
      .prepare('SELECT * FROM video_script_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
      .get(projectId)
  );
}

function getScriptVersion(projectId, version) {
  return mapScript(
    conn()
      .prepare('SELECT * FROM video_script_versions WHERE project_id = ? AND version = ?')
      .get(projectId, version)
  );
}

function saveScript(projectId, input) {
  if (!getProjectRow(projectId)) throw httpError(404, '视频项目不存在');
  const body = input || {};
  const contentMd = clipText(body.contentMd, 200000);
  const scenes = Array.isArray(body.scenes) ? body.scenes : [];
  const source = body.source === 'ai' ? 'ai' : 'user';
  const ts = now();
  const row = conn()
    .prepare('SELECT MAX(version) AS v FROM video_script_versions WHERE project_id = ?')
    .get(projectId);
  const version = (row && row.v ? Number(row.v) : 0) + 1;
  conn()
    .prepare(
      `INSERT INTO video_script_versions (id, project_id, version, content_md, scenes_json, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(uid(), projectId, version, contentMd, JSON.stringify(scenes), source, clipText(body.note || '', 200), ts);
  touchProject(projectId);
  return getScriptVersion(projectId, version);
}

/* ---------------- 分镜 ---------------- */

function listScenes(projectId) {
  return conn()
    .prepare('SELECT * FROM video_scenes WHERE project_id = ? ORDER BY idx ASC')
    .all(projectId)
    .map(mapScene);
}

function getSceneRow(id) {
  return conn().prepare('SELECT * FROM video_scenes WHERE id = ?').get(id);
}

const SCENE_FIELDS = {
  title: 'title',
  durationMs: 'duration_ms',
  shot: 'shot',
  camera: 'camera',
  prompt: 'prompt',
  negativePrompt: 'negative_prompt',
  narration: 'narration',
  onScreenText: 'on_screen_text',
  transition: 'transition',
  renderMode: 'render_mode',
  status: 'status',
  imageAssetId: 'image_asset_id',
  videoAssetId: 'video_asset_id',
  audioAssetId: 'audio_asset_id',
  segmentAssetId: 'segment_asset_id',
  paramsHash: 'params_hash'
};
const ASSET_FIELD_KEYS = ['imageAssetId', 'videoAssetId', 'audioAssetId', 'segmentAssetId', 'paramsHash'];
// 这些字段一变，已渲染的片段就过期了，需要清空以便重新出片段
const SEGMENT_SENSITIVE = ['durationMs', 'prompt', 'shot', 'camera', 'transition', 'renderMode', 'imageAssetId', 'videoAssetId', 'onScreenText'];

function normalizeDuration(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return 5000;
  return Math.max(500, Math.min(600000, n));
}

function addScene(projectId, input) {
  if (!getProjectRow(projectId)) throw httpError(404, '视频项目不存在');
  const body = input || {};
  const max = conn()
    .prepare('SELECT COALESCE(MAX(idx), 0) AS m FROM video_scenes WHERE project_id = ?')
    .get(projectId);
  const idx = Number(max.m) + 1;
  const ts = now();
  const id = uid();
  conn()
    .prepare(
      `INSERT INTO video_scenes
        (id, project_id, idx, title, duration_ms, shot, camera, prompt, negative_prompt, narration, on_screen_text,
         character_ids, transition, render_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      id,
      projectId,
      idx,
      clipText(body.title || '场景 ' + idx, 120),
      normalizeDuration(body.durationMs),
      clipText(body.shot || '', 60),
      clipText(body.camera || '', 120),
      clipText(body.prompt || '', 5000),
      clipText(body.negativePrompt || '', 2000),
      clipText(body.narration || '', 5000),
      clipText(body.onScreenText || '', 500),
      JSON.stringify(Array.isArray(body.characterIds) ? body.characterIds : []),
      clipText(body.transition || '', 40),
      RENDER_MODES.indexOf(body.renderMode) >= 0 ? body.renderMode : 'image',
      ts,
      ts
    );
  touchProject(projectId);
  return mapScene(getSceneRow(id));
}

function updateScene(id, patch) {
  const row = getSceneRow(id);
  if (!row) throw httpError(404, '场景不存在');
  const body = patch || {};
  const sets = [];
  const values = [];
  let segmentStale = false;
  Object.keys(SCENE_FIELDS).forEach((key) => {
    if (typeof body[key] === 'undefined') return;
    if (SEGMENT_SENSITIVE.indexOf(key) >= 0 && key !== 'segmentAssetId') segmentStale = true;
    if (key === 'durationMs') {
      sets.push('duration_ms = ?');
      values.push(normalizeDuration(body[key]));
      return;
    }
    if (key === 'renderMode' && RENDER_MODES.indexOf(body[key]) < 0) throw httpError(400, '不支持的生成模式');
    if (key === 'status' && SCENE_STATUSES.indexOf(body[key]) < 0) throw httpError(400, '不支持的场景状态');
    sets.push(`${SCENE_FIELDS[key]} = ?`);
    if (ASSET_FIELD_KEYS.indexOf(key) >= 0) {
      values.push(body[key] == null || body[key] === '' ? null : clipText(body[key], 120));
      return;
    }
    values.push(typeof body[key] === 'string' ? clipText(body[key], 5000) : body[key]);
  });
  if (segmentStale && row.segment_asset_id && typeof body.segmentAssetId === 'undefined') {
    sets.push('segment_asset_id = NULL');
  }
  if (Array.isArray(body.characterIds)) {
    sets.push('character_ids = ?');
    values.push(JSON.stringify(body.characterIds));
  }
  if (!sets.length) return mapScene(row);
  sets.push('updated_at = ?');
  values.push(now(), id);
  conn().prepare(`UPDATE video_scenes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  touchProject(row.project_id);
  return mapScene(getSceneRow(id));
}

function reindexScenes(projectId) {
  const rows = conn()
    .prepare('SELECT id FROM video_scenes WHERE project_id = ? ORDER BY idx ASC')
    .all(projectId);
  // 先挪到负数占位，避免 (project_id, idx) 唯一约束在逐个改号时冲突
  const park = conn().prepare('UPDATE video_scenes SET idx = ? WHERE id = ?');
  rows.forEach((r, i) => park.run(-(i + 1), r.id));
  const upd = conn().prepare('UPDATE video_scenes SET idx = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

function deleteScene(id) {
  const row = getSceneRow(id);
  if (!row) throw httpError(404, '场景不存在');
  conn().prepare('DELETE FROM video_scenes WHERE id = ?').run(id);
  reindexScenes(row.project_id);
  touchProject(row.project_id);
  return { ok: true };
}

function reorderScenes(projectId, ids) {
  if (!getProjectRow(projectId)) throw httpError(404, '视频项目不存在');
  const list = Array.isArray(ids) ? ids : [];
  const rows = conn().prepare('SELECT id FROM video_scenes WHERE project_id = ?').all(projectId);
  const known = new Set(rows.map((r) => r.id));
  if (list.length !== rows.length || list.some((id) => !known.has(id))) {
    throw httpError(400, '场景顺序不完整');
  }
  db.transaction((c) => {
    // 两段式改号：先全部挪到负数占位，再写入最终序号
    const park = c.prepare('UPDATE video_scenes SET idx = ? WHERE id = ?');
    list.forEach((id, i) => park.run(-(i + 1), id));
    const upd = c.prepare('UPDATE video_scenes SET idx = ?, updated_at = ? WHERE id = ?');
    list.forEach((id, i) => upd.run(i + 1, now(), id));
  });
  touchProject(projectId);
  return listScenes(projectId);
}

/* ---------------- 角色 ---------------- */

/** 角色属于账号，所有视频项目共用同一份角色库 */
function listCharacters() {
  return conn()
    .prepare('SELECT * FROM video_characters ORDER BY created_at ASC')
    .all()
    .map(mapCharacter);
}

function getCharacterRow(id) {
  return conn().prepare('SELECT * FROM video_characters WHERE id = ?').get(id);
}

/**
 * 角色本身不绑定项目，但参考图/定妆图要落到某个项目目录里。
 * 优先用调用方当前所在项目，其次退回旧数据里的来源项目，最后用最近更新的项目。
 */
function characterStorageProjectId(row, requested) {
  const candidates = [requested, row && row.project_id].filter(Boolean);
  for (const pid of candidates) {
    if (getProjectRow(pid)) return pid;
  }
  const fallback = conn().prepare('SELECT id FROM video_projects ORDER BY updated_at DESC LIMIT 1').get();
  return fallback ? fallback.id : '';
}

function addCharacter(projectId, input) {
  if (!getProjectRow(projectId)) throw httpError(404, '视频项目不存在');
  const body = input || {};
  const name = clipText(body.name || '', 60).trim();
  if (!name) throw httpError(400, '角色名称不能为空');
  const ts = now();
  const id = uid();
  conn()
    .prepare(
      `INSERT INTO video_characters
        (id, project_id, name, description, refs, anchor_asset_id, style, anchors, profile, voice_id, seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      null,
      name,
      clipText(body.description || '', 3000),
      JSON.stringify(Array.isArray(body.refs) ? body.refs : []),
      body.anchorAssetId || null,
      clipText(body.style || '', 60),
      JSON.stringify(Array.isArray(body.anchors) ? body.anchors : []),
      JSON.stringify(body.profile && typeof body.profile === 'object' ? body.profile : {}),
      clipText(body.voiceId || '', 120),
      Number.isInteger(body.seed) ? body.seed : null,
      ts,
      ts
    );
  touchProject(projectId);
  return mapCharacter(getCharacterRow(id));
}

function updateCharacter(id, patch) {
  const row = getCharacterRow(id);
  if (!row) throw httpError(404, '角色不存在');
  const body = patch || {};
  const sets = [];
  const values = [];
  if (typeof body.name !== 'undefined') {
    const name = clipText(body.name, 60).trim();
    if (!name) throw httpError(400, '角色名称不能为空');
    sets.push('name = ?');
    values.push(name);
  }
  if (typeof body.description !== 'undefined') {
    sets.push('description = ?');
    values.push(clipText(body.description, 3000));
  }
  if (Array.isArray(body.refs)) {
    sets.push('refs = ?');
    values.push(JSON.stringify(body.refs));
  }
  if (typeof body.anchorAssetId !== 'undefined') {
    sets.push('anchor_asset_id = ?');
    values.push(body.anchorAssetId || null);
  }
  if (typeof body.style !== 'undefined') {
    sets.push('style = ?');
    values.push(clipText(body.style || '', 60));
  }
  if (Array.isArray(body.anchors)) {
    sets.push('anchors = ?');
    values.push(JSON.stringify(body.anchors));
  }
  if (body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile)) {
    sets.push('profile = ?');
    values.push(JSON.stringify(body.profile));
  }
  if (typeof body.voiceId !== 'undefined') {
    sets.push('voice_id = ?');
    values.push(clipText(body.voiceId, 120));
  }
  if (typeof body.seed !== 'undefined') {
    sets.push('seed = ?');
    values.push(Number.isInteger(body.seed) ? body.seed : null);
  }
  if (!sets.length) return mapCharacter(row);
  sets.push('updated_at = ?');
  values.push(now(), id);
  conn().prepare(`UPDATE video_characters SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  touchCharacterOrigin(row.project_id);
  return mapCharacter(getCharacterRow(id));
}

function deleteCharacter(id) {
  const row = getCharacterRow(id);
  if (!row) throw httpError(404, '角色不存在');
  conn().prepare('DELETE FROM video_characters WHERE id = ?').run(id);
  touchCharacterOrigin(row.project_id);
  return { ok: true };
}

module.exports = {
  ASPECTS,
  STATUSES,
  RENDER_MODES,
  SCENE_STATUSES,
  projectRoot,
  ensureProjectDirs,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getLatestScript,
  getScriptVersion,
  saveScript,
  listScenes,
  getSceneRow,
  addScene,
  updateScene,
  deleteScene,
  reorderScenes,
  listCharacters,
  getCharacterRow,
  characterStorageProjectId,
  addCharacter,
  updateCharacter,
  deleteCharacter
};
