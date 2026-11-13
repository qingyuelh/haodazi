/**
 * 鲸鱼娘桌宠 · 主进程
 *
 * 职责：
 *  - 起一个透明/无边框/置顶的桌宠窗口，窗口整体点击穿透，只有鲸鱼身体能点、能拖
 *  - 托盘常驻（显示隐藏、设置、立即播报、开机自启、退出）
 *  - 配置持久化到 userData/config.json
 *  - 整点自动播报（卡片 + 系统通知 + 语音）
 */
'use strict';

/**
 * 自愈：某些环境里 ELECTRON_RUN_AS_NODE=1 会让 electron.exe 以纯 Node 模式启动，
 * 这时 require('electron') 拿到的是 npm 包（一个字符串），app/ipcMain 全是 undefined。
 * 检测到这种状态就把自己以正常 Electron 模式重启一次。
 */
if (typeof process.type === 'undefined' && process.versions && process.versions.electron) {
  try {
    const { spawn } = require('child_process');
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, process.argv.slice(1), {
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    console.error('[whale] 无法以 Electron 模式重启', err);
  }
  process.exit(0);
}

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, Notification, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const calc = require('./lib/calc.js');
const tts = require('./lib/tts.js');

const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
const START_HIDDEN = process.argv.includes('--hidden');

// 整点播报时用户不一定刚点过窗口，放开自动播放限制，保证到点一定能出声
try {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
} catch (err) {
  /* 忽略 */
}

let petWin = null;
let settingsWin = null;
let tray = null;
let hourTimer = null;
let lastAnnouncedHour = '';
let dragging = null;
let pointerOver = false;

/* ------------------------------------------------------------------ 配置 */

const DEFAULT_CONFIG = {
  workStart: '09:00',
  workEnd: '18:00',
  monthlySalary: 10000,
  paydayDay: 15, // 1-31，0 = 月底
  workdays: [1, 2, 3, 4, 5], // ISO 星期：周一=1 … 周日=7
  salaryMode: 'month', // 'month' 按本月工作日 / 'fixed' 固定 21.75 天
  fixedWorkdays: 21.75,
  announceHourly: true,
  announceOnlyWhenWorking: false,
  speak: true,
  speakVolume: 0.9,
  speakRate: 0,
  voiceEngine: 'auto', // 'auto' | 'edge' | 'system'
  edgeVoice: 'zh-CN-XiaoyiNeural',
  systemVoice: 'Microsoft Yaoyao - Chinese (Simplified, PRC)',
  speechRate: 24, // Edge 语速百分比
  speechPitch: 30, // Edge 音调 Hz
  systemRate: 1.35, // 系统语音语速
  systemPitch: 1.7, // 系统语音音调（越高越甜）
  upbeatText: true, // 元气口吻的播报文案
  petScale: 1,
  clickThrough: true,
  alwaysOnTop: true,
  autostart: false,
  startHidden: false,
  posX: null,
  posY: null,
};

let config = { ...DEFAULT_CONFIG };

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

/** 改名后把老配置目录（鲸鱼娘桌宠）搬过来，别让老大之前的设置白设 */
function migrateLegacyConfig() {
  try {
    const legacy = path.join(app.getPath('appData'), '鲸鱼娘桌宠', 'config.json');
    const cur = configPath();
    if (!fs.existsSync(cur) && fs.existsSync(legacy)) {
      fs.mkdirSync(path.dirname(cur), { recursive: true });
      fs.copyFileSync(legacy, cur);
      console.log('[whale] 已从旧目录迁移配置');
    }
  } catch (err) {
    /* 忽略 */
  }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    // 外部用记事本/Excel 改过配置可能带 BOM，去掉再解析，否则 JSON.parse 会直接炸掉回落到默认值
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    config = { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

let saveTimer = null;
function saveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('[whale] 配置保存失败', err);
    }
  }, 200);
}

function broadcastConfig() {
  saveConfig();
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('config:changed', config);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('config:changed', config);
}

/* ------------------------------------------------------------------ 窗口 */

function layoutOf() {
  return calc.layout ? calc.layout(config.petScale) : null;
}

