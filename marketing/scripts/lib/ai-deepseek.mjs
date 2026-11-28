import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

// DeepSeek 走 OpenAI 兼容接口。配置优先级：
//   1. MARKETING_AI_CONFIG 指定的 JSON 文件
//   2. marketing/.ai.json（已 gitignore）
//   3. DEEPSEEK_API_KEY / MARKETING_AI_KEY 环境变量
export const DEFAULT_AI_FILE = path.join(ROOT, '.ai.json');

export function aiConfigFile() {
  return process.env.MARKETING_AI_CONFIG || DEFAULT_AI_FILE;
}

export function loadAiConfig(file = aiConfigFile()) {
  let raw = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`AI 配置无法解析（${file}）：${err.message}`);
    }
  }
  const apiKey = raw.apiKey || raw.api_key || process.env.DEEPSEEK_API_KEY || process.env.MARKETING_AI_KEY || '';
  if (!apiKey) {
    throw new Error(
      `没有找到 DeepSeek API Key。请把 {"apiKey":"sk-..."} 写到 ${file}，` +
      '或设置环境变量 DEEPSEEK_API_KEY / MARKETING_AI_KEY。'
    );
  }
  return {
    apiKey,
    baseUrl: String(raw.baseUrl || raw.base_url || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: String(raw.model || 'deepseek-chat'),
  };
}

function parseJsonContent(payload) {
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : '';
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回内容为空');
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 返回内容不是 JSON 对象');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`AI 返回 JSON 解析失败：${err.message}`);
  }
}

async function requestOnce({ config, system, user, maxTokens, temperature, timeout }) {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const error = new Error(`AI 请求失败 HTTP ${res.status}${body ? `：${body.slice(0, 300)}` : ''}`);
    error.status = res.status;
    throw error;
  }
  return parseJsonContent(await res.json());
}

export async function generateJson({
  system,
  user,
  maxTokens = 1200,
  temperature = 0.8,
  timeout = 60000,
  retry = 1,
  config,
} = {}) {
  const cfg = config || loadAiConfig();
  let lastError;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    try {
      return await requestOnce({ config: cfg, system, user, maxTokens, temperature, timeout });
    } catch (err) {
      lastError = err;
      const retryable = !err.status || err.status >= 500 || err.status === 429;
      if (!retryable || attempt === retry) break;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}
