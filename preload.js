'use strict';

/**
 * preload · 渲染进程与主进程之间唯一的门
 *
 * 页面里拿不到 require、拿不到 fs、拿不到 ipcRenderer，
 * 只有这里白名单放出去的函数。想做坏事的第三方脚本最多也就调这几个。
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('workmate', {
  isDesktop: true,

  // 存储
  load: () => ipcRenderer.invoke('wm:load'),
  save: (state) => ipcRenderer.invoke('wm:save', state),
  log: (evt) => ipcRenderer.invoke('wm:log', evt),
  usage: () => ipcRenderer.invoke('wm:usage'),
  rotate: () => ipcRenderer.invoke('wm:rotate'),
  openData: () => ipcRenderer.invoke('wm:open-data'),
  openUrl: (url) => ipcRenderer.invoke('wm:open-url', url),
  reset: () => ipcRenderer.invoke('wm:reset'),
  env: () => ipcRenderer.invoke('wm:env'),

  // 采样：主进程每 1 分钟推一拍
  onSample: (cb) => subscribe('wm:sample', cb),
  // 页面挂好监听后喊一声，让主进程立刻补一拍，别让首屏空着
  ready: () => ipcRenderer.send('wm:ready'),

  // 桌宠
  petState: (name) => ipcRenderer.send('wm:pet-state', name),
  say: (payload) => ipcRenderer.send('wm:say', payload),
  onPetState: (cb) => subscribe('wm:pet-state', cb),
  onSay: (cb) => subscribe('wm:say', cb),
  onLook: (cb) => subscribe('wm:look', cb),
  onPetClick: (cb) => subscribe('wm:pet-click', cb),

  // 拖动与窗口
  drag: (phase) => ipcRenderer.invoke('wm:drag', phase),
  petClick: (kind) => ipcRenderer.send('wm:pet-click', kind),
  petMenu: () => ipcRenderer.send('wm:pet-menu'),
  showMain: () => ipcRenderer.invoke('wm:show-main'),
  petHide: (min) => ipcRenderer.invoke('wm:pet-hide', min),
  petShow: () => ipcRenderer.invoke('wm:pet-show'),
  quit: () => ipcRenderer.invoke('wm:quit'),
});