function createPetWindow() {
  const layout = layoutOf();
  const bounds = screen.getPrimaryDisplay().workArea;

  petWin = new BrowserWindow({
    title: '好搭子',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    width: layout.windowW,
    height: layout.windowH,
    x: config.posX == null ? Math.round(bounds.x + bounds.width - layout.windowW - 40) : config.posX,
    y: config.posY == null ? Math.round(bounds.y + bounds.height - layout.windowH - 30) : config.posY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: config.alwaysOnTop,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile(path.join(__dirname, 'pet.html'));

  // 默认整窗穿透，鼠标经过鲸鱼身体时渲染层会通知主进程临时关掉穿透
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      petWin.hide();
    }
  });

  petWin.once('ready-to-show', () => {
    if (!START_HIDDEN && !config.startHidden) petWin.showInactive();
  });

  petWin.on('moved', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.posX = x;
    config.posY = y;
    saveConfig();
  });
}

function applyAlwaysOnTop() {
  if (!petWin) return;
  petWin.setAlwaysOnTop(!!config.alwaysOnTop, 'screen-saver');
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const work = screen.getPrimaryDisplay().workArea;
  settingsWin = new BrowserWindow({
    width: 560,
    height: 780,
    x: Math.round(work.x + (work.width - 560) / 2),
    y: Math.round(work.y + (work.height - 780) / 2),
    minWidth: 520,
    minHeight: 600,
    title: '好搭子 · 设置',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

/* ------------------------------------------------------------------ 悬停 */

let petRect = null; // 渲染层上报的宠物矩形（屏幕坐标）
let lastWinPos = { x: -99999, y: -99999 }; // 窗口当前原点，避免重复 setPosition

/**
 * 悬停判定放在主进程：轮询系统光标位置，判断是否落在鲸鱼娘身上。
 * 比依赖 setIgnoreMouseEvents 转发过来的 mousemove 稳——转发在某些
 * 窗口状态下并不可靠，一旦漏事件，卡片就会卡住不消失。
 *
 * petRect 是渲染层上报的「屏幕坐标」矩形（窗口跟着宠物跑），
 * 命中区按角色身上真实有像素的范围收窄：鼠标必须真正落在她身上才出卡片。
 */
function cursorOverWhale() {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return false;
  if (!petRect) return false;
  const pt = screen.getCursorScreenPoint();
  const L = calc.LAYOUT;
  const x0 = petRect.x + petRect.w * L.visL;
  const x1 = petRect.x + petRect.w * L.visR;
  const y0 = petRect.y + petRect.h * L.visT;
  const y1 = petRect.y + petRect.h * L.visB;
  if (pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1) return true;
  // 播报气泡也要能点（点一下就消失）
  const b = petRect.bubble;
  if (b && b.w > 0) {
    const [wx, wy] = petWin.getPosition();
    if (pt.x >= wx + b.x && pt.x <= wx + b.x + b.w && pt.y >= wy + b.y && pt.y <= wy + b.y + b.h) {
      return true;
    }
  }
  return false;
}

function setPointerOver(next) {
  if (next === pointerOver) return;
  pointerOver = next;
  if (petWin && !petWin.isDestroyed()) {
    petWin.setIgnoreMouseEvents(!next, { forward: true });
    petWin.webContents.send('hover', next);
  }
}

let hoverTimer = null;
function startHoverWatch() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    if (dragging) return; // 拖拽中不判定悬停，免得窗口跟着鼠标跑时判定抖动
    setPointerOver(cursorOverWhale());
  }, 120);
}

/* ------------------------------------------------------------------ 托盘 */

