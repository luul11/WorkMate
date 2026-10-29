'use strict';

/**
 * 三层文件存储
 *
 *   热  data/state.json                 全量重写，只装「今天 + 最近三周」。恒定 < 300KB
 *   温  data/logs/YYYY-MM.jsonl          只追加，一行一个事件。一天最多几百行
 *   冷  data/archive/YYYY-MM.summary.json 月度汇总，滚出 3 个月的历史压成一坨
 *
 * 为什么不用 SQLite：这个量级（一年几 MB）上数据库带不来任何查询收益，
 * 却要多一层 schema 映射代码。真正要防的是「单文件无限膨胀」——
 * 那靠分层解决，不靠换存储引擎。
 */

const fs = require('fs');
const path = require('path');

const KEEP_LOG_MONTHS = 3; // 超过这个月数的 jsonl 会被压成 summary

let DATA_DIR = '';
let STATE_FILE = '';
let LOG_DIR = '';
let ARCHIVE_DIR = '';

function ensureDirs() {
  for (const d of [DATA_DIR, LOG_DIR, ARCHIVE_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function init(rootDir) {
  DATA_DIR = path.join(rootDir, 'data');
  STATE_FILE = path.join(DATA_DIR, 'state.json');
  LOG_DIR = path.join(DATA_DIR, 'logs');
  ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
  ensureDirs();
  rotate();
}

/** 原子写：先写 .tmp 再改名，断电也不会留下半个 JSON */
function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    // 文件坏了就别覆盖它，留一份现场给用户，然后当作全新开始
    try {
      fs.renameSync(STATE_FILE, STATE_FILE + '.broken-' + Date.now());
    } catch (_) {}
    return null;
  }
}

function saveState(obj) {
  try {
    const text = JSON.stringify(obj);
    writeAtomic(STATE_FILE, text);
    return { ok: true, bytes: Buffer.byteLength(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function monthKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function appendLog(evt) {
  try {
    const file = path.join(LOG_DIR, monthKey(new Date()) + '.jsonl');
    fs.appendFileSync(file, JSON.stringify(evt) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/** 把一个月的事件行压成「每天一行」的小结 */
function summarize(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const days = {};
  let total = 0;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    if (!e.day) continue;
    if (!days[e.day]) days[e.day] = { activeSec: 0, blocks: 0, apps: {}, stories: [] };
    const d = days[e.day];
    if (e.k === 'block') {
      d.blocks += 1;
      d.activeSec += e.secs || 0;
      if (e.app) d.apps[e.app] = (d.apps[e.app] || 0) + (e.secs || 0);
    } else if (e.k === 'story') {
      if (d.stories.length < 20) d.stories.push(e.text);
    }
    total += 1;
  }
  return { month: path.basename(file, '.jsonl'), events: total, days };
}

/**
 * 滚动归档：超过 KEEP_LOG_MONTHS 的月度 jsonl → summary.json，原文件删除。
 * 启动时跑一次，之后由 main 每 6 小时跑一次。
 */
function rotate(now) {
  now = now || new Date();
  ensureDirs();
  const done = [];
  let files = [];
  try { files = fs.readdirSync(LOG_DIR); } catch (_) { return done; }

  for (const name of files) {
    if (!/^\d{4}-\d{2}\.jsonl$/.test(name)) continue;
    const [y, m] = name.replace('.jsonl', '').split('-').map(Number);
    const ageMonths = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
    if (ageMonths < KEEP_LOG_MONTHS) continue;

    const src = path.join(LOG_DIR, name);
    try {
      const summary = summarize(src);
      summary.archived_at = Math.floor(now.getTime() / 1000);
      writeAtomic(path.join(ARCHIVE_DIR, name.replace('.jsonl', '.summary.json')), JSON.stringify(summary));
      fs.unlinkSync(src);
      done.push(name);
    } catch (e) {
      console.error('[store] 归档失败', name, e.message);
    }
  }
  return done;
}

function usage() {
  const stat = (f) => { try { return fs.statSync(f).size; } catch (_) { return 0; } };
  const list = (dir, re) => {
    try {
      return fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => ({ name: n, bytes: stat(path.join(dir, n)) }));
    } catch (_) { return []; }
  };
  return {
    dir: DATA_DIR,
    hot: stat(STATE_FILE),
    logs: list(LOG_DIR, /\.jsonl$/),
    archive: list(ARCHIVE_DIR, /\.json$/),
  };
}

module.exports = { init, loadState, saveState, appendLog, rotate, usage, DATA_DIR: () => DATA_DIR, monthKey };
