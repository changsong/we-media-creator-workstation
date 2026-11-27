'use strict';

/**
 * 视频工坊 AI 环节：脚本生成 / 分镜拆分。
 * 两条链路都走 ai.chat，结果分别落到脚本版本与分镜表。
 */

const fs = require('fs');
const projects = require('./projects');
const assets = require('./assets');
const voices = require('./voices');
const tts = require('./tts');
const ai = require('../ai');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nextUntriedVideoModel(provider, current, tried) {
  const seen = new Set((tried || []).concat([current]));
  let cur = current;
  for (let i = 0; i < 10; i++) {
    const next = ai.nextVideoModel(provider, cur);
    if (!next) return '';
    if (!seen.has(next)) return next;
    cur = next;
  }
  return '';
}

function videoExhaustedMessage(tried) {
  const list = (tried || []).filter(Boolean);
  return (list.length ? '已尝试本账号视频模型（' + list.join(' / ') + '）：额度已用尽或未开通。' : '')
    + '请到火山方舟控制台「开通管理」调整或关闭「安全体验模式」后重试；也可把分镜生成方式改为「图片 + 运镜」继续出片。';
}

const SCRIPT_SYSTEM = [
  '你是一位资深中文短视频编导，擅长把选题与对标内容改写成可直接拍摄/生成的原创脚本。',
  '要求：',
  '1. 前 3 秒必须有钩子，中段给信息增量，结尾有明确行动或记忆点；',
  '2. 旁白口语化、短句为主，避免生硬书面语与空话；',
  '3. 不照搬参考资料原文，只借鉴结构与节奏，观点与表达必须原创；',
  '4. 严格遵守给定画幅与目标时长节奏；',
  '5. 输出 Markdown：先一行「# 标题」，再按镜头分段，每个镜头固定包含：',
  '## 镜头 N｜x 秒',
  '**画面**：给图像/视频生成的画面描述（主体、动作、环境、光线、镜头）',
  '**旁白**：可直接配音的口播文案',
  '**字幕**：画面上的短文字（可为空）',
  '**转场**：与下一镜的衔接（可为空）',
  '不要输出脚本之外的寒暄或解释。'
].join('\n');

function buildScriptUserPrompt(project, opts) {
  const o = opts || {};
  const ref = String(o.reference || '').trim();
  const parts = [
    '视频标题：' + (project.title || '未命名'),
    project.style ? '画面风格：' + project.style : '',
    '画幅：' + project.aspect + '（' + project.width + '×' + project.height + '）',
    o.durationSec ? '目标时长：约 ' + o.durationSec + ' 秒' : '目标时长：60~90 秒',
    '创作简报：\n' + (project.brief || '（无，请围绕标题自行组织）')
  ];
  if (ref) parts.push('对标/参考资料（只参考结构与节奏，禁止抄写原句）：\n' + ref);
  parts.push('请输出完整脚本。');
  return parts.filter(Boolean).join('\n\n');
}

async function generateScript(projectId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const provider = o.provider || ai.providerForProject(project);
  if (o.mode === 'faithful') return generateFaithfulScript(project, provider, o);
  const out = await ai.chat({
    provider,
    model: o.model || '',
    messages: [
      { role: 'system', content: SCRIPT_SYSTEM },
      { role: 'user', content: buildScriptUserPrompt(project, o) }
    ],
    temperature: 0.7,
    maxTokens: o.maxTokens || 3000,
    timeoutMs: 180000
  });
  const script = projects.saveScript(projectId, {
    contentMd: out.content,
    source: 'ai',
    note: 'AI 生成 · ' + out.model
  });
  const patch = {
    settings: Object.assign({}, project.settings || {}, { scriptMode: 'creative' })
  };
  if (project.status === 'draft' || project.status === 'briefing') patch.status = 'scripting';
  projects.updateProject(projectId, patch);
  return { script, mode: 'creative', model: out.model, usage: out.usage, provider };
}

/* ---------------- 保真分镜：旁白原句直出，AI 只补画面 ---------------- */

const FAITHFUL_SYSTEM = [
  '你是短视频分镜师。用户会给你一份已定稿的旁白文案和镜头划分，',
  '你只负责为每个镜头设计画面、字幕与转场，不得改写、增删、合并或调换旁白。',
  '只输出 JSON，不要输出解释。'
].join('\n');

const FAITHFUL_CHARS_PER_SHOT = 48;
const FAITHFUL_MAX_SHOTS = 80;
const FAITHFUL_BATCH = 16;