function trayIcon() {
  const p = path.join(__dirname, '..', 'build', 'tray.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('好搭子 · ' + calc.snapshot(config).clock);
  refreshTrayMenu();
  tray.on('click', () => togglePet());
  tray.on('double-click', () => openSettings());
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = petWin && !petWin.isDestroyed() && petWin.isVisible();
  const menu = Menu.buildFromTemplate([
    { label: visible ? '隐藏桌宠' : '显示桌宠', click: () => togglePet() },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '立即播报一次', click: () => announceNow(true) },
    {
      label: '整点自动播报',
      type: 'checkbox',
      checked: !!config.announceHourly,
      click: (item) => {
        config.announceHourly = item.checked;
        broadcastConfig();
      },
    },
    {
      label: '语音播报',
      type: 'checkbox',
      checked: !!config.speak,
      click: (item) => {
        config.speak = item.checked;
        broadcastConfig();
      },
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!config.autostart,
      click: (item) => setAutostart(item.checked),
    },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

function togglePet() {
  if (!petWin || petWin.isDestroyed()) return;
  if (petWin.isVisible()) petWin.hide();
  else {
    petWin.showInactive();
    petWin.setIgnoreMouseEvents(true, { forward: true });
  }
  refreshTrayMenu();
}

/* ------------------------------------------------------------------ 播报 */

function speechTextOf() {
  return calc.speechText(calc.snapshot(config), { upbeat: !!config.upbeatText });
}

/**
 * 播报：优先用 Edge 神经网络音色（元气少女），拿不到就回落系统语音。
 * 音频交给桌宠窗口用 <audio> 播（Chromium 自带 mp3 解码）。
 */
async function speak(text) {
  if (!config.speak || !text) return null;
  const engine = config.voiceEngine || 'auto';
  const res = await tts.synthesize(text, {
    engine,
    voice: config.edgeVoice,
    rate: config.speechRate,
    pitch: config.speechPitch,
    volume: 0,
  });
  const payload = {
    mode: res ? res.engine : 'system',
    dataUrl: res ? res.url : null,
    text,
    systemVoice: config.systemVoice,
    systemRate: config.systemRate,
    systemPitch: config.systemPitch,
    volume: config.speakVolume,
  };
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('speak', payload);
  return payload;
}

function announceNow(force) {
  const snap = calc.snapshot(config);
  const text = calc.speechText(snap, { upbeat: !!config.upbeatText });
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('announce', { snap, text });
    if (petWin.isMinimized()) petWin.restore();
    petWin.showInactive();
  }
  if (force || config.announceHourly) {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: '鲸鱼娘桌宠',
        body: text,
        silent: false,
      });
      n.on('click', () => {
        if (petWin) petWin.showInactive();
      });
      n.show();
    }
  }
  speak(text);
  return text;
}

function scheduleHourly() {
  if (hourTimer) clearTimeout(hourTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 2, 0);
  const delay = Math.max(1000, next.getTime() - now.getTime());
  hourTimer = setTimeout(() => {
    hourTimer = null;
    try {
      const key = new Date().toISOString().slice(0, 13);
      if (key !== lastAnnouncedHour) {
        lastAnnouncedHour = key;
        const snap = calc.snapshot(config);
        const onlyWorking = !!config.announceOnlyWhenWorking;
        if (config.announceHourly && (!onlyWorking || snap.phase === 'working')) {
          announceNow(false);
        }
      }
    } catch (err) {
      console.error('[whale] 整点播报失败', err);
    }
    scheduleHourly();
  }, delay);
}

function setAutostart(enabled) {
  config.autostart = !!enabled;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: !!enabled,
      path: process.execPath,
      args: enabled ? ['--hidden'] : [],
    });
  } catch (err) {
    console.error('[whale] 开机自启设置失败', err);
  }
  broadcastConfig();
  refreshTrayMenu();
}

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('config:get', () => config);

ipcMain.handle('config:defaults', () => ({ ...DEFAULT_CONFIG }));

ipcMain.handle('config:save', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    config = { ...config, ...patch };
    broadcastConfig();
    applyAlwaysOnTop();
    refreshTrayMenu();
    const layout = layoutOf();
    if (petWin && !petWin.isDestroyed()) {
      petWin.setBounds({ width: layout.windowW, height: layout.windowH });
      petWin.webContents.send('layout:changed', envOf());
    }
  }
  return config;
});

ipcMain.handle('config:autostart', (_e, enabled) => {
  setAutostart(!!enabled);
  return config.autostart;
});

/** 渲染层需要的布局 + 屏幕环境（工作区、固定落点、初始位置） */
function envOf() {
  const layout = layoutOf();
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    ...layout,
    spot: calc.spot(layout),
    workArea: { x: wa.x, y: wa.y, width: wa.width, height: wa.height },
    home: {
      x: config.posX == null ? Math.round(wa.x + wa.width - layout.windowW - 40) : config.posX,
      y: config.posY == null ? Math.round(wa.y + wa.height - layout.windowH - 30) : config.posY,
    },
  };
}

