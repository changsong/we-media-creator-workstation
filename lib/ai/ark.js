'use strict';

/**
 * 火山方舟（Ark）适配层。
 *
 * 同一把 API Key 覆盖对话（豆包）、图像（Seedream）、视频（Seedance）、
 * 角色一致性（seed-character）。所有请求走 OpenAI 兼容接口：
 *   POST /chat/completions
 *   POST /images/generations
 *   POST /contents/generations/tasks  +  GET /contents/generations/tasks/{id}
 *
 * 注意：方舟需在控制台「开通管理」逐个开通模型，未开通时接口返回
 * ModelNotOpen，这里转成可读提示。
 */

const aiConfig = require('../ai-config');

const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const PROVIDER = '火山方舟';

const DEFAULT_MODELS = {
  chat: 'doubao-seed-2-1-pro-260915',
  image: 'doubao-seedream-5-0-pro-260628',
  video: 'doubao-seedance-2-5-260628',
  character: 'doubao-seed-character-260628'
};

function config() {
  return aiConfig.getRaw(PROVIDER);
}

function getKey() {
  const rec = config();
  const key = rec && rec.enabled && rec.fields && rec.fields['API Key'];
  if (!key) {
    const err = new Error('尚未启用火山方舟：请到「连接设置 → AI 服务」填写并启用 API Key');
    err.status = 400;
    throw err;
  }
  return key;
}

function configuredModel(kind) {
  const rec = config();
  const v = rec && rec.fields && rec.fields['默认模型'];
  // 默认模型对图像/视频无意义，仅对话复用
  return kind === 'chat' && v ? String(v).trim() : '';
}

function httpError(status, body, fallback) {
  const e = body && body.error;
  const code = (e && e.code) || '';
  let msg = (e && e.message) || fallback || '请求失败';
  let limitExceeded = false;
  if (code === 'ModelNotOpen') {
    const model = ((msg.match(/model ([\w.-]+)/) || [])[1] || '').replace(/\.$/, '');
    msg = '模型未开通' + (model ? '（' + model + '）' : '') + '：请到火山方舟控制台「开通管理」开通该模型';
  } else if (code === 'InputImageSensitiveContentDetected.PrivacyInformation' || /may contain real person/i.test(String(msg))) {
    msg = '输入图片被判定为包含真人，Seedance 按人像合规拒绝该图（AI 生成的写实人脸也会触发），重试同一张图无效。'
      + '建议把分镜图 / 定妆图换成插画、3D 卡通等非写实风格，或改用不含正脸的画面（手部、产品、桌面、背影远景），也可以该分镜改用「图片 + 运镜」。';
  } else if (code === 'SetLimitExceeded' || /reached the set usage limit/i.test(String(msg)) || /model service has been paused/i.test(String(msg))) {
    const model = ((msg.match(/\[([\w.-]+)\]/) || [])[1] || '').replace(/\.$/, '');
    limitExceeded = true;
    msg = limitMessage(model);
  } else if (code === 'InvalidEndpointOrModel.NotFound' || (status === 404 && /does not exist|not have access/i.test(String(msg)))) {
    const model = ((msg.match(/endpoint ([\w.-]+)/) || [])[1] || '').replace(/\.$/, '');
    msg = '模型' + (model ? '（' + model + '）' : '') + '未开通或当前账号无权访问：请到火山方舟控制台「开通管理」开通该模型。';
  } else if (status === 401 || status === 403) {
    msg = '火山方舟密钥无效或无权访问：' + msg;
  }
  const err = new Error(msg);
  err.status = status >= 400 && status < 600 ? status : 502;
  err.code = code;
  err.limitExceeded = limitExceeded;
  return err;
}

