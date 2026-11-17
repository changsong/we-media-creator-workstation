import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_AI_FILE = path.resolve(__dirname, '../../.ai.json');

export function aiConfigFile() {
  return process.env.JIAYOUZHAN_AI_CONFIG || DEFAULT_AI_FILE;
}

export function loadAiConfig(file = aiConfigFile()) {
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`AI 配置无法解析（${file}）：${error.message}`);
  }
  const apiKey = raw.apiKey || raw.api_key || process.env.JIAYOUZHAN_AI_KEY || '';
  const baseUrl = (raw.baseUrl || raw.base_url || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = raw.model || 'deepseek-chat';
  if (!apiKey) throw new Error(`AI 配置缺少 apiKey（${file}）`);
  return { baseUrl, model, apiKey };
}

function parseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回内容为空');
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 返回内容不是 JSON 对象');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new Error(`AI 返回 JSON 解析失败：${error.message}`);
  }
}

async function requestOnce({ config, system, user, timeout }) {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      max_tokens: 4000,
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
  return parseContent(await res.json());
}

export async function generateArticle({ config, system, user, timeout = 90000, retry = 1 }) {
  let lastError;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    try {
      return await requestOnce({ config, system, user, timeout });
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status >= 500 || error.status === 429;
      if (!retryable || attempt === retry) break;
    }
  }
  throw lastError;
}
