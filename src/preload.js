/**
 * 预加载桥：渲染层只能通过这里跟主进程说话。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whale', {
  /* 配置 */
  getConfig: () => ipcRenderer.invoke('config:get'),
  getDefaults: () => ipcRenderer.invoke('config:defaults'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  setAutostart: (v) => ipcRenderer.invoke('config:autostart', !!v),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (_e, cfg) => cb(cfg)),

  /* 布局 */
  getLayout: () => ipcRenderer.invoke('layout:get'),

  /* 桌宠交互 */
  setPointerOver: (v) => ipcRenderer.send('pet:pointer-over', !!v),
  setPetRect: (rect) => ipcRenderer.send('pet:rect', rect),
  onHover: (cb) => ipcRenderer.on('hover', (_e, v) => cb(!!v)),
  dragStart: (grabX, grabY) => ipcRenderer.send('pet:drag-start', grabX, grabY),
  dragMove: (screenX, screenY) => ipcRenderer.send('pet:drag-move', screenX, screenY),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  /* 播报 */
  announceNow: () => ipcRenderer.invoke('announce:now'),
  speak: (text) => ipcRenderer.invoke('tts:speak', text),
  voices: () => ipcRenderer.invoke('tts:voices'),
  onAnnounce: (cb) => ipcRenderer.on('announce', (_e, payload) => cb(payload)),
  onSpeak: (cb) => ipcRenderer.on('speak', (_e, payload) => cb(payload)),

  /* 应用 */
  openSettings: () => ipcRenderer.invoke('settings:open'),
  quit: () => ipcRenderer.invoke('app:quit'),
  toggleVisible: () => ipcRenderer.invoke('app:toggle-visible'),
  appState: () => ipcRenderer.invoke('app:state'),
});