async function request(pathname, opts) {
  const o = opts || {};
  const key = getKey();
  const timeoutMs = o.timeoutMs || 120000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + pathname, {
      method: o.method || 'GET',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      json = null;
    }
    if (!res.ok) throw httpError(res.status, json, text && text.slice(0, 300));
    return json;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error('火山方舟请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isLimitMessage(text) {
  return /reached the set usage limit|model service has been paused|safe ?ly? experience mode|额度均?已?用尽|安全体验模式/i.test(String(text || ''));
}

function isLimitExceeded(err) {
  return !!err && (err.limitExceeded || err.code === 'SetLimitExceeded'
    || isLimitMessage(err.message));
}

function limitMessage(model) {
  return '模型' + (model ? '（' + model + '）' : '') + '的「安全体验模式」额度已用尽，服务已暂停。'
    + '请到火山方舟控制台「开通管理」调高或关闭该模型的安全体验模式后重试；也可把分镜生成方式改为「图片 + 运镜」继续出片。';
}

let modelsCache = { at: 0, ids: [] };

async function listModels() {
  if (modelsCache.ids.length && Date.now() - modelsCache.at < 5 * 60 * 1000) return modelsCache.ids.slice();
  const data = await request('/models', { timeoutMs: 15000 });
  const ids = ((data && data.data) || []).map((m) => m.id).filter(Boolean).sort();
  modelsCache = { at: Date.now(), ids };
  return ids.slice();
}

async function chat(obj) {
  const o = obj || {};
  const model = o.model || configuredModel('chat') || DEFAULT_MODELS.chat;
  const body = {
    model,
    messages: o.messages || [],
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.6
  };
  if (o.maxTokens) body.max_tokens = o.maxTokens;
  if (o.json) body.response_format = { type: 'json_object' };
  const data = await request('/chat/completions', {
    method: 'POST',
    body,
    timeoutMs: o.timeoutMs || 180000
  });
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) {
    const err = new Error('火山方舟未返回文本内容');
    err.status = 502;
    throw err;
  }
  return {
    content: String(content),
    model: (data && data.model) || model,
    usage: (data && data.usage) || null,
    finishReason: (choice && choice.finish_reason) || ''
  };
}

// 5.x 系列共用「安全体验模式」额度，用尽后返回 SetLimitExceeded；
// 此时依次换用仍可用的图像模型，避免整个生成链路卡死。
const IMAGE_FALLBACKS = [
  'doubao-seedream-4-0-20260415',
  'doubao-seedream-5-0-flash-260915',
  'doubao-seedream-5-5-261028'
];

async function image(obj) {
  const o = obj || {};
  if (!o.prompt) {
    const err = new Error('图像提示词不能为空');
    err.status = 400;
    throw err;
  }
  const primary = o.model || DEFAULT_MODELS.image;
  const body = {
    model: primary,
    prompt: o.prompt,
    response_format: 'url',
    watermark: false
  };
  if (o.size) body.size = o.size;
  if (o.seed != null) body.seed = o.seed;
  if (o.negativePrompt) body.negative_prompt = o.negativePrompt;
  if (o.image) body.image = o.image; // 图生图 / 角色参考

  const tried = [primary];
  let data = null;
  for (;;) {
    try {
      data = await request('/images/generations', {
        method: 'POST',
        body,
        timeoutMs: o.timeoutMs || 180000
      });
      break;
    } catch (err) {
      const next = isLimitExceeded(err)
        ? IMAGE_FALLBACKS.filter((m) => tried.indexOf(m) < 0)[0]
        : '';
      if (!next) throw err;
      console.warn('[ark] 图像模型 ' + body.model + ' 额度受限，自动改用 ' + next);
      tried.push(next);
      body.model = next;
    }
  }
  const urls = ((data && data.data) || []).map((i) => i.url).filter(Boolean);
  if (!urls.length) {
    const err = new Error('图像接口未返回图片地址');
    err.status = 502;
    throw err;
  }
  return { urls, model: (data && data.model) || body.model, usage: (data && data.usage) || null };
}

// Seedance 2.x 共用「安全体验模式」额度，用尽后依次换用账号内其他视频模型
const VIDEO_FALLBACKS = [
  'doubao-seedance-2-5-flash-261115',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
  'doubao-seedance-1-0-pro-fast-251015'
];

/** 额度耗尽会发生在任务执行阶段，调用方需按当前模型换下一个可用模型重建任务 */
function nextVideoModel(current) {
  const chain = [DEFAULT_MODELS.video].concat(VIDEO_FALLBACKS);
  const idx = chain.indexOf(String(current || ''));
  if (idx >= 0) return chain[idx + 1] || '';
  return VIDEO_FALLBACKS[0] || '';
}