/** 把文案按行/句拆成最小语单元，保留原文用词 */
function splitFaithfulUnits(text) {
  const units = [];
  String(text || '').replace(/\r/g, '').split(/\n+/).forEach((line) => {
    line.split(/(?<=[。！？!?；;])\s*/).forEach((seg) => {
      const s = seg.trim();
      if (s) units.push(s);
    });
  });
  return units;
}

function joinFaithfulUnit(cur, unit) {
  if (!cur) return unit;
  return /[，。！？!?；;、：:,.!?]$/.test(cur) ? cur + unit : cur + '，' + unit;
}

/** 按目标字数聚合语单元；长句自动溢出到下一镜 */
function groupFaithfulShots(units, targetChars) {
  const limit = targetChars || FAITHFUL_CHARS_PER_SHOT;
  const shots = [];
  let cur = '';
  units.forEach((u) => {
    if (cur && (cur.length >= limit || cur.length + u.length > limit * 1.7)) {
      shots.push(cur);
      cur = u;
    } else {
      cur = joinFaithfulUnit(cur, u);
    }
  });
  if (cur) shots.push(cur);
  return shots;
}

/** 镜头数超过上限时，从尾部两两合并，保证不因文案太长而爆量 */
function capFaithfulShots(shots, maxShots) {
  const out = shots.slice();
  while (out.length > maxShots) {
    const tail = out.pop();
    out[out.length - 1] = joinFaithfulUnit(out[out.length - 1], tail);
  }
  return out;
}

/** 中文口播按约 5.5 字/秒估时长；生成配音时若实际更长会自动加长分镜，估短不会被截断 */
function estimateNarrationMs(text) {
  const chars = String(text || '').replace(/\s+/g, '').length;
  return Math.max(2500, Math.min(20000, Math.round((chars / 5.5) * 1000)));
}

function buildFaithfulPrompt(project, shots) {
  return [
    '视频标题：' + (project.title || '未命名'),
    project.style ? '统一画面风格：' + project.style : '',
    '画幅：' + project.aspect + '（' + project.width + '×' + project.height + '）',
    '已定稿旁白共 ' + shots.length + ' 个镜头（旁白严禁改写，你只需为每个镜头配画面）：',
    shots.map((s, i) => (i + 1) + '. ' + s).join('\n'),
    '输出 JSON：{"scenes":[{"title":"镜头标题（≤10字）","shot":"景别","camera":"运镜","prompt":"画面生成提示词（写清主体、动作、环境、光线，40~120字，必须与旁白内容对应）","onScreenText":"字幕（≤18字，可为空）","transition":"转场（可为空）"}]}',
    '要求：scenes 必须恰好 ' + shots.length + ' 个，顺序与旁白一一对应；不要输出 narration 字段。'
  ].filter(Boolean).join('\n\n');
}

function faithfulScriptMd(project, shots, visuals) {
  const lines = ['# ' + (project.title || '未命名视频')];
  shots.forEach((narration, i) => {
    const v = visuals[i] || {};
    const sec = Math.round(estimateNarrationMs(narration) / 1000);
    lines.push('## 镜头 ' + (i + 1) + '｜' + sec + ' 秒');
    lines.push('**画面**：' + (v.prompt || ('围绕旁白内容设计画面：' + narration)));
    lines.push('**旁白**：' + narration);
    lines.push('**字幕**：' + (v.onScreenText || ''));
    lines.push('**转场**：' + (v.transition || ''));
  });
  return lines.join('\n');
}

function defaultFaithfulVisual(index, narration) {
  return {
    title: '镜头 ' + (index + 1),
    shot: '中景',
    camera: '固定镜头',
    prompt: '围绕旁白内容设计画面：' + String(narration || '').slice(0, 80),
    onScreenText: '',
    transition: ''
  };
}

function normalizeFaithfulVisual(v, index) {
  const x = v || {};
  return {
    title: x.title ? String(x.title) : ('镜头 ' + (index + 1)),
    shot: x.shot ? String(x.shot) : '',
    camera: x.camera ? String(x.camera) : '',
    prompt: x.prompt ? String(x.prompt) : '',
    onScreenText: x.onScreenText ? String(x.onScreenText) : '',
    transition: x.transition ? String(x.transition) : ''
  };
}

