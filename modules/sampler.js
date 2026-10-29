'use strict';

/**
 * 前台窗口探针（Windows）
 *
 * 为什么要 koffi：读前台进程必须调 Win32，Node 本身没有这个能力。
 * koffi 是 FFI，npm 包里直接带预编译二进制，不装 MSVC、不跑 node-gyp，
 * 这是「零编译风险」和「不额外起进程」之间的最优解。
 *
 * 两个能力：
 *   readForeground()  只读当前前台那一个窗口，每分钟采样用
 *   listWindows()     把当前所有带标题的窗口列一遍，「轮询明细」页用
 *
 * 调用链：
 *   GetForegroundWindow        → 前台窗口句柄
 *   GetWindowThreadProcessId   → 句柄换 PID
 *   OpenProcess + QueryFullProcessImageNameW → PID 换 exe 完整路径
 *
 * 任何一步失败都返回空，调用方按「读不到」处理，绝不让主进程崩。
 */

const { classifyFull } = require('./classify');

let api = null;
let loadError = null;

const GW_HWNDNEXT = 2;

function init() {
  if (api || loadError) return api;
  try {
    const koffi = require('koffi');

    // 结构体必须在声明函数签名之前注册，否则 koffi 找不到类型名
    koffi.struct('WM_POINT', { x: 'int32', y: 'int32' });

    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    api = {
      GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
      GetTopWindow: user32.func('void *GetTopWindow(void *hWnd)'),
      GetWindow: user32.func('void *GetWindow(void *hWnd, uint32 cmd)'),
      IsWindowVisible: user32.func('bool IsWindowVisible(void *hWnd)'),
      GetWindowTextLengthW: user32.func('int GetWindowTextLengthW(void *hWnd)'),
      GetWindowTextW: user32.func('int GetWindowTextW(void *hWnd, _Out_ uint16 *buf, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)'),
      // PROCESS_QUERY_LIMITED_INFORMATION = 0x1000，比 QUERY_INFORMATION 权限低，
      // 对普通权限运行的进程足够，也不会因为权限不足而失败
      OpenProcess: kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)'),
      CloseHandle: kernel32.func('bool CloseHandle(void *h)'),
    };
  } catch (e) {
    loadError = e;
    console.error('[sampler] Win32 接口不可用：', e.message);
  }
  return api;
}

function readWide(buf, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function exeOfPid(a, pid) {
  if (!pid) return '';
  const h = a.OpenProcess(0x1000, false, pid);
  if (!h) return '';
  try {
    const sizeBox = [1024];
    const buf = new Uint16Array(1024);
    if (!a.QueryFullProcessImageNameW(h, 0, buf, sizeBox)) return '';
    return readWide(buf, sizeBox[0]);
  } finally {
    a.CloseHandle(h);
  }
}

function titleOf(a, hwnd) {
  const buf = new Uint16Array(256);
  const len = a.GetWindowTextW(hwnd, buf, 256);
  return len > 0 ? readWide(buf, len) : '';
}

/** @returns {{hwnd:*, pid:number, exe:string, title:string}|null} */
function readForeground() {
  const a = init();
  if (!a) return null;
  try {
    const hwnd = a.GetForegroundWindow();
    if (!hwnd) return null;

    const pidBox = [0];
    a.GetWindowThreadProcessId(hwnd, pidBox);
    const pid = pidBox[0];
    if (!pid) return null;

    return { hwnd, pid, exe: exeOfPid(a, pid), title: titleOf(a, hwnd) };
  } catch (e) {
    return null;
  }
}

/**
 * 列当前所有「可见且有标题」的顶层窗口。
 * 这就是「一次轮询的完整明细」——前台只是其中一行。
 * @param {number} max 上限，防止某些机器上窗口爆炸
 */
function listWindows(max) {
  const a = init();
  if (!a) return [];
  const limit = max || 40;
  const out = [];
  try {
    const fg = a.GetForegroundWindow();
    let h = a.GetTopWindow(null);
    let guard = 0;
    while (h && guard++ < 3000 && out.length < limit) {
      if (a.IsWindowVisible(h) && a.GetWindowTextLengthW(h) > 0) {
        const pidBox = [0];
        a.GetWindowThreadProcessId(h, pidBox);
        const exe = exeOfPid(a, pidBox[0]);
        if (exe) {
          out.push({ hwnd: h, pid: pidBox[0], exe, title: titleOf(a, h), fg: h === fg });
        }
      }
      h = a.GetWindow(h, GW_HWNDNEXT);
    }
  } catch (e) {
    // 枚举中途某个窗口被关掉会抛，能拿到多少算多少
  }
  return out;
}

/**
 * 采样一拍：把前台窗口信息翻译成「类别 + 人话名字」。
 * @param {string} lastCat 读不到前台时沿用的类别
 */
function sample(lastCat) {
  const raw = readForeground();
  if (!raw) return { ok: false, cat: lastCat || 'other', app: null, exe: '', title: '' };

  const info = classifyFull(raw.exe, raw.title);
  return {
    ok: true,
    cat: info.cat,
    app: info.name,
    exe: raw.exe,
    title: raw.title,
    self: info.cat === 'self',
    known: info.known,
  };
}

module.exports = { sample, readForeground, listWindows, available: () => !!init() };
