'use strict';

/**
 * 视频工坊渲染层：分镜图片/视频 → 统一规格片段（Ken Burns 运镜）→ concat 拼接成片。
 *
 * 所有片段统一为 项目宽高 / 30fps / yuv420p / libx264 crf20 / 无音轨，
 * 因此成片可用 concat 分离器 -c copy 快速拼接。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');
const projects = require('./projects');
const assets = require('./assets');
const asr = require('../asr');

const FPS = 30;

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

function ffmpegPath() {
  const found = asr.findFfmpeg();
  if (!found) {
    throw httpError(500, '未找到 ffmpeg。请重新安装应用，或设置环境变量 WB_FFMPEG_PATH');
  }
  return found.path;
}

function run(bin, args, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd: cwd || undefined });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
      reject(httpError(504, 'ffmpeg 处理超时'));
    }, timeoutMs || 600000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('无法启动 ffmpeg：' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(httpError(502, 'ffmpeg 处理失败：' + lastLines(err, 6)));
    });
  });
}

function lastLines(text, n) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).join(' | ').slice(0, 500);
}

function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** 生成 zoompan 运镜表达式；不同分镜交替变化，避免整片单调 */
function kenBurnsFilter(project, scene, durationMs) {
  const W = even(project.width);
  const H = even(project.height);
  const preW = even(W * 1.5);
  const preH = even(H * 1.5);
  const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));
  const variant = (scene.idx || 0) % 3;
  let z, x, y;
  if (variant === 1) {
    z = "max(1.12-0.12*on/" + frames + ",1.0)";
    x = "iw/2-(iw/zoom/2)";
    y = "ih/2-(ih/zoom/2)";
  } else if (variant === 2) {
    z = "1.08";
    x = "(iw-iw/zoom)*on/" + frames;
    y = "ih/2-(ih/zoom/2)";
  } else {
    z = "min(1+0.12*on/" + frames + ",1.12)";
    x = "iw/2-(iw/zoom/2)";
    y = "ih/2-(ih/zoom/2)";
  }
  return [
    "scale=" + preW + ":" + preH + ":force_original_aspect_ratio=increase",
    "crop=" + preW + ":" + preH,
    "zoompan=z='" + z + "':x='" + x + "':y='" + y + "':d=" + frames + ":s=" + W + "x" + H + ":fps=" + FPS,
    "setsar=1",
    "format=yuv420p"
  ].join(',');
}

function resolveFont() {
  const candidates = process.platform === 'win32'
    ? ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/simhei.ttf']
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc']
      : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'];
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (fs.statSync(candidates[i]).isFile()) return candidates[i];
    } catch (err) { /* 继续找下一个 */ }
  }
  return '';
}

/** filtergraph 里的路径：盘符冒号要转义，整体用单引号包住 */
function filterPath(p) {
  return "'" + String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'") + "'";
}

function textUnit(ch) {
  const code = ch.codePointAt(0);
  if (code > 0x2e80) return 1;
  return ch === ' ' ? 0.4 : 0.55;
}

/** 按显示宽度折行（中文 1，英文约 0.55），保留原有换行 */
function wrapText(text, maxUnits) {
  const lines = [];
  String(text || '').replace(/\r/g, '').split('\n').forEach((para) => {
    if (!para) { lines.push(''); return; }
    let line = '';
    let units = 0;
    for (const ch of para) {
      const u = textUnit(ch);
      if (units + u > maxUnits && line) {
        lines.push(line);
        line = '';
        units = 0;
      }
      line += ch;
      units += u;
    }
    if (line) lines.push(line);
  });
  return lines.join('\n');
}

