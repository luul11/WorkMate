'use strict';

/**
 * 前台识别探针（开发自检用，不参与打包）
 *
 *   node tools/foreground-probe.js                 列出当前所有带标题的顶层窗口，以及会被归到哪一类
 *   node tools/foreground-probe.js --activate chrome  把匹配的窗口切到前台，再走一遍真实采样
 *
 * 为什么要这个工具：光看代码不能证明「用户切到 WPS，它就真的读到 WPS」。
 * 这个脚本用和生产代码完全相同的 sampler，只是多了一步「主动切换窗口」，
 * 于是可以在没人操作的情况下跑一遍端到端验证。
 */

const koffi = require('koffi');

koffi.struct('PROBE_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const GetTopWindow = user32.func('void *GetTopWindow(void *hWnd)');
const GetWindow = user32.func('void *GetWindow(void *hWnd, uint32 cmd)');
const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)');
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, _Out_ uint16 *buf, int max)');
const GetWindowTextLengthW = user32.func('int GetWindowTextLengthW(void *hWnd)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void *hWnd)');
const ShowWindow = user32.func('bool ShowWindow(void *hWnd, int cmd)');
const BringWindowToTop = user32.func('bool BringWindowToTop(void *hWnd)');
const AttachThreadInput = user32.func('bool AttachThreadInput(uint32 a, uint32 b, bool attach)');
const keybd_event = user32.func('void keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func('bool QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)');
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()');

const { classify, classifyFull, selfCheck } = require('../modules/classify');
const sampler = require('../modules/sampler');

if (process.argv.includes('--selftest')) {
  const bad = selfCheck();
  if (bad.length) {
    console.log('FAIL: ' + bad.length + ' rows in classify table do not round-trip');
    for (const b of bad.slice(0, 8)) {
      console.log('  ' + b.exe + '  want ' + JSON.stringify(b.want) + '  got ' + JSON.stringify(b.got));
    }
    process.exit(1);
  }
  const samples = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'D:\\WPS Office\\11.1\\office6\\wps.exe',
    'D:\\Program Files\\Trae CN\\Trae CN.exe',
    'D:\\WorkBuddy\\WorkBuddy.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Windows\\System32\\notepad.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Windows\\System32\\LockApp.exe',
    'C:\\Windows\\explorer.exe',
    'C:\\unknown\\some-random-app.exe',
  ];
  for (const p of samples) {
    const r = classify(p);
    console.log(p.split('\\').pop().padEnd(20) + '-> ' + r.cat.padEnd(8) + ' known=' + r.known);
  }

  // 本应用靠「exe 名 + 窗口标题」双条件认，单独测一下
  const selfCases = [
    ['C:\\x\\electron.exe', 'WorkMate', 'self'],
    ['C:\\x\\electron.exe', '乐乐', 'self'],
    ['C:\\x\\electron.exe', 'Some Other Electron App', 'other'],
    ['C:\\Program Files\\乐伴WorkMate\\乐伴WorkMate.exe', '乐伴WorkMate', 'self'],   // 打包后的样子
  ];
  let bad2 = 0;
  for (const [exe, title, want] of selfCases) {
    const got = classifyFull(exe, title).cat;
    if (got !== want) { bad2++; console.log('SELF FAIL ' + title + ' -> ' + got + ' want ' + want); }
    else console.log(('self:' + title).padEnd(26) + '-> ' + got);
  }
  if (bad2) process.exit(1);

  // 遭遇系统的概率表：18 种狗，胜率和友好度是否满足设计
  const Story = require('../modules/story');
  const storyErrs = Story.selfCheck();
  if (storyErrs.length) {
    console.log('STORY FAIL:');
    storyErrs.forEach((x) => console.log('  ' + x));
    process.exit(1);
  }
  const byTier = {};
  for (const d of Story.DOGS) (byTier[d.tier] = byTier[d.tier] || []).push(d);
  for (const t of ['small', 'medium', 'large', 'giant']) {
    const list = byTier[t] || [];
    const cfg = Story.TIERS[t];
    const avgFriend = Math.round(list.reduce((s, d) => s + d.friend, 0) / list.length * 100);
    console.log(
      ('[' + cfg.label + ']').padEnd(11) + list.length + ' 种  ' +
      '胜 ' + Math.round(cfg.win * 100) + '%  平 ' + Math.round(cfg.draw * 100) +
      '%  逃 ' + Math.round(cfg.flee * 100) + '%  负 ' + Math.round(cfg.lose * 100) + '%' +
      '   友好均值 ' + avgFriend + '%'
    );
  }
  console.log('示例遭遇：');
  for (let i = 0; i < 3; i++) {
    const r = Story.tell({ apps: [] }, []);
    console.log('  [' + r.label + '] ' + r.text);
  }
  console.log('桌游示例（两套游戏 × 三种走向）：');
  for (const g of ['阿瓦隆', '狼人杀']) {
    for (const k of ['clever', 'clumsy', 'voted']) {
      const hit = Story.BOARD.filter((b) => b.game === g && b.kind === k)[0];
      if (hit) console.log('  [' + g + '/' + k + '] ' + hit.text);
    }
  }

  console.log('selftest passed');
  process.exit(0);
}