async function createVideoTask(obj) {
  const o = obj || {};
  const content = [];
  if (o.prompt) content.push({ type: 'text', text: o.prompt });
  // images 支持带 role 的图（如 {url, role:'first_frame'|'reference_image'}），
  // 兼容旧的 imageUrls / imageUrl 纯 URL 写法
  let items;
  if (Array.isArray(o.images) && o.images.length) {
    items = o.images;
  } else {
    const urls = Array.isArray(o.imageUrls) ? o.imageUrls : o.imageUrl ? [o.imageUrl] : [];
    items = urls.map((url) => ({ url }));
  }
  items.filter((i) => i && i.url).forEach((i) => {
    const part = { type: 'image_url', image_url: { url: i.url } };
    if (i.role) part.role = i.role;
    content.push(part);
  });
  if (!content.length) {
    const err = new Error('视频任务缺少提示词或参考图');
    err.status = 400;
    throw err;
  }
  const body = {
    model: o.model || DEFAULT_MODELS.video,
    content
  };
  const hasImages = content.some((p) => p.type === 'image_url');
  if (o.duration) body.duration = o.duration;
  // 首帧 / 参考图生视频时输出比例跟随图片，传 ratio 会被接口拒绝
  if (o.ratio && !hasImages) body.ratio = o.ratio;
  if (o.resolution) body.resolution = o.resolution;
  if (o.seed != null) body.seed = o.seed;
  // exclude：调用方已试过的模型（轮询换模型重建时传入），
  // 防止内部兜底再次选回已失败模型造成无限重建
  const tried = [body.model].concat(Array.isArray(o.exclude) ? o.exclude : [])
    .filter((m, i, a) => m && a.indexOf(m) === i);
  let data = null;
  let limitSeen = false;
  for (;;) {
    try {
      data = await request('/contents/generations/tasks', {
        method: 'POST',
        body,
        timeoutMs: 60000
      });
      break;
    } catch (err) {
      const emsg = String((err && err.message) || '');
      // 不同代际模型支持的参数不同：分辨率/时长被拒时自适应降级后重试同一模型
      if (err && err.code === 'InvalidParameter' && /resolution/i.test(emsg) && body.resolution) {
        console.warn('[ark] 模型 ' + body.model + ' 不支持 resolution=' + body.resolution + '，改为默认分辨率重试');
        delete body.resolution;
        continue;
      }
      if (err && err.code === 'InvalidParameter' && /duration/i.test(emsg) && body.duration && body.duration !== 5) {
        console.warn('[ark] 模型 ' + body.model + ' 不支持 duration=' + body.duration + '，改为 5 秒重试');
        body.duration = 5;
        continue;
      }
      // 额度用尽、模型未开通或无权访问，换下一个；其它错误（参数 / 网络）直接抛出
      if (isLimitExceeded(err)) limitSeen = true;
      const skip = isLimitExceeded(err)
        || (err && err.code === 'ModelNotOpen')
        || (err && (err.code === 'InvalidEndpointOrModel.NotFound' || err.status === 404));
      const next = skip ? VIDEO_FALLBACKS.filter((m) => tried.indexOf(m) < 0)[0] : '';
      if (!next) {
        console.error('[ark] 创建视频任务失败：', (err && err.status) || '', (err && err.code) || '', (err && err.message) || err);
        if (limitSeen) {
          const e = new Error('本账号可用视频模型的额度均已用尽或未开通（已自动尝试 ' + tried.join(' / ') + '）。'
            + '请到火山方舟控制台「开通管理」调整或关闭「安全体验模式」后重试；也可把分镜生成方式改为「图片 + 运镜」继续出片。');
          e.status = 429;
          e.code = 'SetLimitExceeded';
          e.limitExceeded = true;
          throw e;
        }
        throw err;
      }
      console.warn('[ark] 视频模型 ' + body.model + ' 不可用（' + ((err && err.code) || '额度受限') + '），自动改用 ' + next);
      tried.push(next);
      body.model = next;
    }
  }
  if (!data || !data.id) {
    const err = new Error('视频任务创建失败：未返回任务 ID');
    err.status = 502;
    throw err;
  }
  return { id: data.id, model: body.model };
}

async function getVideoTask(id) {
  return request('/contents/generations/tasks/' + encodeURIComponent(id), { timeoutMs: 30000 });
}

module.exports = {
  PROVIDER,
  BASE,
  DEFAULT_MODELS,
  getKey,
  listModels,
  chat,
  image,
  createVideoTask,
  getVideoTask,
  isLimitMessage,
  nextVideoModel,
  limitMessage
};
