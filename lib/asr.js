'use strict';

/**
 * 本地语音识别：ffmpeg 抽音频 + whisper.cpp 生成 SRT。
 *
 * 二进制优先使用 app 内置的 vendor（打包后位于 app-server/vendor），
 * 其次回退到系统 PATH 或 ffmpeg-static。模型不随安装包分发，
 * 首次转写时下载到 DATA_DIR/models，之后完全离线运行。
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./db');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const EXTRACT_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_STDERR = 20000;

const MODELS = {
  tiny: { file: 'ggml-tiny.bin', bytes: 77691713 },
  base: { file: 'ggml-base.bin', bytes: 147951465 },
  small: { file: 'ggml-small.bin', bytes: 487601967 },
  medium: { file: 'ggml-medium.bin', bytes: 1533774783 },
  'large-v3': { file: 'ggml-large-v3.bin', bytes: 3094623693 }
};
const MODEL_NAME = MODELS[process.env.WB_WHISPER_MODEL] ? process.env.WB_WHISPER_MODEL : 'small';
const MODEL = MODELS[MODEL_NAME];
const MODEL_DIR = path.join(DATA_DIR, 'models');
const MODEL_PATH = path.join(MODEL_DIR, MODEL.file);
const MODEL_PART = MODEL_PATH + '.part';

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const FFMPEG_DIR = path.join(VENDOR_DIR, 'ffmpeg');
const WHISPER_DIR = path.join(VENDOR_DIR, 'whisper', `${process.platform}-${process.arch}`);

let downloadState = { state: 'idle', received: 0, total: MODEL.bytes, error: '', startedAt: null };
let downloadPromise = null;

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (err) {
    return false;
  }
}

function exeNames(name) {
  if (process.platform !== 'win32') return [name];
  return [name + '.exe', name];
}

function findOnPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return '';
}

function findFfmpeg() {
  const env = process.env.WB_FFMPEG_PATH;
  if (env && isFile(env)) return { path: env, source: 'env' };
  for (const name of exeNames('ffmpeg')) {
    const bundled = path.join(FFMPEG_DIR, name);
    if (isFile(bundled)) return { path: bundled, source: 'bundled' };
  }
  try {
    let staticPath = require('ffmpeg-static');
    if (staticPath) {
      staticPath = String(staticPath).replace('app.asar', 'app.asar.unpacked');
      if (isFile(staticPath)) return { path: staticPath, source: 'ffmpeg-static' };
    }
  } catch (err) {
    /* 打包后 app-server 可能解析不到 node_modules */
  }
  const system = findOnPath('ffmpeg');
  return system ? { path: system, source: 'system' } : null;
}

function findWhisper() {
  const env = process.env.WB_WHISPER_PATH;
  if (env && isFile(env)) return { path: env, source: 'env' };
  const dirs = [WHISPER_DIR, path.join(WHISPER_DIR, 'Release')];
  for (const dir of dirs) {
    for (const name of ['whisper-cli', 'main']) {
      for (const exe of exeNames(name)) {
        const bundled = path.join(dir, exe);
        if (isFile(bundled)) return { path: bundled, source: 'bundled' };
      }
    }
  }
  for (const name of ['whisper-cli', 'main']) {
    const system = findOnPath(name);
    if (system) return { path: system, source: 'system' };
  }
  return null;
}

function modelReady() {
  try {
    const stat = fs.statSync(MODEL_PATH);
    return stat.isFile() && stat.size >= MODEL.bytes * 0.5;
  } catch (err) {
    return false;
  }
}

function modelStatus() {
  let size = 0;
  try {
    size = fs.statSync(MODEL_PATH).size;
  } catch (err) {
    size = 0;
  }
  return {
    name: MODEL_NAME,
    expectedBytes: MODEL.bytes,
    size,
    ready: modelReady()
  };
}

function status() {
  const ffmpeg = findFfmpeg();
  const whisper = findWhisper();
  const download = Object.assign({}, downloadState, {
    progress: downloadState.total ? Math.round((downloadState.received / downloadState.total) * 100) : 0
  });
  return {
    ffmpeg: { available: !!ffmpeg, source: ffmpeg ? ffmpeg.source : '' },
    whisper: { available: !!whisper, source: whisper ? whisper.source : '' },
    model: modelStatus(),
    download,
    offline: true
  };
}

function modelUrls() {
  const explicit = process.env.WB_WHISPER_MODEL_URL;
  if (explicit) return [explicit];
  const rel = 'ggerganov/whisper.cpp/resolve/main/' + MODEL.file;
  return ['https://hf-mirror.com/' + rel, 'https://huggingface.co/' + rel];
}

async function fetchToFile(url, target, onProgress) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Accept: 'application/octet-stream,*/*' }
  });
  if (!res.ok || !res.body) throw new Error('模型下载失败（HTTP ' + res.status + '）');

  const total = Number(res.headers.get('content-length')) || MODEL.bytes;
  downloadState.total = total;
  downloadState.received = 0;

  const handle = await fsp.open(target, 'w');
  let received = 0;
  try {
    for await (const chunk of res.body) {
      await handle.write(chunk);
      received += chunk.length;
      downloadState.received = received;
      if (onProgress) onProgress(Math.min(99, Math.round((received / total) * 100)));
    }
  } finally {
    await handle.close();
  }
  if (received < Math.min(MODEL.bytes * 0.5, 10 * 1024 * 1024)) {
    throw new Error('模型文件下载不完整，请重试');
  }
}