async function generateFaithfulScript(project, provider, o) {
  const sourceText = String(project.brief || '').trim();
  const compact = sourceText.replace(/\s+/g, '');
  if (compact.length < 20) {
    throw httpError(400, '创作简报里还没有文案：请先保存提取并纠错后的文案，再生成保真脚本');
  }
  // 文案再长也按上限切镜，避免一镜几十个字地堆成上百个镜头导致模型超时
  const targetChars = Math.max(FAITHFUL_CHARS_PER_SHOT, Math.ceil(compact.length / FAITHFUL_MAX_SHOTS));
  const shots = capFaithfulShots(groupFaithfulShots(splitFaithfulUnits(sourceText), targetChars), FAITHFUL_MAX_SHOTS);
  if (!shots.length) throw httpError(400, '创作简报里没有可用文案');

  // 分批让 AI 只补画面：单批失败不影响整体，缺的画面用旁白生成兜底提示词
  const batches = [];
  for (let i = 0; i < shots.length; i += FAITHFUL_BATCH) {
    batches.push({ start: i, items: shots.slice(i, i + FAITHFUL_BATCH) });
  }
  let model = '';
  const usage = { input: 0, output: 0, total: 0 };
  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const out = await ai.chat({
        provider,
        model: o.model || '',
        messages: [
          { role: 'system', content: FAITHFUL_SYSTEM },
          { role: 'user', content: buildFaithfulPrompt(project, batch.items) }
        ],
        temperature: 0.4,
        maxTokens: 3000,
        json: true,
        timeoutMs: 120000
      });
      if (!model) model = out.model || '';
      if (out.usage) {
        usage.input += Number(out.usage.input_tokens || out.usage.prompt_tokens || 0);
        usage.output += Number(out.usage.output_tokens || out.usage.completion_tokens || 0);
        usage.total += Number(out.usage.total_tokens || 0);
      }
      const parsed = parseJsonLoose(out.content);
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.scenes;
      return batch.items.map((narration, i) =>
        Array.isArray(list) && list[i] ? normalizeFaithfulVisual(list[i], batch.start + i) : defaultFaithfulVisual(batch.start + i, narration)
      );
    } catch (err) {
      console.warn('[generate] 保真画面设计批次失败，使用旁白兜底：' + ((err && err.message) || err));
      return batch.items.map((narration, i) => defaultFaithfulVisual(batch.start + i, narration));
    }
  }));
  const visuals = [].concat.apply([], results);

  const scenes = shots.map((narration, i) => Object.assign({}, visuals[i], {
    durationMs: estimateNarrationMs(narration),
    narration,
    renderMode: 'image',
    characterIds: []
  }));
  const script = projects.saveScript(project.id, {
    contentMd: faithfulScriptMd(project, shots, visuals),
    scenes,
    source: 'ai',
    note: '保真分镜 · ' + (model || '旁白兜底')
  });
  const patch = {
    settings: Object.assign({}, project.settings || {}, { scriptMode: 'faithful' })
  };
  if (project.status === 'draft' || project.status === 'briefing') patch.status = 'scripting';
  projects.updateProject(project.id, patch);
  return { script, scenes: script.scenes, mode: 'faithful', model: model || '旁白兜底', usage, provider };
}

const SCENE_SYSTEM = [
  '你是短视频分镜师，负责把脚本拆成可直接用于 AI 图像/视频生成的分镜列表。',
  '只输出 JSON，不要输出解释或 Markdown 代码块以外的任何文字。'
].join('\n');

function buildSceneUserPrompt(project, script) {
  const chars = (project.characters || [])
    .map((c) => c.name + '：' + (c.description || '（无描述）'))
    .join('\n');
  const parts = [
    '视频标题：' + (project.title || '未命名'),
    project.style ? '画面风格：' + project.style : '',
    '画幅：' + project.aspect + '（' + project.width + '×' + project.height + '）',
    chars ? '固定角色（跨镜必须保持一致的外观描述）：\n' + chars : '',
    '脚本：\n' + (script.contentMd || '')
  ];
  parts.push(
    [
      '输出 JSON：',
      '{"scenes":[{"title":"镜头标题","durationSec":4,"shot":"景别","camera":"运镜","prompt":"画面生成提示词","negativePrompt":"负面提示词","narration":"旁白","onScreenText":"字幕","renderMode":"image","transition":"转场","characterNames":["出场角色名"]}]}',
      '约束：每镜 2~8 秒；prompt 用中文写清主体、动作、环境、光线、镜头语言；同一角色在不同镜头的描述必须一致；旁白保持脚本原意可微调；字幕不超过 18 字；renderMode 默认 image。',
      '必须覆盖脚本里的每一个「## 镜头」：脚本有多少个镜头，scenes 就要有至少多少个元素，不得合并、跳过或省略；单个镜头信息量大拆成上下两镜是可以的。'
    ].join('\n')
  );
  return parts.filter(Boolean).join('\n\n');
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    /* 继续尝试截取 */
  }
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

function clampDuration(sec) {
  const n = Number(sec);
  if (!isFinite(n)) return 4000;
  return Math.max(2000, Math.min(8000, Math.round(n * 1000)));
}