const GW_HWNDNEXT = 2;
const SW_RESTORE = 9;
const VK_MENU = 0x12;

function wide(buf, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function exeOfPid(pid) {
  const h = OpenProcess(0x1000, false, pid);
  if (!h) return '';
  try {
    const sizeBox = [1024];
    const buf = new Uint16Array(1024);
    if (!QueryFullProcessImageNameW(h, 0, buf, sizeBox)) return '';
    return wide(buf, sizeBox[0]);
  } finally {
    CloseHandle(h);
  }
}

function listWindows() {
  const out = [];
  let h = GetTopWindow(0);
  let guard = 0;
  while (h && guard++ < 4000) {
    if (IsWindowVisible(h) && GetWindowTextLengthW(h) > 0) {
      const pidBox = [0];
      GetWindowThreadProcessId(h, pidBox);
      const pid = pidBox[0];
      const buf = new Uint16Array(256);
      const len = GetWindowTextW(h, buf, 256);
      const exe = exeOfPid(pid);
      if (exe) {
        out.push({ hwnd: h, pid, exe, title: wide(buf, len), info: classify(exe) });
      }
    }
    h = GetWindow(h, GW_HWNDNEXT);
  }
  return out;
}

/** 切前台：Windows 有「前台锁」，直接 SetForegroundWindow 常常只闪任务栏。
 *  先按一下 Alt 骗过系统，再 AttachThreadInput 到自己线程，成功率最高。 */
function activate(hwnd) {
  const prev = GetForegroundWindow();
  ShowWindow(hwnd, SW_RESTORE);
  keybd_event(VK_MENU, 0, 0, 0);
  keybd_event(VK_MENU, 0, 2, 0);
  AttachThreadInput(GetCurrentThreadId(), GetWindowThreadProcessId(prev, [0]), true);
  SetForegroundWindow(hwnd);
  BringWindowToTop(hwnd);
  AttachThreadInput(GetCurrentThreadId(), GetWindowThreadProcessId(prev, [0]), false);
  return prev;
}

function sleep(ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { /* busy wait，同步脚本用 */ }
}

const target = (() => {
  const i = process.argv.indexOf('--activate');
  return i > 0 ? (process.argv[i + 1] || '').toLowerCase() : '';
})();

// --hold 12：让目标窗口保持前台 12 秒，好让应用主进程跑满两个采样周期
const hold = (() => {
  const i = process.argv.indexOf('--hold');
  return i > 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

if (!target) {
  const rows = listWindows();
  const fs = require('fs');
  const path = require('path');
  const outFile = path.join(__dirname, '..', '_shots', 'probe.json');
  try {
    if (!fs.existsSync(path.dirname(outFile))) fs.mkdirSync(path.dirname(outFile));
    fs.writeFileSync(outFile, JSON.stringify(
      rows.map((r) => ({ exe: r.exe.split('\\').pop(), cat: r.info.cat, name: r.info.name, known: r.info.known, title: r.title })),
      null, 2
    ), 'utf8');
  } catch (e) { console.error('dump failed', e.message); }

  // 控制台只输出 ASCII：中文在这里会被 pty 转码搞乱，完整内容看 probe.json
  console.log('exe'.padEnd(24) + 'cat'.padEnd(10) + 'known'.padEnd(7) + 'title');
  console.log('-'.repeat(88));
  for (const r of rows) {
    const base = r.exe.split('\\').pop();
    console.log(
      base.padEnd(24) +
      r.info.cat.padEnd(10) +
      String(r.info.known).padEnd(7) +
      r.title.replace(/[^\x20-\x7e]/g, '.').slice(0, 34)
    );
  }
  console.log('\nfull result with Chinese names -> _shots/probe.json');
  console.log('activate a window: --activate <exe-substring>');
  process.exit(0);
}

// ---------- 主动切换并采样 ----------
const rows = listWindows();
const hit = rows.filter((r) => r.exe.toLowerCase().includes(target));
if (!hit.length) {
  console.log('没找到匹配 "' + target + '" 的窗口。先把它打开再试。');
  process.exit(1);
}

const victim = hit[0];
console.log('切到：' + victim.exe.split('\\').pop() + '  |  ' + victim.title.slice(0, 40));
const prev = activate(victim.hwnd);
sleep(Math.max(700, hold * 1000));

const fg = GetForegroundWindow();
console.log('前台句柄是否等于目标：' + (fg === victim.hwnd ? '是' : '否（系统拒绝切换）'));

const s = sampler.sample('other');
console.log('采样结果：' + JSON.stringify(s, null, 1));

// 还原现场
if (prev) {
  sleep(200);
  activate(prev);
  console.log('已还原原来的前台窗口。');
}
