'use strict';

/**
 * 配音合成：默认走 Windows 本地 SAPI（System.Speech），
 * 选用「复刻音色」时改走豆包语音（声音复刻 ICL 2.0）。
 *
 * 豆包语音与火山方舟不是同一套密钥：在「豆包语音」控制台创建 API Key，
 * 填到「连接设置 → AI 服务 → 豆包语音」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const aiConfig = require('../ai-config');

const DOUBAO_BASE = 'https://openspeech.bytedance.com/api/v3';
const DOUBAO_PROVIDER = '豆包语音';
const TTS_SAMPLE_RATE = 24000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function available() {
  return process.platform === 'win32';
}

function psScript(textFile, wavFile, rate) {
  // 文本走 UTF-8 文件传入，避免命令行引号/编码问题
  const r = Number(rate) || 0;
  return [
    'Add-Type -AssemblyName System.Speech;',
    '$t = Get-Content -Raw -Encoding UTF8 \'' + textFile.replace(/'/g, "''") + '\';',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    '$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like \'zh*\' } | Select-Object -First 1;',
    'if ($zh) { $s.SelectVoice($zh.VoiceInfo.Name) };',
    '$s.Rate = ' + r + ';',
    '$s.SetOutputToWaveFile(\'' + wavFile.replace(/'/g, "''") + '\');',
    '$s.Speak($t);',
    '$s.Dispose();'
  ].join(' ');
}

function runPowerShell(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true
    });
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
      reject(httpError(504, '配音合成超时'));
    }, timeoutMs || 120000);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(httpError(500, '无法调用系统语音：' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(httpError(502, '配音合成失败：' + String(err).trim().slice(0, 300)));
    });
  });
}

async function synthesizeSapi(text, opts) {
  const o = opts || {};
  const content = String(text || '').trim();
  if (!content) throw httpError(400, '旁白内容为空');
  if (!available()) throw httpError(400, '当前系统暂不支持本地配音，请配置云端 TTS 服务');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmc-tts-'));
  const textFile = path.join(dir, 'text.txt');
  const wavFile = path.join(dir, 'out.wav');
  try {
    fs.writeFileSync(textFile, content, 'utf8');
    await runPowerShell(psScript(textFile, wavFile, o.rate), o.timeoutMs || 120000);
    if (!fs.existsSync(wavFile)) throw httpError(502, '配音合成失败：未生成音频文件');
    const buffer = fs.readFileSync(wavFile);
    if (!buffer.length) throw httpError(502, '配音合成失败：音频为空');
    return { buffer, durationMs: wavDurationMs(buffer), ext: 'wav', mime: 'audio/wav', provider: 'local-tts', model: 'sapi' };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }
}

/* ---------------- 豆包语音：声音复刻 ---------------- */

function doubaoKey() {
  const rec = aiConfig.getRaw(DOUBAO_PROVIDER);
  const key = rec && rec.enabled && rec.fields && rec.fields['API Key'];
  if (!key) {
    throw httpError(400, '尚未启用豆包语音：请到「连接设置 → AI 服务 → 豆包语音」填写并启用 API Key');
  }
  return key;
}

async function doubaoRequest(pathname, body, headers) {
  const key = doubaoKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(DOUBAO_BASE + pathname, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'X-Api-Key': key,
        'X-Api-Request-Id': randomUUID()
      }, headers || {}),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text && text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        detail = (j.error && (j.error.message || j.error.code)) || j.message || detail;
      } catch (err) { /* 保留原始文本 */ }
      // 45000030 / not granted：API Key 有效，但项目没开通「声音复刻」资源
      if (/not granted|45000030/i.test(String(detail || ''))) {
        throw httpError(400, '豆包语音尚未开通「声音复刻」：请在豆包语音控制台同一项目下开通「豆包声音复刻模型 2.0」和「后付费音色」后再试（' + detail + '）');
      }
      // 音色与资源/账号不匹配：音色不是当前项目/密钥创建的，或 speaker 代号传错
      if (/mismatched with speaker/i.test(String(detail || ''))) {
        throw httpError(400, '音色与当前账号的资源不匹配：请确认 API Key 与音色属于同一项目；可在音色列表点「重新提交复刻」用原录音重试（' + detail + '）');
      }
      throw httpError(res.status, '豆包语音请求失败：' + detail);
    }
    return text;
  } catch (err) {
    if (err && err.name === 'AbortError') throw httpError(504, '豆包语音请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseDoubaoBody(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw httpError(502, '豆包语音返回内容无法解析');
  }
}