async function planScenes(projectId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scriptVersion = o.scriptVersion != null && o.scriptVersion !== '' ? Number(o.scriptVersion) : null;
  const script = scriptVersion ? projects.getScriptVersion(projectId, scriptVersion) : project.script;
  if (scriptVersion && !script) throw httpError(404, '指定版本的脚本不存在：v' + scriptVersion);
  if (!script || !String(script.contentMd || '').trim()) {
    throw httpError(400, '请先生成或填写脚本，再拆分分镜');
  }

  // 保真脚本生成时已经把镜头与旁白写死，拆分分镜直接复用，避免再让 AI 改写旁白
  if (Array.isArray(script.scenes) && script.scenes.length) {
    if (o.replace !== false) {
      projects.listScenes(projectId).forEach((sc) => projects.deleteScene(sc.id));
    }
    script.scenes.forEach((s) => {
      projects.addScene(projectId, {
        title: s.title,
        durationMs: s.durationMs,
        shot: s.shot,
        camera: s.camera,
        prompt: s.prompt,
        negativePrompt: s.negativePrompt,
        narration: s.narration,
        onScreenText: s.onScreenText,
        transition: s.transition,
        renderMode: s.renderMode,
        characterIds: s.characterIds
      });
    });
    projects.updateProject(projectId, { status: 'storyboarding' });
    return { scenes: projects.listScenes(projectId), mode: 'faithful', reused: true };
  }

  const provider = o.provider || ai.providerForProject(project);
  const out = await ai.chat({
    provider,
    model: o.model || '',
    messages: [
      { role: 'system', content: SCENE_SYSTEM },
      { role: 'user', content: buildSceneUserPrompt(project, script) }
    ],
    temperature: 0.4,
    maxTokens: 6000,
    json: true,
    timeoutMs: 180000
  });

  const parsed = parseJsonLoose(out.content);
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.scenes;
  if (!Array.isArray(list) || !list.length) {
    throw httpError(502, '分镜解析失败：模型未返回有效的 scenes 数组，可重试或调整脚本后再试');
  }

  const nameToId = {};
  (project.characters || []).forEach((c) => {
    nameToId[c.name] = c.id;
  });

  const rows = list.slice(0, 80).map((s) => ({
    title: s && s.title ? String(s.title) : '',
    durationMs: clampDuration(s && s.durationSec),
    shot: s && s.shot ? String(s.shot) : '',
    camera: s && s.camera ? String(s.camera) : '',
    prompt: s && s.prompt ? String(s.prompt) : '',
    negativePrompt: s && s.negativePrompt ? String(s.negativePrompt) : '',
    narration: s && s.narration ? String(s.narration) : '',
    onScreenText: s && s.onScreenText ? String(s.onScreenText) : '',
    transition: s && s.transition ? String(s.transition) : '',
    renderMode: s && s.renderMode === 'video' ? 'video' : 'image',
    characterIds: Array.isArray(s && s.characterNames)
      ? s.characterNames.map((n) => nameToId[n]).filter(Boolean)
      : []
  }));

  if (o.replace !== false) {
    projects.listScenes(projectId).forEach((sc) => projects.deleteScene(sc.id));
  }
  rows.forEach((row) => projects.addScene(projectId, row));
  projects.updateProject(projectId, { status: 'storyboarding' });
  return { scenes: projects.listScenes(projectId), model: out.model, usage: out.usage, provider };
}

/* ---------------- 场景素材生成 ---------------- */

const DEFAULT_NEGATIVE = '文字, 水印, logo, 签名, 多余手指, 畸形手, 多余肢体, 画面割裂, 低清晰度';

function aspectWord(project) {
  const ar = project.aspect === '9:16'
    ? '竖屏 9:16'
    : project.aspect === '1:1'
      ? '方形 1:1'
      : project.aspect === '4:5'
        ? '竖版 4:5'
        : '横屏 16:9';
  return ar + '（' + project.width + '×' + project.height + '）';
}

function buildImagePrompt(project, scene, chars) {
  const parts = [];
  if (project.style) parts.push('统一画面风格：' + project.style);
  parts.push('画幅：' + aspectWord(project));
  const lens = [scene.shot, scene.camera].filter(Boolean).join('，');
  if (lens) parts.push('景别与运镜：' + lens);
  parts.push('画面内容：' + (scene.prompt || scene.narration || scene.title || ''));
  if (chars.length) {
    parts.push(
      '出场角色（同一角色必须严格保持外观一致）：\n' +
        chars.map((c) => '- ' + c.name + '：' + (c.description || '（按名称维持一致外观）')).join('\n')
    );
  }
  parts.push('要求：画面主体清晰、构图完整、电影感光影，画面内不要出现文字与水印。');
  return parts.join('\n');
}

