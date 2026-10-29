#!/usr/bin/env node
'use strict';

/**
 * Electron 启动器
 *
 * 为什么需要这一层：某些环境（包括 WorkBuddy 的终端）会带着
 * ELECTRON_RUN_AS_NODE=1 这个变量。Electron 一看到它就会退化成普通 Node，
 * 于是 require('electron') 拿到 undefined，报
 *   TypeError: Cannot read properties of undefined (reading 'whenReady')
 *
 * 这里用 Node 起一个子进程，把那个变量摘掉再拉 Electron。
 * 好处是不管你在 cmd、PowerShell、Git Bash 还是 npm start 里跑，
 * 行为都一样，不用每次手动 $env:ELECTRON_RUN_AS_NODE=""。
 *
 * 用法：
 *   node scripts/launch.js           正常启动
 *   node scripts/launch.js --dev     带 DevTools
 *   node scripts/launch.js --shot    自检截图
 */

const { spawn } = require('child_process');
const path = require('path');

let exe;
try {
  // 在普通 Node 里 require('electron') 返回的是可执行文件路径，不是模块
  exe = require('electron');
} catch (e) {
  console.error('找不到 Electron。先在这个目录跑一次：npm install');
  process.exit(1);
}

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(exe, ['.'].concat(process.argv.slice(2)), {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

child.on('error', (e) => {
  console.error('启动失败：' + e.message);
  process.exit(1);
});

child.on('close', (code) => process.exit(code == null ? 0 : code));