/** 状态码 → 本地状态：2 Success / 4 Active 可用，0 NotFound / 3 Failed 视为失败 */
function doubaoStatus(num) {
  const n = Number(num);
  if (n === 2 || n === 4) return 'ready';
  if (n === 0 || n === 3) return 'failed';
  return 'training';
}

function customSpeakerId() {
  return 'wmc_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 8);
}

/**
 * 提交声音复刻。返回 { voiceCode, customId, status, modelType, demoAudio }。
 * 训练通常需要几十秒到几分钟，调用方随后轮询 queryVoice。
 */
async function cloneVoice(obj) {
  const o = obj || {};
  const customId = o.customId || (o.name && /^[A-Za-z][\w-]{7,255}$/.test(o.name) ? o.name : customSpeakerId());
  const body = {
    speaker_id: 'custom_speaker_id',
    custom_speaker_id: customId,
    audio: {
      data: Buffer.from(o.buffer || []).toString('base64'),
      format: o.format || 'wav'
    },
    language: 0,
    extra_params: {
      demo_text: String(o.demoText || '你好，这是用我的声音合成的试听片段。').slice(0, 300),
      enable_audio_denoise: o.denoise === true
    }
  };
  if (o.text) body.text = String(o.text).slice(0, 5000);
  const data = parseDoubaoBody(await doubaoRequest('/tts/voice_clone', body));
  const detail = data.data && typeof data.data === 'object' ? data.data : data;
  const speakerStatus = Array.isArray(detail.speaker_status) ? detail.speaker_status[0] : null;
  return {
    voiceCode: detail.speaker_id || customId,
    customId,
    status: doubaoStatus(detail.status),
    modelType: speakerStatus && speakerStatus.model_type != null ? Number(speakerStatus.model_type) : null,
    demoAudio: (speakerStatus && speakerStatus.demo_audio) || '',
    message: detail.message || ''
  };
}

/** 查询复刻音色状态。 */
async function queryVoice(voice) {
  if (!voice) throw httpError(400, '音色不存在');
  if (!voice.customId && !voice.voiceCode) {
    throw httpError(400, '该音色还没有提交成功（缺少音色代号），无法查询状态；请在音色列表点「重新提交复刻」');
  }
  const body = voice.customId
    ? { speaker_id: 'custom_speaker_id', custom_speaker_id: voice.customId }
    : { speaker_id: voice.voiceCode };
  let data;
  try {
    data = parseDoubaoBody(await doubaoRequest('/tts/get_voice', body));
  } catch (err) {
    // 后付费代号查不到时，退回用返回的音色代号再查一次
    if (voice.voiceCode && voice.customId) {
      data = parseDoubaoBody(await doubaoRequest('/tts/get_voice', { speaker_id: voice.voiceCode }));
    } else {
      throw err;
    }
  }
  const detail = data.data && typeof data.data === 'object' ? data.data : data;
  const speakerStatus = Array.isArray(detail.speaker_status) ? detail.speaker_status[0] : null;
  const status = doubaoStatus(detail.status);
  let message = detail.message || '';
  if (!message && Number(detail.status) === 0) {
    message = '音色在豆包语音中不存在（训练未开始或已失效），请重新提交复刻';
  }
  return {
    voiceCode: detail.speaker_id || voice.voiceCode,
    status,
    modelType: speakerStatus && speakerStatus.model_type != null ? Number(speakerStatus.model_type) : voice.modelType,
    demoAudio: (speakerStatus && speakerStatus.demo_audio) || '',
    message
  };
}

