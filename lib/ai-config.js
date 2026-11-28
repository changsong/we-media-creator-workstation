'use strict';

/**
 * AI 服务配置：火山方舟 / 阿里百炼 / MiniMax 的 API 密钥与默认模型。
 *
 * 为「视频工坊」（脚本、分镜、图像 / 视频生成、配音）提供凭据，按账号隔离，
 * 落盘在 <账号数据根>/ai-config.json：
 *   { "<服务商>": { enabled:bool, fields:{ "<字段名>": "<值>" }, updatedAt:"ISO" } }
 *
 * 安全：密钥类字段读取时一律掩码，不回传明文；写入时传 KEEP 哨兵保留原值，
 * 传 '' 清空。与 channel-connections.json 保持同一套约定。
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

const KEEP = '__KEEP_EXISTING__';
const MASK = '••••••••';
const TEST_TIMEOUT_MS = 10000;

function configPath() {
  return path.join(db.accountRoot(), 'ai-config.json');
}

/**
 * 各服务商字段定义（单一信息源，前端直接复用）。
 *  - note：该服务商能做什么、密钥在哪里创建。
 *  - fields：secret 字段读取时掩码；optional 表示非必填。
 */
const DEFS = {
  '火山方舟': {
    docs: 'https://console.volcengine.com/ark',
    note: '字节跳动火山方舟：一个 API Key 覆盖豆包大模型（脚本 / 分镜）、即梦 Seedream（图像）与 Seedance（视频）。配音请单独配置下方「豆包语音」。在控制台「API Key 管理」创建。',
    fields: [
      { key: 'API Key', secret: true, placeholder: '火山方舟 API Key' },
      { key: '默认模型', optional: true, placeholder: '如 doubao-seed-1-6-... 或 ep-...', hint: '脚本 / 分镜默认使用的对话模型，可留空稍后在视频工坊选择' }
    ],
    test: { kind: 'models', url: 'https://ark.cn-beijing.volces.com/api/v3/models' }
  },
  '阿里百炼': {
    docs: 'https://bailian.console.aliyun.com/',
    note: '阿里云百炼：通义千问（脚本 / 分镜）、通义万相（图像 / 视频）、CosyVoice（配音）。在控制台「API-KEY 管理」创建密钥。',
    fields: [
      { key: 'API Key', secret: true, placeholder: 'sk-...' },
      { key: '默认模型', optional: true, placeholder: '如 qwen-plus', hint: '脚本 / 分镜默认使用的对话模型，可留空' }
    ],
    test: { kind: 'models', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models' }
  },
  'MiniMax': {
    docs: 'https://platform.minimaxi.com/',
    note: 'MiniMax 海螺：Hailuo 视频、speech 语音合成与声音克隆、音乐生成、图像与文本模型。在控制台「接口密钥」创建 API Key；Group ID 仅部分旧版音视频接口需要。',
    fields: [
      { key: 'API Key', secret: true, placeholder: 'MiniMax API Key' },
      { key: 'Group ID', optional: true, placeholder: '账户信息里的 Group ID（部分接口需要）' },
      { key: '默认模型', optional: true, placeholder: '如 MiniMax-M2', hint: '填写后可在线校验密钥；留空则只做格式检查' }
    ],
    test: { kind: 'chat', url: 'https://api.minimaxi.com/v1/chat/completions' }
  },
  '豆包语音': {
    docs: 'https://console.volcengine.com/speech/new/setting/apikeys?projectName=default',
    note: '豆包语音（独立于火山方舟，密钥不通用）：用于「我的音色」声音复刻与配音合成。先在「豆包语音」控制台开通「声音复刻 / 语音合成」，再到「API Key 管理」创建密钥填写。',
    fields: [
      { key: 'API Key', secret: true, placeholder: '豆包语音 API Key' }
    ],
    test: { kind: 'none', url: 'https://openspeech.bytedance.com/api/v3/tts/get_voice' }
  }
};

const PROVIDERS = Object.keys(DEFS);

function readAll() {
  try {
    const file = configPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

function writeAll(obj) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function maskValue(def, rawValue) {
  const has = typeof rawValue === 'string' && rawValue.trim().length > 0;
  if (!def || !def.secret) return { value: rawValue || '', hasValue: has };
  return { value: has ? MASK : '', hasValue: has };
}

function getDefs() {
  const defs = {};
  PROVIDERS.forEach((p) => {
    defs[p] = {
      docs: DEFS[p].docs,
      note: DEFS[p].note,
      fields: DEFS[p].fields.map((f) => ({
        key: f.key,
        secret: !!f.secret,
        optional: !!f.optional,
        placeholder: f.placeholder || '',
        hint: f.hint || ''
      }))
    };
  });
  return defs;
}

/** 读取全量（掩码），供「连接设置」页渲染 */
function getAll() {
  const all = readAll();
  const configs = {};
  PROVIDERS.forEach((p) => {
    const rec = all[p] || { enabled: false, fields: {}, updatedAt: null };
    const fields = {};
    DEFS[p].fields.forEach((f) => {
      fields[f.key] = maskValue(f, rec.fields ? rec.fields[f.key] : '');
    });
    configs[p] = {
      enabled: rec.enabled === true,
      updatedAt: rec.updatedAt || null,
      fields
    };
  });
  return { providers: PROVIDERS.slice(), defs: getDefs(), configs };
}

function get(provider) {
  if (!DEFS[provider]) return null;
  const all = readAll();
  const rec = all[provider] || { enabled: false, fields: {}, updatedAt: null };
  const fields = {};
  DEFS[provider].fields.forEach((f) => {
    fields[f.key] = maskValue(f, rec.fields ? rec.fields[f.key] : '');
  });
  return { provider, enabled: rec.enabled === true, updatedAt: rec.updatedAt || null, fields };
}

/** 读取原始值（仅内部供生成模块使用，不外发） */
function getRaw(provider) {
  if (!DEFS[provider]) return null;
  const rec = readAll()[provider];
  if (!rec) return null;
  return { enabled: rec.enabled === true, fields: rec.fields || {}, updatedAt: rec.updatedAt || null };
}

function requiredFields(provider) {
  return DEFS[provider].fields.filter((f) => !f.optional).map((f) => f.key);
}

/** 保存单个服务商配置；密钥字段传 KEEP 保留原值，传 '' 清空 */
function save(provider, body) {
  if (!DEFS[provider]) {
    const err = new Error('未知 AI 服务：' + provider);
    err.status = 404;
    throw err;
  }
  const all = readAll();
  const prev = all[provider] || { enabled: false, fields: {}, updatedAt: null };
  const incoming = (body && body.fields) || {};
  const nextFields = {};

  DEFS[provider].fields.forEach((f) => {
    const v = incoming[f.key];
    if (typeof v === 'undefined') {
      nextFields[f.key] = prev.fields[f.key] || '';
      return;
    }
    if (f.secret && v === KEEP) {
      nextFields[f.key] = prev.fields[f.key] || '';
      return;
    }
    nextFields[f.key] = typeof v === 'string' ? v.trim() : String(v == null ? '' : v);
  });

  const next = {
    enabled: body && (body.enabled === true || body.enabled === 'true'),
    fields: nextFields,
    updatedAt: new Date().toISOString()
  };
  all[provider] = next;
  writeAll(all);

  const outFields = {};
  DEFS[provider].fields.forEach((f) => {
    outFields[f.key] = maskValue(f, nextFields[f.key]);
  });
  return { provider, enabled: next.enabled, updatedAt: next.updatedAt, fields: outFields };
}

function mergeIncoming(provider, body) {
  const stored = getRaw(provider);
  const incoming = (body && body.fields) || {};
  const fields = {};
  DEFS[provider].fields.forEach((f) => {
    const v = incoming[f.key];
    if (typeof v === 'undefined' || (f.secret && (v === KEEP || v === MASK))) {
      fields[f.key] = (stored && stored.fields && stored.fields[f.key]) || '';
      return;
    }
    fields[f.key] = typeof v === 'string' ? v.trim() : String(v == null ? '' : v);
  });
  return fields;
}

async function fetchJSON(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (err) {
      body = null;
    }
    return { status: res.status, ok: res.ok, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function httpMessage(result, fallback) {
  const body = result.body;
  const detail = body && (body.error && (body.error.message || body.error.code) || body.message || body.base_resp && body.base_resp.status_msg);
  if (result.status === 401 || result.status === 403) return '密钥无效或无权访问（HTTP ' + result.status + '）' + (detail ? '：' + detail : '');
  return (detail ? detail : fallback) + (result.status ? '（HTTP ' + result.status + '）' : '');
}

/** 校验配置：方舟 / 百炼调用模型列表接口真实校验密钥；MiniMax 有默认模型时发一条最小对话 */
async function test(provider, body) {
  if (!DEFS[provider]) {
    const err = new Error('未知 AI 服务：' + provider);
    err.status = 404;
    throw err;
  }
  const fields = mergeIncoming(provider, body);
  const missing = requiredFields(provider).filter((k) => !fields[k]);
  if (missing.length) {
    return { ok: false, provider, message: '请先填写必填项：' + missing.join('、') };
  }

  const apiKey = fields['API Key'];
  const spec = DEFS[provider].test;

  if (spec.kind === 'none') {
    // 语音接口无廉价探测端点，用一次不存在的音色查询验证密钥是否被接受
    try {
      const result = await fetchJSON(spec.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Api-Request-Id': require('crypto').randomUUID() },
        body: JSON.stringify({ speaker_id: 'custom_speaker_id', custom_speaker_id: 'wmc_probe' })
      });
      if (result.status === 401 || result.status === 403) {
        return { ok: false, provider, online: true, message: httpMessage(result, '密钥无效或未开通语音服务') };
      }
      const b = result.body || {};
      const code = Number(b.code || (b.error && b.error.code) || 0);
      const detail = String(b.message || (b.error && (b.error.message || b.error.code)) || '');
      if (code === 45000030 || /resource.*not granted|未开通/i.test(detail)) {
        return {
          ok: false,
          provider,
          online: true,
          message: '密钥有效，但该项目尚未开通「声音复刻」服务：请在豆包语音控制台同一项目下开通（音色复刻）后再试' + (detail ? '（' + detail + '）' : '')
        };
      }
      return { ok: true, provider, online: true, message: '连接正常，密钥可用' };
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? '连接超时' : (err && err.message) || '网络错误';
      return { ok: false, provider, online: true, message: '无法连接服务：' + reason };
    }
  }

  if (provider === 'MiniMax' && !fields['默认模型']) {
    return {
      ok: true,
      provider,
      online: false,
      message: '必填项已填写。MiniMax 密钥将在首次生成时校验；填写「默认模型」后可在此在线校验。'
    };
  }

  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json'
  };

  try {
    if (spec.kind === 'models') {
      const result = await fetchJSON(spec.url, { method: 'GET', headers });
      if (result.ok) {
        const list = (result.body && result.body.data) || [];
        return {
          ok: true,
          provider,
          online: true,
          message: '连接正常' + (list.length ? '，可用模型 ' + list.length + ' 个' : '')
        };
      }
      return { ok: false, provider, online: true, message: httpMessage(result, '模型列表接口返回异常') };
    }

    const model = fields['默认模型'];
    const result = await fetchJSON(spec.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    });
    if (result.ok) {
      return { ok: true, provider, online: true, message: '连接正常，密钥可用' };
    }
    return { ok: false, provider, online: true, message: httpMessage(result, '对话接口返回异常') };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? '连接超时' : (err && err.message) || '网络错误';
    return { ok: false, provider, online: true, message: '无法连接服务：' + reason };
  }
}

module.exports = {
  KEEP,
  MASK,
  DEFS,
  PROVIDERS,
  getDefs,
  getAll,
  get,
  getRaw,
  save,
  test
};