/** 分镜字幕：写到片段同目录的文本文件（相对路径），避免在 filtergraph 里转义文字 */
function makeSubtitleVf(project, scene, dir) {
  const text = String(scene.onScreenText || '').trim();
  if (!text) return null;
  const font = resolveFont();
  if (!font) return null;
  const W = even(project.width);
  const H = even(project.height);
  const maxUnits = Math.max(8, Math.floor((W * 0.72) / (H / 22)));
  const fileName = 'sub-' + String(scene.id).slice(0, 8) + '-' + Date.now() + '.txt';
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, wrapText(text, maxUnits), 'utf8');
  const vf = 'drawtext=fontfile=' + filterPath(font) +
    ':textfile=' + fileName +
    ':fontcolor=white:fontsize=h/22:line_spacing=8:borderw=3:bordercolor=black@0.9' +
    ':x=(w-text_w)/2:y=h-text_h-h*0.06';
  return { vf, file };
}

async function burnTitle(videoPath, text, seconds, workDir, timeoutMs) {
  const font = resolveFont();
  if (!font) return videoPath;
  const file = path.join(workDir, 'title.txt');
  fs.writeFileSync(file, wrapText(text, 18), 'utf8');
  const out = path.join(workDir, 'final-title.mp4');
  const vf = 'drawtext=fontfile=' + filterPath(font) +
    ':textfile=title.txt:fontcolor=white:fontsize=h/14:line_spacing=12:borderw=5:bordercolor=black@0.85' +
    ':x=(w-text_w)/2:y=h*0.08:enable=' + "'between(t,0," + seconds + ")'";
  await run(ffmpegPath(), [
    '-y', '-i', videoPath, '-vf', vf,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an',
    '-movflags', '+faststart', out
  ], timeoutMs, workDir);
  try { fs.rmSync(file, { force: true }); } catch (err) { /* noop */ }
  return out;
}

function videoNormalizeFilter(project) {
  const W = even(project.width);
  const H = even(project.height);
  return [
    "scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease",
    "pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2:color=black",
    "setsar=1",
    "fps=" + FPS,
    "format=yuv420p"
  ].join(',');
}

function segmentPath(project, scene) {
  const dir = path.join(projects.projectRoot(project.code), 'segments');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'seg-' + String(scene.id).slice(0, 8) + '-' + Date.now() + '.mp4');
}

function ensureAssetFile(assetId) {
  if (!assetId) return null;
  const found = assets.getAsset(assetId);
  if (!found || !found.filePath) return null;
  try {
    fs.statSync(found.filePath);
    return found;
  } catch (err) {
    return null;
  }
}

/**
 * 渲染单个分镜为统一规格片段。renderMode=video 且有视频素材时用视频，
 * 否则用图片做 Ken Burns。
 */