ipcMain.handle('layout:get', () => envOf());

ipcMain.handle('settings:open', () => {
  openSettings();
  return true;
});

ipcMain.handle('announce:now', () => announceNow(true));

ipcMain.handle('tts:speak', (_e, text) => speak(text));

ipcMain.handle('tts:voices', () => ({
  edge: tts.EDGE_VOICES,
  system: tts.SYSTEM_VOICES,
  piper: tts.PIPER_VOICES,
  piperAvailable: tts.piperAvailable(),
}));

ipcMain.handle('app:quit', () => {
  quitApp();
  return true;
});

ipcMain.handle('app:toggle-visible', () => {
  togglePet();
  return true;
});

ipcMain.handle('app:state', () => ({
  version: app.getVersion(),
  portable: IS_PORTABLE,
  autostart: !!config.autostart,
}));

ipcMain.on('pet:pointer-over', (_e, over) => {
  setPointerOver(!!over);
});

ipcMain.on('pet:rect', (_e, rect) => {
  if (!rect || typeof rect.x !== 'number') return;
  petRect = rect;
  // 窗口跟着宠物跑：窗口原点 = 宠物屏幕位置 - 固定落点
  if (!petWin || petWin.isDestroyed()) return;
  const layout = layoutOf();
  const spot = calc.spot(layout);
  const nx = Math.round(rect.x - spot.x);
  const ny = Math.round(rect.y - spot.y);
  if (Math.abs(nx - lastWinPos.x) < 1 && Math.abs(ny - lastWinPos.y) < 1) return;
  lastWinPos.x = nx;
  lastWinPos.y = ny;
  petWin.setPosition(nx, ny);
});

ipcMain.on('pet:drag-start', (_e, grabX, grabY) => {
  dragging = { grabX: Number(grabX) || 0, grabY: Number(grabY) || 0 };
});

// 拖动过程中的位置由渲染层算好（屏幕坐标），主进程只需要跟着挪窗口，
// 这里保留接口是为了兼容旧调用
ipcMain.on('pet:drag-move', () => {});

ipcMain.on('pet:drag-end', () => {
  if (dragging && petWin) {
    const [x, y] = petWin.getPosition();
    const wa = screen.getPrimaryDisplay().workArea;
    config.posX = Math.round(Math.max(wa.x - 300, Math.min(wa.x + wa.width - 120, x)));
    config.posY = Math.round(Math.max(wa.y - 200, Math.min(wa.y + wa.height - 120, y)));
    saveConfig();
  }
  dragging = null;
});

/* ------------------------------------------------------------------ 生命周期 */

function quitApp() {
  app.isQuitting = true;
  saveConfig();
  if (hourTimer) clearTimeout(hourTimer);
  if (petWin && !petWin.isDestroyed()) {
    const [x, y] = petWin.getPosition();
    config.posX = x;
    config.posY = y;
  }
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    /* 忽略 */
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin) {
      petWin.showInactive();
      petWin.focus();
    }
  });

  app.whenReady().then(() => {
    migrateLegacyConfig();
    loadConfig();

    // 托盘图标
    try {
      const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
      if (fs.existsSync(iconPath)) {
        const img = nativeImage.createFromPath(iconPath);
        trayIcon.setTemplateImage(false);
      }
    } catch (err) {
      /* 忽略 */
    }

    createPetWindow();
    buildTray();
    scheduleHourly();
    startHoverWatch();

    // 全局快捷键：随时来一次整点播报（桌宠窗不可聚焦，走系统级快捷键最稳）
    try {
      const { globalShortcut } = require('electron');
      globalShortcut.register('CommandOrControl+Alt+W', () => announceNow(true));
      globalShortcut.register('CommandOrControl+Alt+S', () => openSettings());
    } catch (err) {
      console.error('[whale] 快捷键注册失败', err);
    }

    // 调试口子：带这个环境变量启动就立刻播报一次（自测用）
    if (process.env.WHALE_ANNOUNCE_ON_START) {
      setTimeout(() => announceNow(true), 2500);
    }

    if (config.autostart) {
      try {
        app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, path: process.execPath });
      } catch (err) {
        /* 忽略 */
      }
    }

    app.on('activate', () => {
      if (!petWin) createPetWindow();
    });
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });
}