function pcmToWav(pcm, sampleRate) {
  const rate = sampleRate || TTS_SAMPLE_RATE;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function clampSpeechRate(rate) {
  const n = Number(rate) || 0;
  return Math.max(-50, Math.min(100, Math.round(n * 10)));
}

/** 用复刻音色合成旁白，返回 WAV（豆包返回 PCM，这里补 WAV 头方便后续拼接）。 */
async function synthesizeDoubao(text, voice, opts) {
  const o = opts || {};
  const content = String(text || '').trim();
  if (!content) throw httpError(400, '旁白内容为空');
  if (!voice || !voice.voiceCode) throw httpError(400, '复刻音色尚未训练完成');

  const additions = voice.modelType != null ? JSON.stringify({ model_type: voice.modelType }) : '';
  const models = ['seed-tts-2.0-expressive', 'seed-tts-2.0-standard'];
  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const reqParams = {
      text: content,
      speaker: voice.voiceCode,
      model: models[i],
      audio_params: {
        format: 'pcm',
        sample_rate: TTS_SAMPLE_RATE,
        speech_rate: clampSpeechRate(o.rate)
      }
    };
    if (additions) reqParams.additions = additions;
    try {
      const raw = await doubaoRequest('/tts/unidirectional', { user: { uid: 'wmc' }, req_params: reqParams }, {
        'X-Api-Resource-Id': 'seed-icl-2.0'
      });
      const pcm = collectAudio(raw);
      if (!pcm.length) throw httpError(502, '豆包语音未返回音频数据');
      const wav = pcmToWav(pcm, TTS_SAMPLE_RATE);
      return {
        buffer: wav,
        durationMs: Math.round((pcm.length / (TTS_SAMPLE_RATE * 2)) * 1000),
        ext: 'wav',
        mime: 'audio/wav',
        provider: DOUBAO_PROVIDER,
        model: models[i]
      };
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || '');
      // 只有模型/资源不匹配时才换模型重试，其余错误直接抛出
      if (!/InvalidModelType|Resource id|model/i.test(msg)) throw err;
    }
  }
  throw lastErr || httpError(502, '豆包语音合成失败');
}

/** 解析 NDJSON 流式响应，拼接 Base64 音频分片。 */
function collectAudio(text) {
  const chunks = [];
  const lines = String(text || '').split('\n');
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let event = null;
    try { event = JSON.parse(line); } catch (err) { continue; }
    const code = Number(event.code);
    if (code === 0 || code === 3000) {
      if (event.data) chunks.push(Buffer.from(event.data, 'base64'));
    } else if (code === 20000000) {
      done = true;
      break;
    } else if (event.message && code !== 0) {
      throw httpError(502, '豆包语音合成失败：' + event.message);
    }
  }
  if (!done && !chunks.length) throw httpError(502, '豆包语音合成失败：响应中没有音频');
  return Buffer.concat(chunks);
}

/** 下载复刻试听音频 */
async function downloadAudio(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw httpError(502, '试听音频下载失败（HTTP ' + res.status + '）');
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = String(res.headers.get('content-type') || 'audio/mpeg').split(';')[0];
    return { buffer, mime: mime.indexOf('audio/') === 0 ? mime : 'audio/mpeg' };
  } catch (err) {
    if (err && err.name === 'AbortError') throw httpError(504, '试听音频下载超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 合成一段旁白。opts: { rate, voice }
 * voice 传入复刻音色时走豆包语音，否则用本地 SAPI。
 */
async function synthesizeToWav(text, opts) {
  const o = opts || {};
  if (o.voice && o.voice.voiceCode && o.voice.status === 'ready' && o.voice.provider === DOUBAO_PROVIDER) {
    return synthesizeDoubao(text, o.voice, o);
  }
  return synthesizeSapi(text, o);
}

/** 读取 WAV 头部估算时长：字节率 = 采样率 * 声道数 * 位深/8，data 块大小 / 字节率 */
function wavDurationMs(buffer) {
  try {
    if (buffer.length < 44) return 0;
    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bits = buffer.readUInt16LE(34);
    const byteRate = sampleRate * channels * (bits / 8);
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === 'data') return Math.round((size / (byteRate || 1)) * 1000);
      offset += 8 + size + (size % 2);
    }
    return 0;
  } catch (err) {
    return 0;
  }
}

module.exports = {
  DOUBAO_PROVIDER,
  available,
  synthesizeToWav,
  cloneVoice,
  queryVoice,
  downloadAudio,
  wavDurationMs,
  customSpeakerId
};
