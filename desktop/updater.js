'use strict';

/**
 * 自动更新：electron-builder 在构建时把 publish 配置写入 app-update.yml，
 * electron-updater 从 generic provider（阿里云 OSS）拉取 latest*.yml。
 *
 * macOS 未签名，Squirrel.Mac 会拒绝更新包，因此 darwin 直接跳过更新检查。
 */

const { app, dialog } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10 * 1000;

let autoUpdater = null;
let getWindow = () => null;
let beforeInstall = async () => {};
let manualCheck = false;
let lastProgress = -1;

function logger() {
  return {
    info: (msg) => console.log('[update]', msg),
    warn: (msg) => console.warn('[update]', msg),
    error: (msg) => console.warn('[update]', msg),
    debug: (msg) => console.log('[update]', msg)
  };
}

function supported() {
  return app.isPackaged && process.platform !== 'darwin';
}

async function check(manual) {
  if (!autoUpdater) return;
  manualCheck = !!manual;
  lastProgress = -1;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn('[update] 检查更新失败：', err && err.message ? err.message : err);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(getWindow() || null, {
        type: 'warning',
        title: '检查更新失败',
        message: '暂时无法连接更新服务器',
        detail: String(err && err.message ? err.message : err)
      });
    }
  }
}

function init(options) {
  getWindow = (options && options.getWindow) || getWindow;
  beforeInstall = (options && options.beforeInstall) || beforeInstall;
  if (!supported()) return null;

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('[update] electron-updater 不可用：', err.message);
    return null;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = logger();

  autoUpdater.on('checking-for-update', () => console.log('[update] 正在检查更新'));
  autoUpdater.on('update-not-available', () => {
    console.log('[update] 已是最新版本');
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(getWindow() || null, {
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        detail: '版本 ' + app.getVersion()
      });
    }
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[update] 发现新版本', info && info.version);
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (progress) => {
    if (!progress || typeof progress.percent !== 'number') return;
    const step = Math.floor(progress.percent / 10);
    if (step > lastProgress) {
      lastProgress = step;
      console.log(`[update] 下载进度 ${Math.round(progress.percent)}%`);
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[update] 更新失败：', err && err.message ? err.message : err);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(getWindow() || null, {
        type: 'warning',
        title: '检查更新失败',
        message: '更新过程中出错',
        detail: String(err && err.message ? err.message : err)
      });
    }
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win || null, {
      type: 'info',
      title: '发现新版本',
      message: `新版本 ${info && info.version ? info.version : ''} 已下载完成`,
      detail: '重启应用即可完成更新；选择“稍后”会在下次退出时自动安装。',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) {
      await beforeInstall();
      autoUpdater.quitAndInstall(false, true);
    }
  });

  setTimeout(() => check(false), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => check(false), CHECK_INTERVAL_MS).unref();
  console.log('[update] 自动更新已启用（generic provider）');
  return autoUpdater;
}

function checkNow(window) {
  const parent = window || getWindow();
  if (!autoUpdater) {
    const detail =
      process.platform === 'darwin'
        ? '当前 macOS 版本未签名，无法自动更新，请从下载页手动安装新版本。'
        : '当前为开发环境，未启用自动更新。';
    dialog.showMessageBox(parent || null, {
      type: 'info',
      title: '检查更新',
      message: '当前版本不支持自动更新',
      detail
    });
    return;
  }
  dialog
    .showMessageBox(parent || null, {
      type: 'info',
      title: '检查更新',
      message: '正在检查更新',
      detail: '发现新版本后会后台下载，并在下载完成后提示重启。',
      buttons: ['确定'],
      defaultId: 0
    })
    .then(() => check(true));
}

module.exports = { init, checkNow, supported };