async function renderSceneSegment(projectId, sceneId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scene = (project.scenes || []).find((s) => s.id === sceneId);
  if (!scene) throw httpError(404, '分镜不存在');

  const videoFound = scene.renderMode === 'video' ? ensureAssetFile(scene.videoAssetId) : null;
  const imageFound = ensureAssetFile(scene.imageAssetId);
  if (!videoFound && !imageFound) {
    throw httpError(400, '分镜「' + (scene.title || scene.idx) + '」还没有图片或视频素材，请先生成图片');
  }

  const out = segmentPath(project, scene);
  const bin = ffmpegPath();
  const durSec = Math.max(0.5, Number(scene.durationMs) / 1000);
  const common = ['-y', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart'];
  const segDir = path.dirname(out);
  const sub = makeSubtitleVf(project, scene, segDir);
  const withSub = (vf) => (sub ? vf + ',' + sub.vf : vf);

  projects.updateScene(sceneId, { status: 'generating' });
  try {
    if (videoFound) {
      await run(bin, [
        '-y', '-i', videoFound.filePath, '-t', String(durSec),
        '-vf', withSub(videoNormalizeFilter(project)),
        ...common.slice(1), out
      ], o.timeoutMs || 600000, segDir);
    } else {
      await run(bin, [
        '-y', '-loop', '1', '-i', imageFound.filePath, '-t', String(durSec),
        '-vf', withSub(kenBurnsFilter(project, scene, scene.durationMs)),
        ...common.slice(1), out
      ], o.timeoutMs || 600000, segDir);
    }
  } catch (err) {
    projects.updateScene(sceneId, { status: 'failed' });
    try { fs.rmSync(out, { force: true }); } catch (e) { /* noop */ }
    throw err;
  } finally {
    if (sub) { try { fs.rmSync(sub.file, { force: true }); } catch (e) { /* noop */ } }
  }

  const buffer = fs.readFileSync(out);
  const asset = assets.saveBuffer(projectId, {
    kind: 'segment',
    sceneId,
    buffer,
    ext: 'mp4',
    mime: 'video/mp4',
    provider: 'ffmpeg',
    model: 'kenburns',
    width: project.width,
    height: project.height,
    durationMs: scene.durationMs,
    meta: { from: videoFound ? 'video' : 'image' }
  });
  try { fs.rmSync(out, { force: true }); } catch (e) { /* noop */ }
  if (scene.segmentAssetId && scene.segmentAssetId !== asset.id) {
    // 旧片段已被新片段取代，顺手清理，避免素材目录堆积
    assets.deleteAsset(scene.segmentAssetId);
  }
  const updated = projects.updateScene(sceneId, { segmentAssetId: asset.id, status: 'ready' });
  return { scene: updated, asset };
}

function concatLine(filePath) {
  return "file '" + filePath.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
}

/** 按分镜时长拼一条完整音轨：有配音的补齐/截断，无配音的补静音 */
async function buildAudioTrack(scenes, workDir, timeoutMs) {
  const bin = ffmpegPath();
  const files = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const dur = Math.max(0.5, Number(sc.durationMs) / 1000);
    const out = path.join(workDir, 'aud-' + String(i + 1).padStart(3, '0') + '.m4a');
    const audioFound = ensureAssetFile(sc.audioAssetId);
    if (audioFound) {
      await run(bin, [
        '-y', '-i', audioFound.filePath, '-af', 'aresample=48000,apad', '-t', String(dur),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', out
      ], timeoutMs);
    } else {
      await run(bin, [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(dur),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', out
      ], timeoutMs);
    }
    files.push(out);
  }
  const list = path.join(workDir, 'audiolist.txt');
  fs.writeFileSync(list, files.map(concatLine).join('\n'), 'utf8');
  const concatOut = path.join(workDir, 'audio-all.m4a');
  await run(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', concatOut], timeoutMs);
  return concatOut;
}

const BGM_MAX_BYTES = 12 * 1024 * 1024;

function clampVolume(v, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function clampTitleSeconds(v, totalSec) {
  const n = Number(v);
  const sec = isFinite(n) && n > 0 ? n : 3;
  return Math.min(10, Math.max(1, Math.min(sec, Math.max(1, totalSec))));
}

function projectSettings(project) {
  return (project && project.settings) || {};
}

/** 上传 / 替换背景音乐：落盘为 audio 素材并在项目 settings 里记住 */
async function setBgm(projectId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  if (!o.dataUrl) throw httpError(400, '缺少音频文件内容');
  const m = /^data:([^;,]+)?(;base64)?,/.exec(String(o.dataUrl));
  const mime = (m && m[1]) || '';
  if (mime && mime.indexOf('audio/') !== 0) throw httpError(400, '只支持音频文件（mp3 / m4a / wav / ogg）');
  const b64 = String(o.dataUrl).split(',')[1] || '';
  if (Math.floor((b64.length * 3) / 4) > BGM_MAX_BYTES) throw httpError(413, '背景音乐请控制在 12MB 内');

  const settings = projectSettings(project);
  const asset = await assets.saveFromUrl(projectId, {
    kind: 'audio',
    dataUrl: o.dataUrl,
    provider: 'upload',
    meta: { role: 'bgm', name: o.name || '' }
  });
  const oldId = settings.bgmAssetId;
  const updated = projects.updateProject(projectId, {
    settings: Object.assign({}, settings, {
      bgmAssetId: asset.id,
      bgmName: o.name || asset.fileName,
      bgmVolume: clampVolume(o.volume, clampVolume(settings.bgmVolume, 0.35))
    })
  });
  if (oldId && oldId !== asset.id) assets.deleteAsset(oldId);
  return { project: updated, asset };
}

function setBgmVolume(projectId, opts) {
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const settings = projectSettings(project);
  if (!settings.bgmAssetId) throw httpError(400, '还没有设置背景音乐');
  const updated = projects.updateProject(projectId, {
    settings: Object.assign({}, settings, { bgmVolume: clampVolume(opts && opts.volume, 0.35) })
  });
  return { project: updated };
}

function clearBgm(projectId) {
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const settings = projectSettings(project);
  const oldId = settings.bgmAssetId;
  const next = Object.assign({}, settings);
  delete next.bgmAssetId;
  delete next.bgmName;
  const updated = projects.updateProject(projectId, { settings: next });
  if (oldId) assets.deleteAsset(oldId);
  return { project: updated };
}

/** 片头标题设置：titleText 为空字符串表示不显示标题 */
function setTitle(projectId, opts) {
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const o = opts || {};
  const settings = projectSettings(project);
  const next = Object.assign({}, settings);
  if (typeof o.titleText === 'string') next.titleText = o.titleText.trim().slice(0, 200);
  if (o.titleSeconds != null) {
    const n = Number(o.titleSeconds);
    next.titleSeconds = isFinite(n) ? Math.min(10, Math.max(1, Math.round(n * 10) / 10)) : 3;
  }
  return { project: projects.updateProject(projectId, { settings: next }) };
}

/** 把循环背景音乐混入已有成片；hasVoice 为真时与原音轨 amix，否则直接当音轨 */
async function muxBgm(videoPath, bgmPath, volume, totalSec, workDir, hasVoice, timeoutMs) {
  const out = path.join(workDir, 'final-bgm.mp4');
  const vol = String(clampVolume(volume, 0.35));
  const filter = hasVoice
    ? '[1:a]volume=' + vol + '[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]'
    : '[1:a]volume=' + vol + '[bg]';
  const args = [
    '-y', '-i', videoPath, '-stream_loop', '-1', '-i', bgmPath,
    '-filter_complex', filter,
    '-map', '0:v:0', '-map', hasVoice ? '[a]' : '[bg]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'
  ];
  if (hasVoice) args.push('-shortest');
  else args.push('-t', String(Math.max(0.5, totalSec)));
  args.push('-movflags', '+faststart', out);
  await run(ffmpegPath(), args, timeoutMs);
  return out;
}

/**
 * 合成整片：逐个分镜出片段（缺失片段时自动用现有图片渲染），再 concat 拼接。
 */
async function assembleProject(projectId, opts) {
  const o = opts || {};
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  const scenes = project.scenes || [];
  if (!scenes.length) throw httpError(400, '还没有分镜，无法合成成片');
  const settings = projectSettings(project);

  const missing = scenes.filter((sc) => {
    const hasImg = !!ensureAssetFile(sc.imageAssetId);
    const hasVid = sc.renderMode === 'video' && !!ensureAssetFile(sc.videoAssetId);
    return !hasImg && !hasVid;
  });
  if (missing.length) {
    throw httpError(400, '还有 ' + missing.length + ' 个分镜没有画面素材，请先生成图片');
  }

  const renderRowId = uid();
  const ts = now();
  conn()
    .prepare(
      `INSERT INTO video_renders (id, project_id, status, stage, progress, params, created_at, updated_at)
       VALUES (?, ?, 'running', '渲染分镜片段', 0, ?, ?, ?)`
    )
    .run(renderRowId, projectId, JSON.stringify({ aspect: project.aspect }), ts, ts);
  projects.updateProject(projectId, { status: 'rendering' });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmc-render-'));
  const segmentFiles = [];
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      let existing = ensureAssetFile(sc.segmentAssetId);
      if (!existing) {
        // 片段按分镜缓存：只渲染缺失的片段，已就绪的复用，便于单场景重生成后整体重拼
        const res = await renderSceneSegment(projectId, sc.id, { timeoutMs: o.timeoutMs });
        existing = ensureAssetFile(res.asset.id);
        if (!existing) throw httpError(502, '片段输出丢失：' + (sc.title || sc.idx));
      }
      segmentFiles.push(existing.filePath);
      const pct = Math.round(((i + 1) / scenes.length) * 85);
      conn()
        .prepare('UPDATE video_renders SET progress = ?, stage = ?, updated_at = ? WHERE id = ?')
        .run(pct, '渲染分镜片段 ' + (i + 1) + '/' + scenes.length, now(), renderRowId);
    }

    const listFile = path.join(workDir, 'list.txt');
    fs.writeFileSync(listFile, segmentFiles.map(concatLine).join('\n'), 'utf8');
    let finalOut = path.join(workDir, 'final.mp4');
    conn().prepare('UPDATE video_renders SET stage = ?, progress = 88, updated_at = ? WHERE id = ?')
      .run('拼接成片', now(), renderRowId);
    await run(ffmpegPath(), [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', finalOut
    ], o.timeoutMs || 600000);

    const totalSec = scenes.reduce((sum, sc) => sum + Math.max(0.5, Number(sc.durationMs) / 1000), 0);

    // 片头标题：settings.titleText 没设置过就退回项目标题，空字符串表示不显示
    const titleText = String(typeof settings.titleText === 'string' ? settings.titleText : (project.title || '')).trim();
    if (titleText) {
      conn().prepare('UPDATE video_renders SET stage = ?, progress = 90, updated_at = ? WHERE id = ?')
        .run('叠加片头标题', now(), renderRowId);
      const titleSec = clampTitleSeconds(settings.titleSeconds, totalSec);
      finalOut = await burnTitle(finalOut, titleText, titleSec, workDir, o.timeoutMs || 600000);
    }

    const hasVoice = scenes.some((sc) => ensureAssetFile(sc.audioAssetId));
    const bgmFound = ensureAssetFile(settings.bgmAssetId);

    // 有配音时按分镜时长拼一条完整音轨，再与视频合流
    if (hasVoice) {
      conn().prepare('UPDATE video_renders SET stage = ?, progress = 92, updated_at = ? WHERE id = ?')
        .run('合成配音音轨', now(), renderRowId);
      const audioM4a = await buildAudioTrack(scenes, workDir, o.timeoutMs || 600000);
      const muxed = path.join(workDir, 'final-audio.mp4');
      await run(ffmpegPath(), [
        '-y', '-i', finalOut, '-i', audioM4a,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
        '-movflags', '+faststart', muxed
      ], o.timeoutMs || 600000);
      finalOut = muxed;
    }

    // 背景音乐：循环铺满整片；有配音时混音，无配音时作为唯一音轨
    if (bgmFound) {
      conn().prepare('UPDATE video_renders SET stage = ?, progress = 95, updated_at = ? WHERE id = ?')
        .run('混入背景音乐', now(), renderRowId);
      finalOut = await muxBgm(finalOut, bgmFound.filePath, settings.bgmVolume, totalSec, workDir, hasVoice, o.timeoutMs || 600000);
    }

    const buffer = fs.readFileSync(finalOut);
    const asset = assets.saveBuffer(projectId, {
      kind: 'final',
      buffer,
      ext: 'mp4',
      mime: 'video/mp4',
      provider: 'ffmpeg',
      model: 'concat',
      width: project.width,
      height: project.height,
      durationMs: scenes.reduce((sum, sc) => sum + Number(sc.durationMs || 0), 0),
      meta: { sceneCount: scenes.length }
    });

    conn()
      .prepare(
        `UPDATE video_renders SET status = 'done', stage = '完成', progress = 100, output_asset_id = ?, finished_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(asset.id, now(), now(), renderRowId);
    projects.updateProject(projectId, { status: 'done' });
    return { renderId: renderRowId, outputAssetId: asset.id, asset };
  } catch (err) {
    conn()
      .prepare(`UPDATE video_renders SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .run(String(err.message || err).slice(0, 500), now(), now(), renderRowId);
    projects.updateProject(projectId, { status: 'storyboarding' });
    throw err;
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }
}

module.exports = {
  renderSceneSegment,
  assembleProject,
  setBgm,
  setBgmVolume,
  clearBgm,
  setTitle,
  ffmpegPath
};
