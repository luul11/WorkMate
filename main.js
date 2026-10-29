'use strict';

/**
 * WorkMate 桌面版 · 主进程
 *
 * Electron 的三层结构，先把这个记住，整份代码就通了：
 *   主进程（本文件）    Node 环境，能读文件、调 Win32、开窗口。只有它能碰系统。
 *   preload.js          桥。运行在渲染进程里，但拥有 Node 的 require 权限，
 *                       通过 contextBridge 只把「允许页面调用的那几个函数」暴露出去。
 *   渲染进程（renderer/）就是一个普通网页，拿不到 Node，只能通过 window.workmate 说话。
 *
 * 为什么采样放在主进程：渲染进程在窗口最小化/隐藏时会被浏览器节流，
 * 而我们要的是「不管窗口在不在，都在记」。放主进程才可靠。
 */

const { app, BrowserWindow, ipcMain, screen, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./modules/store');
const sampler = require('./modules/sampler');
const { classifyFull } = require('./modules/classify');

// 把数据目录钉死。
// Electron 默认用「应用名」拼 userData 路径，而应用名会跟着 productName 走。
// 不钉死的话，哪天改了产品名或换了 exe 名，用户昨天的数据就「不见了」——
// 其实没丢，只是应用去另一个文件夹找了。
app.setPath('userData', path.join(app.getPath('appData'), 'workmate-desktop'));

const IS_DEV = process.argv.includes('--dev');
const SAMPLE_MS = 60000;     // 采样节拍：1 分钟一拍。每拍给统计加 60 秒
const CURSOR_MS = 100;       // 光标轮询，桌宠转头要用

let mainWin = null;
let petWin = null;
let sampleTimer = null;
let cursorTimer = null;
let rotateTimer = null;

let lastCat = 'other';       // 前台是自己时，沿用它，避免把自己记成「其他」
let lastApp = null;
let dragState = null;        // {offsetX, offsetY} 拖动中才有值
let petHiddenUntil = 0;
let lastLookBucket = -1;

/* ---------------------------------------------------------------- 窗口 */

// 把渲染进程的报错转到主进程 stdout：不然页面白屏时只能干瞪眼
function wireLogs(win, tag) {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (!IS_DEV && level < 2) return;               // 非调试模式只留警告和错误
    console.log(`[${tag}] ${message}` + (source ? ` (${source}:${line})` : ''));
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    console.error(`[${tag}] preload 失败 ${p}:`, err.message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[${tag}] 渲染进程挂了:`, d.reason);
  });
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: '乐伴WorkMate',
    backgroundColor: '#F6F7FC',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer/assets/pet.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer/index.html'));
  wireLogs(mainWin, 'main');
  if (IS_DEV) mainWin.webContents.openDevTools({ mode: 'detach' });

  // 关掉窗口不等于退出：采样要继续跑。要真退，走桌宠右键菜单。
  mainWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  mainWin.on('closed', () => { mainWin = null; });
}

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 240;
  const H = 300;

  petWin = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 40,
    y: workArea.y + workArea.height - H - 40,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' 层级能压住全屏应用，普通 alwaysOnTop 不行
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true);
  petWin.loadFile(path.join(__dirname, 'renderer/pet.html'));
  wireLogs(petWin, 'pet');

  petWin.on('closed', () => { petWin = null; });
}

/* ---------------------------------------------------------------- 采样 */

function emitSample() {
  const s = sampler.sample(lastCat);

  if (s.app) lastApp = s.app;
  if (s.ok && s.cat !== 'self') lastCat = s.cat;

  // 这一拍不只是「前台是谁」，还包括当前开着的所有窗口。
  // 轮询页要的是完整明细，只给一行看不出它在干什么。
  let windows = [];
  try {
    windows = sampler.listWindows(40).map((w) => {
      const info = classifyFull(w.exe, w.title);
      return {
        exe: w.exe,
        name: info.name,
        cat: info.cat,
        known: info.known,
        title: w.title,
        fg: !!w.fg,
      };
    });
  } catch (e) {
    windows = [];
  }

  // step 是「这一拍代表多少秒」，由主进程定，渲染进程照着加。
  // 之所以不在页面里写死 5，就是为了改节拍只改一个地方。
  const payload = {
    at: Math.floor(Date.now() / 1000),
    step: Math.round(SAMPLE_MS / 1000),
    cat: s.cat || lastCat,
    app: s.app || lastApp,
    exe: s.exe || '',
    self: s.cat === 'self',
    title: s.title || '',
    known: s.known !== false,
    windows,
  };

  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('wm:sample', payload);
  }
}

function startLoop() {
  emitSample();
  sampleTimer = setInterval(emitSample, SAMPLE_MS);
}

/**
 * 光标轮询：桌宠转头靠它。
 * 只在「光标离窗口有一定距离」时才算方向——贴着狗脸的时候方向没有意义，
 * 会让它疯狂抽搐。
 */
function startCursorLoop() {
  cursorTimer = setInterval(() => {
    // 拖动中：把窗口粘在光标上
    if (dragState && petWin && !petWin.isDestroyed()) {
      const p = screen.getCursorScreenPoint();
      petWin.setPosition(Math.round(p.x - dragState.offsetX), Math.round(p.y - dragState.offsetY));
    }

    if (!petWin || petWin.isDestroyed()) return;

    // 隐藏满 30 分钟自己回来；不然用户会以为它丢了
    if (!petWin.isVisible()) {
      if (petHiddenUntil && Date.now() > petHiddenUntil) {
        petHiddenUntil = 0;
        petWin.showInactive();
      }
      return;
    }

    const p = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height * 0.72; // 头在窗口偏下的位置，不是正中
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 50) return; // 太近，忽略

    // 素材的角度约定：0=屏幕上方，顺时针每 22.5° 一格
    const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const bucket = Math.round(deg / 22.5) % 16;
    if (bucket === lastLookBucket) return;
    lastLookBucket = bucket;
    petWin.webContents.send('wm:look', bucket * 22.5);
  }, CURSOR_MS);
}

/* ---------------------------------------------------------------- IPC */

function registerIpc() {
  // ---- 采样 ----
  // 渲染进程挂好监听后会来要一次，补上「启动那一拍」，
  // 否则首屏要等一分钟才有「此刻在做」的数据
  ipcMain.on('wm:ready', () => emitSample());

  // ---- 存储 ----
  ipcMain.handle('wm:load', () => store.loadState());

  ipcMain.handle('wm:save', (_e, state) => {
    // 顺手把「今天用过的应用」写进温层日志，跨月后压成汇总
    return store.saveState(state);
  });

  ipcMain.handle('wm:log', (_e, evt) => store.appendLog(evt));
  ipcMain.handle('wm:usage', () => store.usage());
  ipcMain.handle('wm:rotate', () => store.rotate());
  ipcMain.handle('wm:open-data', () => shell.openPath(store.DATA_DIR()));

  // 页面里的外链一律交给系统浏览器，不在应用里悄悄开新窗口
  ipcMain.handle('wm:open-url', (_e, url) => {
    if (!/^(https?:|mailto:)/i.test(String(url || ''))) return false;
    shell.openExternal(url);
    return true;
  });

  // 清空全部数据：只删 data（state.json / logs / archive），
  // 不碰同级的 Cache、Local Storage 那些 Electron 自己拉的东西。
  ipcMain.handle('wm:reset', () => {
    const dir = store.DATA_DIR();
    let removed = 0;
    try {
      for (const name of ['state.json', 'state.json.tmp']) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) { fs.unlinkSync(p); removed += 1; }
      }
      for (const sub of ['logs', 'archive']) {
        const d = path.join(dir, sub);
        if (!fs.existsSync(d)) continue;
        for (const f of fs.readdirSync(d)) {
          if (/\.(jsonl|json)$/.test(f)) { fs.unlinkSync(path.join(d, f)); removed += 1; }
        }
      }
    } catch (e) {
      return { ok: false, error: e.message, removed };
    }
    return { ok: true, removed };
  });

  // ---- 环境信息（设置页展示用） ----
  ipcMain.handle('wm:env', () => ({
    isDesktop: true,
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    dataDir: store.DATA_DIR(),
    samplerOk: sampler.available(),
  }));

  // ---- 窗口 ----
  ipcMain.handle('wm:show-main', () => {
    if (!mainWin) createMainWindow();
    else { mainWin.show(); mainWin.focus(); }
  });

  ipcMain.handle('wm:quit', () => {
    app.isQuitting = true;
    app.quit();
  });

  ipcMain.handle('wm:pet-hide', (_e, minutes) => {
    petHiddenUntil = Date.now() + (minutes || 30) * 60000;
    if (petWin && !petWin.isDestroyed()) petWin.hide();
  });

  ipcMain.handle('wm:pet-show', () => {
    petHiddenUntil = 0;
    if (petWin && !petWin.isDestroyed()) petWin.show();
  });

  // ---- 桌宠状态广播（主窗算，宠物窗显示） ----
  ipcMain.on('wm:pet-state', (_e, name) => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('wm:pet-state', name);
  });

  ipcMain.on('wm:say', (_e, payload) => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('wm:say', payload);
  });

  // ---- 拖动 ----
  ipcMain.handle('wm:drag', (_e, phase) => {
    if (!petWin || petWin.isDestroyed()) return;
    if (phase === 'start') {
      const p = screen.getCursorScreenPoint();
      const b = petWin.getBounds();
      dragState = { offsetX: p.x - b.x, offsetY: p.y - b.y };
    } else if (phase === 'end') {
      dragState = null;
    }
  });

  // ---- 点击宠物 ----
  ipcMain.on('wm:pet-click', (_e, kind) => {
    if (kind === 'dbl') {
      if (!mainWin) createMainWindow();
      else { mainWin.show(); mainWin.focus(); }
      return;
    }
    // 单击交给渲染进程决定说什么——台词只在一个地方生成
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('wm:pet-click', kind);
  });

  // ---- 宠物右键菜单 ----
  ipcMain.on('wm:pet-menu', () => {
    if (!petWin || petWin.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
      { label: '打开主面板', click: () => { if (!mainWin) createMainWindow(); else { mainWin.show(); mainWin.focus(); } } },
      { label: '隐藏宠物 30 分钟', click: () => { petHiddenUntil = Date.now() + 30 * 60000; petWin.hide(); } },
      { type: 'separator' },
      { label: '打开数据文件夹', click: () => shell.openPath(store.DATA_DIR()) },
      { type: 'separator' },
      { label: '退出 乐伴WorkMate', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    menu.popup({ window: petWin });
  });
}

/* ---------------------------------------------------------------- 生命周期 */

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  registerIpc();
  createMainWindow();
  createPetWindow();
  startLoop();
  startCursorLoop();

  // 每 6 小时检查一次归档，免得跑到月底才发现日志该压了
  rotateTimer = setInterval(() => store.rotate(), 6 * 3600 * 1000);

  app.on('activate', () => {
    if (!mainWin) createMainWindow();
    else mainWin.show();
  });

  // 自检模式：点掉首屏 → 逐个 tab 截图 → 退出。
  // 只用于开发时确认界面没白屏，正式使用不会走到这里。
  if (process.argv.includes('--shot')) {
    const outDir = path.join(__dirname, '_shots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const js = (code) => mainWin.webContents.executeJavaScript(code);
    setTimeout(async () => {
      try {
        await js("var b=document.querySelector('#welcome-demo'); if(b) b.click(); null");
        await new Promise((r) => setTimeout(r, 2200));
        fs.writeFileSync(path.join(outDir, 'main.png'), (await mainWin.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(outDir, 'pet.png'), (await petWin.webContents.capturePage()).toPNG());

        // 手动触发一次冒险，验证「故事 → 气泡 → 日志 → 温层文件」整条链路
        await js("window.WorkMate.story(); null");
        await new Promise((r) => setTimeout(r, 900));
        fs.writeFileSync(path.join(outDir, 'today.png'), (await mainWin.webContents.capturePage()).toPNG());

        for (const pane of ['todo', 'memory', 'settings']) {
          await js(`document.querySelector('.tab[data-pane="${pane}"]').click(); null`);
          await new Promise((r) => setTimeout(r, 700));
          fs.writeFileSync(path.join(outDir, pane + '.png'), (await mainWin.webContents.capturePage()).toPNG());
        }
        console.log('[shot] done');
      } catch (e) {
        console.error('[shot] 失败', e.message);
      }
      app.isQuitting = true;
      app.quit();
    }, 2500);
  }
});

app.on('window-all-closed', () => {
  // 主窗关闭只是隐藏，正常不会走到这里；真走到了就是用户要退
  if (app.isQuitting) app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  clearInterval(sampleTimer);
  clearInterval(cursorTimer);
  clearInterval(rotateTimer);
});