function findScene(project, sceneId) {
  const scene = (project.scenes || []).find((s) => s.id === sceneId);
  if (!scene) throw httpError(404, '分镜不存在');
  return scene;
}

/** 角色参考图/AI 结果在本地，方舟拉不到 127.0.0.1，这里转成内联 data URL 传过去 */
function assetDataUrl(assetId) {
  const found = assets.getAsset(assetId);
  if (!found || !found.filePath) return '';
  try {
    const buf = fs.readFileSync(found.filePath);
    if (buf.length > 3.5 * 1024 * 1024) return '';
    return 'data:' + (found.mime || 'image/png') + ';base64,' + buf.toString('base64');
  } catch (err) {
    return '';
  }
}

function characterRefDataUrls(project, scene) {
  const byId = {};
  (project.characters || []).forEach((c) => { byId[c.id] = c; });
  const out = [];
  (scene.characterIds || []).forEach((id) => {
    const c = byId[id];
    if (!c) return;
    // 有定妆图时只用定妆图：原始真人照片一旦进入分镜图，Seedance 会按真人输入拦截
    const ids = c.anchorAssetId
      ? [c.anchorAssetId]
      : (c.refs || []).filter((r) => typeof r === 'string');
    ids.forEach((assetId) => {
      if (out.length >= 3) return;
      const url = assetDataUrl(assetId);
      if (url) out.push(url);
    });
  });
  return out;
}

