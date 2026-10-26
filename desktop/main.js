'use strict';

/**
 * Electron 桌面外壳：以子进程方式启动现有 Node 服务，再用窗口加载本机地址。
 * server.js 通过 ELECTRON_RUN_AS_NODE 使用 Electron 自带的 Node（含 node:sqlite），
 * 因此不需要额外打包一份 Node 运行时。
 */

const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const updater = require('./updater');

const APP_TITLE = '自媒体内容运营工作台';
const APP_ID = 'com.changsong.wemediacreator';
const STARTUP_TIMEOUT_MS = 60000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;

app.setName('WeMedia Creator Workstation');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app-server')
  : path.join(__dirname, '..');
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let tray = null;
let serverChild = null;
let serverPort = 0;
let serverLog = null;
let quitting = false;
let exiting = false;
let exitStarted = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function logFile() {
  return path.join(logDir(), 'server.log');
}

function openServerLog() {
  fs.mkdirSync(logDir(), { recursive: true });
  const file = logFile();
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) {
      const prev = file + '.1';
      try { fs.unlinkSync(prev); } catch (err) {}
      fs.renameSync(file, prev);
    }
  } catch (err) {
    /* 首次启动没有日志文件 */
  }
  return fs.createWriteStream(file, { flags: 'a' });
}

function pickPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!serverChild || serverChild.exitCode !== null) {
      throw new Error('本地服务已退出，请查看日志');
    }
    if (await ping(port)) return;
    await delay(300);
  }
  throw new Error('本地服务启动超时，请查看日志');
}

function startServer(port) {
  fs.mkdirSync(dataDir(), { recursive: true });
  serverLog = openServerLog();
  serverChild = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_VERSION: app.getVersion(),
      WB_DATA_DIR: dataDir()
    }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });

  serverChild.stdout.pipe(serverLog, { end: false });
  serverChild.stderr.pipe(serverLog, { end: false });
  serverChild.stdout.resume();
  serverChild.stderr.resume();

  serverChild.on('error', (err) => {
    console.warn('[desktop] 本地服务启动失败：', err.message);
  });

  serverChild.on('exit', (code, signal) => {
    serverChild = null;
    if (quitting || exiting) return;
    dialog
      .showMessageBox({
        type: 'error',
        title: '服务已停止',
        message: '本地服务意外退出',
        detail: `退出码 ${code}${signal ? '，信号 ' + signal : ''}。\n日志：${logFile()}`,
        buttons: ['重启应用', '退出'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          app.relaunch();
          quitApp();
        } else {
          quitApp();
        }
      })
      .catch(() => quitApp());
  });
}

function stopServer() {
  return new Promise((resolve) => {
    const child = serverChild;
    if (!child || child.exitCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (err) {}
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          });
        } catch (err) {}
      }
      setTimeout(finish, 500);
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
    try {
      child.send({ type: 'shutdown' });
    } catch (err) {
      try { child.kill(); } catch (e) {}
    }
  });
}

function isLocalUrl(url) {
  return typeof url === 'string' && url.indexOf(`http://127.0.0.1:${serverPort}`) === 0;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (serverPort) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (exiting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      { type: 'separator' },
      { label: '打开数据目录', click: () => shell.openPath(dataDir()) },
      { label: '检查更新', click: () => updater.checkNow(mainWindow) },
      { type: 'separator' },
      { label: '退出', click: quitApp }
    ])
  );
  tray.on('click', showWindow);
}

function quitApp() {
  if (exitStarted) return;
  exitStarted = true;
  quitting = true;
  stopServer()
    .catch(() => {})
    .then(() => {
      exiting = true;
      if (serverLog) {
        try { serverLog.end(); } catch (err) {}
      }
      app.quit();
    });
}

function fail(err) {
  const message = err && err.message ? err.message : String(err);
  try {
    dialog.showErrorBox('启动失败', message + '\n\n日志：' + logFile());
  } catch (e) {}
  quitApp();
}

async function start() {
  try {
    serverPort = await pickPort();
    startServer(serverPort);
    await waitForHealth(serverPort, STARTUP_TIMEOUT_MS);
    createWindow();
    createTray();
    updater.init({
      getWindow: () => mainWindow,
      beforeInstall: async () => {
        if (exitStarted) return;
        exitStarted = true;
        quitting = true;
        await stopServer();
        exiting = true;
      }
    });
  } catch (err) {
    fail(err);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {
    /* 关闭窗口只隐藏，服务继续在托盘运行 */
  });
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    quitApp();
  });
  app.whenReady().then(start);
}