function downloadModel(onProgress) {
  if (modelReady()) {
    downloadState = { state: 'done', received: MODEL.bytes, total: MODEL.bytes, error: '', startedAt: null };
    return Promise.resolve(MODEL_PATH);
  }
  if (downloadPromise) return downloadPromise;

  const task = (async () => {
    await fsp.mkdir(MODEL_DIR, { recursive: true });
    let lastErr = null;
    for (const url of modelUrls()) {
      downloadState = {
        state: 'downloading',
        received: 0,
        total: MODEL.bytes,
        error: '',
        startedAt: new Date().toISOString()
      };
      try {
        await fsp.rm(MODEL_PART, { force: true });
        await fetchToFile(url, MODEL_PART, onProgress);
        await fsp.rename(MODEL_PART, MODEL_PATH);
        downloadState = {
          state: 'done',
          received: MODEL.bytes,
          total: MODEL.bytes,
          error: '',
          startedAt: null
        };
        return MODEL_PATH;
      } catch (err) {
        lastErr = err;
        await fsp.rm(MODEL_PART, { force: true }).catch(() => {});
      }
    }
    downloadState = {
      state: 'error',
      received: 0,
      total: MODEL.bytes,
      error: (lastErr && lastErr.message) || '模型下载失败',
      startedAt: null
    };
    throw lastErr || new Error('模型下载失败');
  })();

  downloadPromise = task;
  task.then(
    () => {
      if (downloadPromise === task) downloadPromise = null;
    },
    () => {
      if (downloadPromise === task) downloadPromise = null;
    }
  );
  return task;
}

function tail(text) {
  const s = String(text || '').trim();
  return s.length > 500 ? s.slice(-500) : s;
}

function runFfmpeg(bin, input, output, onProgress) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output];
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    let duration = 0;
    const timer = setTimeout(() => {
      try { child.kill(); } catch (err) {}
      reject(new Error('音频提取超时，请换一个更短的视频'));
    }, EXTRACT_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
      if (!duration) {
        const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (d) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
      }
      if (duration && onProgress) {
        const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
        const last = times[times.length - 1];
        if (last) {
          const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
          onProgress(Math.min(100, (sec / duration) * 100));
        }
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('无法启动 ffmpeg：' + err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('音频提取失败：' + tail(stderr)));
        return;
      }
      resolve({ duration: Math.round(duration) || 0 });
    });
  });
}

function runWhisper(bin, model, wav, outStem, onProgress) {
  return new Promise((resolve, reject) => {
    const threads = Math.max(2, Math.min(8, (os.cpus().length || 4) - 1));
    const language = process.env.WB_ASR_LANG || 'auto';
    const args = ['-m', model, '-f', wav, '-l', language, '-osrt', '-of', outStem, '-t', String(threads), '-pp'];
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (err) {}
      reject(new Error('语音识别超时，请换一个更短的视频'));
    }, TRANSCRIBE_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
      const m = stderr.match(/progress\s*=\s*(\d+)%/g);
      if (m && onProgress) {
        const last = m[m.length - 1].match(/(\d+)%/);
        if (last) onProgress(Math.min(100, Number(last[1])));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('无法启动 whisper：' + err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('语音识别失败：' + tail(stderr)));
        return;
      }
      resolve();
    });
  });
}

/**
 * 转写本地音视频文件，返回 SRT 文本与时长。
 * 由调用方负责清理上传的临时文件。
 */
async function transcribe(job, filePath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error('未找到 ffmpeg。请重新安装应用，或设置环境变量 WB_FFMPEG_PATH 指向 ffmpeg');
  }
  const whisper = findWhisper();
  if (!whisper) {
    throw new Error('未找到本地 whisper.cpp。请运行 npm run vendor:whisper，或安装 whisper-cli 后设置 WB_WHISPER_PATH');
  }
  if (!modelReady()) {
    job.stage = '下载语音模型 ' + MODEL_NAME;
    job.progress = 5;
    await downloadModel((p) => {
      job.stage = '下载语音模型 ' + MODEL_NAME + ' ' + p + '%';
      job.progress = 5 + Math.round(p * 0.25);
    });
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wb-asr-'));
  const wav = path.join(workDir, 'audio.wav');
  const outStem = path.join(workDir, 'out');
  try {
    job.stage = '提取音频';
    job.progress = 32;
    const meta = await runFfmpeg(ffmpeg.path, filePath, wav, (p) => {
      job.progress = 32 + Math.round(p * 0.08);
    });

    job.stage = '本地语音识别';
    job.progress = 40;
    await runWhisper(whisper.path, MODEL_PATH, wav, outStem, (p) => {
      job.progress = 40 + Math.round(p * 0.55);
    });

    const srt = await fsp.readFile(outStem + '.srt', 'utf8').catch(() => '');
    if (!srt.trim()) throw new Error('语音识别没有返回文字，请确认视频包含清晰人声');
    job.stage = '整理文案';
    job.progress = 96;
    return { srt, duration: meta.duration };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  MODEL_NAME,
  MODEL_PATH,
  modelReady,
  status,
  downloadModel,
  transcribe,
  findFfmpeg,
  findWhisper
};