function parseJSON(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

async function generateCharacterAnchor(characterId, opts) {
  const o = opts || {};
  const row = projects.getCharacterRow(characterId);
  if (!row) throw httpError(404, '角色不存在');
  const projectId = projects.characterStorageProjectId(row, o.projectId);
  const project = projectId ? projects.getProject(projectId) : null;
  if (!project) throw httpError(400, '账号下还没有视频项目，无法生成定妆图');
  const desc = String(row.description || '').trim();
  const refIds = parseJSON(row.refs, []);
  const refImages = [];
  (Array.isArray(refIds) ? refIds : []).forEach((assetId) => {
    if (refImages.length >= 3) return;
    if (typeof assetId !== 'string') return;
    const url = assetDataUrl(assetId);
    if (url) refImages.push(url);
  });
  const style = String(o.style || row.style || project.style || '').trim();
  const profile = Object.assign({}, parseJSON(row.profile, {}), o.profile && typeof o.profile === 'object' ? o.profile : {});
  const profileLines = [
    profile.appearance ? '外貌：' + profile.appearance : '',
    profile.outfit ? '服装：' + profile.outfit : '',
    profile.age ? '年龄：' + profile.age : ''
  ].filter(Boolean).join('；');
  const prompt = [
    refImages.length
      ? '以参考图人物的五官比例、发型与面部特征为基础，把同一个人转绘为「' + (style || '插画') + '」风格的角色定妆照（单人半身正面像）：' + row.name
      : '角色定妆照（单人半身正面像）：' + row.name,
    refImages.length
      ? '要求：五官与发型要能看出是参考图中的同一个人，但必须彻底去除照片质感、皮肤毛孔与摄影写实感，输出插画 / 3D 渲染质感的画面。'
      : '',
    desc ? '角色设定：' + desc : '',
    profileLines,
    style ? '统一画面风格：' + style : '',
    '要求：面部清晰、五官稳定、纯色干净背景、均匀光线，不出现文字与水印。'
  ].filter(Boolean).join('\n');
  const provider = o.provider || ai.providerForProject(project);
  const out = await ai.image({
    provider,
    model: o.model || '',
    prompt,
    negativePrompt: o.negativePrompt || (refImages.length
      ? DEFAULT_NEGATIVE + ', 写实照片, 摄影, 照片质感, 皮肤毛孔, 真实人脸'
      : DEFAULT_NEGATIVE),
    size: o.size || '2K',
    image: refImages.length ? refImages : undefined
  });
  const asset = await assets.saveFromUrl(projectId, {
    kind: 'image',
    url: out.urls[0],
    provider,
    model: out.model,
    prompt,
    width: project.width,
    height: project.height,
    meta: { role: 'character-anchor', characterId, style }
  });
  // 多张风格定妆图作为候选保留，只有被设为「当前」的那张参与分镜生成
  const storedAnchors = parseJSON(row.anchors, []);
  const anchors = Array.isArray(storedAnchors) ? storedAnchors.slice() : [];
  anchors.push({ assetId: asset.id, style, createdAt: new Date().toISOString() });
  const setActive = o.setActive !== false;
  const character = projects.updateCharacter(characterId, {
    anchors,
    anchorAssetId: setActive ? asset.id : (row.anchor_asset_id || asset.id)
  });
  return { character, asset, anchors: character.anchors, model: out.model, provider };
}

async function generateSceneImage(projectId, sceneId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scene = findScene(project, sceneId);
  if (!String(scene.prompt || scene.narration || '').trim()) {
    throw httpError(400, '请先填写该分镜的画面描述或旁白');
  }
  const chars = (project.characters || []).filter((c) => (scene.characterIds || []).indexOf(c.id) >= 0);
  let prompt = buildImagePrompt(project, scene, chars);
  const refImages = characterRefDataUrls(project, scene);
  if (refImages.length) prompt += '\n参考图只用于保持角色长相与服装一致，请勿照抄参考图的构图。';
  const negativePrompt = scene.negativePrompt || o.negativePrompt || DEFAULT_NEGATIVE;
  const provider = o.provider || ai.providerForProject(project);
  const seed = Number.isInteger(o.seed) ? o.seed : (Number.isInteger(project.settings && project.settings.seed) ? project.settings.seed : undefined);

  projects.updateScene(sceneId, { status: 'generating' });
  try {
    const out = await ai.image({
      provider,
      model: o.model || '',
      prompt,
      negativePrompt,
      size: o.size || '2K',
      seed,
      image: refImages.length ? refImages : undefined
    });
    const asset = await assets.saveFromUrl(projectId, {
      kind: 'image',
      sceneId,
      url: out.urls[0],
      provider,
      model: out.model,
      prompt,
      seed,
      width: project.width,
      height: project.height,
      meta: { negativePrompt, usage: out.usage || null }
    });
    const updated = projects.updateScene(sceneId, { imageAssetId: asset.id, status: 'ready' });
    return { scene: updated, asset, model: out.model, provider };
  } catch (err) {
    projects.updateScene(sceneId, { status: 'failed' });
    throw err;
  }
}

async function generateSceneAudio(projectId, sceneId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scene = findScene(project, sceneId);
  const text = String(scene.narration || '').trim();
  if (!text) throw httpError(400, '请先填写该分镜的旁白，再生成配音');

  // 项目绑定了「我的音色」时优先用复刻音色，失败自动回退本地 SAPI 并给出提示；
  // 未绑定时自动选用账号下第一个训练好的音色，并写入项目设置，避免明明有音色却一直用系统音
  const settings = Object.assign({}, project.settings || {});
  let bound = settings.ttsVoiceId ? voices.getVoice(settings.ttsVoiceId) : null;
  const usable = (v) => v && v.status === 'ready' && v.voiceCode && v.provider === tts.DOUBAO_PROVIDER;
  if (!usable(bound)) {
    const ready = voices.listVoices().filter(usable)[0];
    if (ready) {
      bound = ready;
      projects.updateProject(projectId, { settings: Object.assign({}, settings, { ttsVoiceId: ready.id }) });
    }
  }
  const useVoice = usable(bound) ? bound : null;
  let warning = '';
  let out;
  if (useVoice) {
    try {
      out = await tts.synthesizeToWav(text, { rate: o.rate, voice: useVoice });
    } catch (err) {
      warning = '复刻音色配音失败，已改用本地配音：' + ((err && err.message) || '未知错误');
      out = await tts.synthesizeToWav(text, { rate: o.rate });
    }
  } else {
    out = await tts.synthesizeToWav(text, { rate: o.rate });
  }
  const asset = assets.saveBuffer(projectId, {
    kind: 'audio',
    sceneId,
    buffer: out.buffer,
    ext: out.ext || 'wav',
    mime: out.mime || 'audio/wav',
    provider: out.provider || 'local-tts',
    model: out.model || 'sapi',
    prompt: text,
    durationMs: out.durationMs,
    meta: Object.assign({ rate: o.rate || 0 }, useVoice ? { voiceId: useVoice.id, voiceName: useVoice.name } : {}, warning ? { voiceError: warning } : {})
  });
  if (scene.audioAssetId && scene.audioAssetId !== asset.id) assets.deleteAsset(scene.audioAssetId);

  // 旁白比原定时长更长时自动加长分镜，避免配音被截断（片段缓存会随之失效重渲染）
  const patch = { audioAssetId: asset.id };
  if (out.durationMs > scene.durationMs) {
    patch.durationMs = Math.min(600000, Math.round((out.durationMs + 250) / 100) * 100);
  }
  const updated = projects.updateScene(sceneId, patch);
  return warning
    ? { scene: updated, asset, durationMs: out.durationMs, warning }
    : { scene: updated, asset, durationMs: out.durationMs };
}

/* ---------------- 图生视频（Seedance 任务） ---------------- */

const { randomUUID } = require('crypto');
const db = require('../db');

function conn() {
  return db.open();
}

function videoDurationSec(scene, opts) {
  const o = opts || {};
  if (o.duration && Number.isInteger(Number(o.duration))) return Number(o.duration);
  return Number(scene.durationMs) >= 8000 ? 10 : 5;
}

async function createSceneVideo(projectId, sceneId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scene = findScene(project, sceneId);
  const imageData = scene.imageAssetId ? assetDataUrl(scene.imageAssetId) : '';
  if (!imageData) throw httpError(400, '请先生成该分镜的图片，图生视频需要首帧图片');

  const refImages = characterRefDataUrls(project, scene);
  const parts = [];
  if (project.style) parts.push('统一画面风格：' + project.style);
  if (scene.prompt) parts.push('画面：' + scene.prompt);
  if (scene.camera) parts.push('运镜：' + scene.camera);
  // 方舟规定「首帧/首尾帧」与「全模态参考生视频」互斥，不能同时传 first_frame 和 reference_image：
  // 有角色参考图时走参考模式（分镜图 + 角色图都作为 reference_image，提示词指定以分镜图为起始画面），
  // 否则维持首帧模式。参考模式下人物一致性更好，起始画面以提示词约束。
  const tail = '保持人物与画面一致，动作自然，无文字水印。';
  const promptRefs = parts
    .concat([
      '第 1 张参考图为分镜画面，请以此作为视频起始画面并保持其构图，人物动作自然展开。',
      '其余参考图中的人物为固定角色，请保持其长相、发型与服装一致。',
      '生成短视频，' + tail
    ])
    .join('\n');
  const promptFirstFrame = parts.concat(['基于首帧图片生成短视频，' + tail]).join('\n');

  const provider = o.provider || ai.providerForProject(project);
  const base = {
    provider,
    model: o.model || '',
    duration: videoDurationSec(scene, o),
    ratio: project.aspect,
    resolution: o.resolution || '1080p'
  };
  let taskId;
  let usedModel = '';
  let request;
  if (refImages.length) {
    const images = [imageData]
      .concat(refImages)
      .map((url) => ({ url, role: 'reference_image' }));
    try {
      const created = await ai.createVideoTask(Object.assign({}, base, { prompt: promptRefs, images }));
      taskId = created.id;
      usedModel = created.model || base.model || '';
      request = { prompt: promptRefs, images };
    } catch (err) {
      // 真人合规拦截换首帧模式也没用（检测的是图片内容），直接抛出
      if ((err && err.code) === 'InputImageSensitiveContentDetected.PrivacyInformation' || /real person/i.test(String(err && err.message))) throw err;
      // 仅在接口明确拒绝参数时退回只用首帧，网络/服务端错误不再重试以免重复建任务
      const st = Number(err && err.status);
      if (st !== 400 && st !== 422) throw err;
      const created = await ai.createVideoTask(Object.assign({}, base, { prompt: promptFirstFrame, imageUrls: [imageData] }));
      taskId = created.id;
      usedModel = created.model || base.model || '';
      request = { prompt: promptFirstFrame, imageUrls: [imageData] };
    }
  } else {
    const created = await ai.createVideoTask(Object.assign({}, base, { prompt: promptFirstFrame, imageUrls: [imageData] }));
    taskId = created.id;
    usedModel = created.model || base.model || '';
    request = { prompt: promptFirstFrame, imageUrls: [imageData] };
  }
  // 记录创建参数：额度耗尽在任务执行阶段才返回，轮询失败时要能换模型重建
  request = Object.assign({ duration: base.duration, ratio: base.ratio, resolution: base.resolution }, request);

  const jobId = randomUUID();
  const ts = new Date().toISOString();
  conn()
    .prepare(
      `INSERT INTO video_jobs (id, project_id, scene_id, type, payload, status, created_at, started_at)
       VALUES (?, ?, ?, 'video', ?, 'running', ?, ?)`
    )
    .run(jobId, projectId, sceneId, JSON.stringify({ taskId, provider, model: usedModel, tried: [usedModel], request }), ts, ts);
  projects.updateScene(sceneId, { status: 'generating' });
  return { jobId, taskId, provider, scene: projects.getSceneRow(sceneId) ? projects.listScenes(projectId).find((s) => s.id === sceneId) : null };
}

function latestVideoJob(sceneId) {
  return conn()
    .prepare(`SELECT * FROM video_jobs WHERE scene_id = ? AND type = 'video' ORDER BY created_at DESC LIMIT 1`)
    .get(sceneId);
}

async function pollSceneVideo(sceneId) {
  const job = latestVideoJob(sceneId);
  if (!job) throw httpError(404, '该分镜还没有视频生成任务');
  const payload = JSON.parse(job.payload || '{}');
  if (job.status !== 'running') {
    return { status: job.status, jobId: job.id, error: job.error || '' };
  }
  const data = await ai.getVideoTask(payload.provider, payload.taskId);
  const status = String((data && data.status) || '').toLowerCase();
  if (status === 'succeeded' || status === 'success') {
    const url = (data.content && (data.content.video_url || data.content.videoUrl)) || (data.data && data.data.video_url) || '';
    if (!url) throw httpError(502, '视频任务成功但未返回视频地址');
    const asset = await assets.saveFromUrl(job.project_id, {
      kind: 'video',
      sceneId,
      url,
      provider: payload.provider,
      model: (data.model || payload.model || ''),
      prompt: '',
      meta: { taskId: payload.taskId, usage: data.usage || null }
    });
    conn()
      .prepare(`UPDATE video_jobs SET status = 'done', progress = 100, result = ?, finished_at = ? WHERE id = ?`)
      .run(JSON.stringify({ assetId: asset.id }), new Date().toISOString(), job.id);
    const updated = projects.updateScene(sceneId, { videoAssetId: asset.id, renderMode: 'video', status: 'ready' });
    return { status: 'done', jobId: job.id, scene: updated, asset };
  }
  if (status === 'failed' || status === 'cancelled' || (data && data.error)) {
    const rawMsg = (data && data.error && (data.error.message || data.error.code)) || status || '任务失败';
    const limited = ai.isLimitMessage(payload.provider, rawMsg);
    const tried = (payload.tried || []).filter(Boolean);
    const failJob = (msg) => {
      conn()
        .prepare(`UPDATE video_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
        .run(String(msg).slice(0, 500), new Date().toISOString(), job.id);
      projects.updateScene(sceneId, { status: 'failed' });
      return { status: 'failed', jobId: job.id, error: String(msg) };
    };
    if (limited && payload.request) {
      // 只换「没试过」的模型；整条链都试过就收尾，避免无限重建任务
      const next = nextUntriedVideoModel(payload.provider, payload.model, tried);
      if (next && Number(job.attempts || 0) < 10) {
        try {
          const created = await ai.createVideoTask(Object.assign({}, payload.request, {
            provider: payload.provider,
            model: next,
            exclude: tried
          }));
          const model = created.model || next;
          const nextTried = Array.from(new Set(tried.concat([model])));
          const nextPayload = Object.assign({}, payload, { taskId: created.id, model, tried: nextTried });
          conn()
            .prepare('UPDATE video_jobs SET payload = ?, attempts = attempts + 1 WHERE id = ?')
            .run(JSON.stringify(nextPayload), job.id);
          console.warn('[ark] 分镜视频模型额度受限，已改用 ' + model + ' 重建任务');
          return { status: 'running', jobId: job.id, progress: 0, model };
        } catch (err) {
          // 参数被拒 / 无权访问说明该模型无法承接，直接失败并带上已尝试列表；
          // 额度问题（createVideoTask 内部已换完整条链）也直接给出结论；其它错误留待下轮重试
          const st = Number(err && err.status);
          const emsg = String((err && err.message) || '');
          if (st === 404) return failJob(videoExhaustedMessage(tried.concat([next])));
          if (st === 400 || st === 401 || st === 403 || st === 422) {
            return failJob(emsg || '重建视频任务失败');
          }
          if (ai.isLimitMessage(payload.provider, emsg)) {
            return failJob(emsg && /已尝试/.test(emsg) ? emsg : videoExhaustedMessage(tried.concat([next])));
          }
          throw err;
        }
      }
    }
    if (limited) return failJob(videoExhaustedMessage(tried));
    return failJob((data && data.error && (data.error.message || data.error.code)) || status || '任务失败');
  }
  const progress = data && typeof data.progress === 'number' ? data.progress : 0;
  conn().prepare('UPDATE video_jobs SET progress = ? WHERE id = ?').run(progress, job.id);
  return { status: 'running', jobId: job.id, progress };
}

module.exports = {
  generateScript,
  planScenes,
  generateSceneImage,
  generateSceneAudio,
  generateCharacterAnchor,
  createSceneVideo,
  pollSceneVideo,
  parseJsonLoose
};
