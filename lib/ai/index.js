'use strict';

/**
 * AI 能力入口：按服务商分发到具体适配器。
 * 首版只接火山方舟，阿里百炼 / MiniMax 预留同样的 chat / image / video 形状。
 */

const ark = require('./ark');
const aiConfig = require('../ai-config');

const IMPLS = {
  火山方舟: ark
};

const DEFAULT_PROVIDER = '火山方舟';

function pick(provider) {
  const name = provider || DEFAULT_PROVIDER;
  const impl = IMPLS[name];
  if (!impl) {
    const err = new Error('暂未接入该 AI 服务：' + name);
    err.status = 400;
    throw err;
  }
  return impl;
}

function chat(opts) {
  return pick(opts && opts.provider).chat(opts);
}

function image(opts) {
  return pick(opts && opts.provider).image(opts);
}

function createVideoTask(opts) {
  return pick(opts && opts.provider).createVideoTask(opts);
}

function getVideoTask(provider, id) {
  return pick(provider).getVideoTask(id);
}

function isLimitMessage(provider, text) {
  const impl = pick(provider);
  return typeof impl.isLimitMessage === 'function' ? impl.isLimitMessage(text) : false;
}

function nextVideoModel(provider, current) {
  const impl = pick(provider);
  return typeof impl.nextVideoModel === 'function' ? impl.nextVideoModel(current) : '';
}

function videoModelLimitMessage(provider, model) {
  const impl = pick(provider);
  return typeof impl.limitMessage === 'function' ? impl.limitMessage(model) : '视频模型额度已用尽：' + (model || '');
}

/** 模型按 ID 前缀归类，供前端下拉与默认值使用 */
function classifyModel(id) {
  const m = String(id || '');
  if (/seedream/i.test(m)) return 'image';
  if (/seedance/i.test(m)) return 'video';
  if (/seed-character/i.test(m)) return 'character';
  if (/(embedding|seed3d|hitem3d|hyper3d|translation)/i.test(m)) return 'other';
  return 'chat';
}

async function listModels(provider) {
  const impl = pick(provider);
  const ids = await impl.listModels();
  const grouped = { chat: [], image: [], video: [], character: [], other: [] };
  ids.forEach((id) => grouped[classifyModel(id)] && grouped[classifyModel(id)].push(id));
  return grouped;
}

/** 每个项目可用哪家：项目 provider 字段优先，否则用已启用的第一家 */
function providerForProject(project) {
  const chosen = project && project.provider && project.provider.name;
  if (chosen && IMPLS[chosen]) return chosen;
  const all = aiConfig.getAll();
  const enabled = Object.keys(all.configs).filter((p) => all.configs[p].enabled && IMPLS[p]);
  return enabled[0] || DEFAULT_PROVIDER;
}

module.exports = {
  DEFAULT_PROVIDER,
  DEFAULT_MODELS: ark.DEFAULT_MODELS,
  classifyModel,
  listModels,
  providerForProject,
  chat,
  image,
  createVideoTask,
  getVideoTask,
  isLimitMessage,
  nextVideoModel,
  videoModelLimitMessage
};
