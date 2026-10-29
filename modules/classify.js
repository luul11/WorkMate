'use strict';

/**
 * 进程名 → 类别 + 人话名字
 *
 * 为什么要一张手写表：Windows 上没有可靠的「这个进程是编辑文档还是看网页」的
 * 元数据，只能靠可执行文件名。表覆盖不到的应用统一落到 other，不会报错。
 *
 * 这张表按用户实际在用的软件维护，不追求大而全：
 * 认错了或漏了就加一行 ['进程名', '类别', '显示名']，然后跑
 *   node tools/foreground-probe.js --selftest
 * 自检会把整张表逐条查一遍，写完立刻知道有没有写错。
 */

const TABLE = [
  // ---------- 编程 ----------
  ['trae cn', 'coding', 'Trae'],
  ['trae', 'coding', 'Trae'],
  ['workbuddy', 'coding', 'WorkBuddy'],
  ['chatgpt', 'coding', 'ChatGPT'],
  ['pycharm64', 'coding', 'PyCharm'],

  // ---------- 文档 ----------
  ['wps', 'docs', 'WPS'],
  ['notepad', 'docs', '记事本'],

  // ---------- 浏览 ----------
  ['chrome', 'browse', 'Chrome'],
  ['msedge', 'browse', 'Edge'],

  // ---------- 运维 ----------
  ['powershell', 'ops', 'PowerShell'],
  ['pwsh', 'ops', 'PowerShell'],
  ['windowsterminal', 'ops', '终端'],
  ['wt', 'ops', '终端'],
  ['cmd', 'ops', '命令行'],
  ['mintty', 'ops', '终端'],
  ['git-bash', 'ops', '终端'],
  ['explorer', 'ops', '资源管理器'],

  // ---------- 休息 ----------
  // 锁屏界面是 LockApp.exe。它一出现就说明人离开电脑了，
  // 所以这段既不算「在工作」，也不算「读不到」，单列一类。
  ['lockapp', 'rest', '锁屏'],

  // ---------- 会议 ----------
  ['wemeetapp', 'meeting', '腾讯会议'],
  ['zoom', 'meeting', 'Zoom'],
  ['teams', 'meeting', 'Teams'],
];

const MAP = new Map(TABLE.map(([exe, cat, name]) => [exe, { cat, name }]));

/** 从完整路径里取出可执行文件名，去掉 .exe，转小写 */
function baseName(exePath) {
  if (!exePath) return '';
  const file = String(exePath).split(/[\\/]/).pop() || '';
  return file.replace(/\.exe$/i, '').toLowerCase();
}

/**
 * @param {string} exePath 例如 D:\Program Files\Tencent\WeChat\WeChat.exe
 * @returns {{cat: string, name: string, known: boolean}}
 */
function classify(exePath) {
  const base = baseName(exePath);
  if (!base) return { cat: 'other', name: '未知应用', known: false };
  const hit = MAP.get(base);
  if (hit) return { cat: hit.cat, name: hit.name, known: true };

  // 表里没有的：用文件名当名字，别显示成一串拼音路径
  const name = base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { cat: 'other', name, known: false };
}

/**
 * 本应用自己也是一个类别
 *
 * 主窗口和桌宠窗都是 electron.exe，光看进程名分不出「这是 WorkMate」还是
 * 「某个别的 Electron 应用」。所以带上窗口标题做模糊匹配：
 *   主窗口标题 = "乐伴WorkMate"
 *   桌宠窗标题 = "乐乐"
 * 两个都认，其它 electron.exe 仍然走正常归类（落到 other）。
 */
const SELF_TITLE = /workmate|桌面陪伴|陪伴助理|乐乐/i;
// 用「包含」而不是「等于」：打包后 exe 会叫 乐伴WorkMate.exe，
// 进程名转小写是「乐伴workmate」，全等匹配就漏了。
const SELF_KEYS = ['electron', 'workmate', 'leban', '乐伴'];

function classifyFull(exePath, title) {
  const base = baseName(exePath);
  const hitSelf = SELF_KEYS.some((k) => base.includes(k));
  if (hitSelf && (SELF_TITLE.test(title || '') || !title)) {
    return { cat: 'self', name: '乐伴WorkMate', known: true };
  }
  return classify(exePath);
}

/**
 * 自检：表里每一条都必须原样查得回来。
 *
 * 加这个是因为踩过一次：`new Map(TABLE)` 对三元组只保留前两项，
 * 后面再用 hit[1]/hit[2] 取值，取到的是字符串的下标——整张表全错，
 * 表面上却只是「归类偏到其他」，不报错、不崩，最难发现。
 */
function selfCheck() {
  const bad = [];
  for (const [exe, cat, name] of TABLE) {
    const r = classify('C:\\Program Files\\Some App\\' + exe + '.exe');
    if (r.cat !== cat || r.name !== name || !r.known) {
      bad.push({ exe, want: { cat, name }, got: r });
    }
  }
  return bad;
}

module.exports = { classify, classifyFull, baseName, selfCheck };
