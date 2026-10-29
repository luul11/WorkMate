# 乐伴WorkMate

> 一只住在桌面角落的拉布拉多，和一份自己看的时间账。

![主界面](docs/screenshot-main.png)

## 这是什么

一个 Windows 桌面小工具。它每分钟读一次当前前台窗口的进程名，把这段时间记进你今天的账里：
几点到几点在写代码、看文档、刷网页，还是锁着屏在休息。

纯单机，没有账号，不联网。数据就三个文件，躺在你自己的 AppData 里。

顺便养了一只狗。乐乐会自己出门，碰见别的狗，交朋友或者打一架，有时候几只凑一桌打阿瓦隆或狼人杀，
回来讲给你听。

## 功能

**记时间**

- 读前台窗口的进程名，归到八类：编程 / 文档 / 浏览 / 运维 / 会议 / 休息 / 本应用 / 其他
- 今日总时长、类别去向、工作块时间轴
- 认错类别可以在左栏手动纠正，30 分钟内按你选的算

**待办与提醒**

- 一句话拆多条：「后天去深圳出差，在此之前订票」会拆成一条日程加一条前置任务
- 静默时段、半小时提醒预算、可顺延、逾期汇总

**记忆**

- 三层逐级压缩：日 → 月 → 长期，每层只读下一层的数据，全是本地统计

**乐乐**

- 18 个犬种，友好还是动手，按品种和体型各有一套概率
- 阿瓦隆、狼人杀，四只狗一桌
- 「远行冒险」：送它走一到三小时，每半小时带一件事回来

![桌宠](docs/screenshot-pet.png)

## 快速开始

要求：Windows 10 / 11，Node.js 18 以上。

```bash
git clone https://github.com/luul11/WorkMate.git
cd WorkMate
npm install
npm start
```

> 如果你的终端里带着 `ELECTRON_RUN_AS_NODE=1`，直接跑 `electron .` 会报
> `Cannot read properties of undefined (reading 'whenReady')`。
> `npm start` 走的是 `scripts/launch.js`，会先把这个变量摘掉。

## 打包正式版

```bash
npm i -D electron-builder
npm run dist
```

产物在 `dist/`：

- `乐伴WorkMate Setup 1.0.0.exe` —— 安装包
- `乐伴WorkMate-1.0.0-win.zip` —— 免安装版

国内网络如果卡在下载 `winCodeSign`，先换成镜像再打包：

```bash
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

生成的文件名跟 `package.json` 里的 `productName` 走。改名不用管数据目录——
`main.js` 里已经把 userData 钉死在 `workmate-desktop`，改名不会让旧数据「消失」。

图标用的是 `build/icon.png`（1208×1152，从桌宠立绘裁的）。如果打包时提示图标必须是正方形，
换一张 512×512 的方图放回同名位置就行，或者把 `package.json` 里 `build.win.icon` 这一行删掉，用默认图标。

## 数据在哪

`%APPDATA%\workmate-desktop\data\`

| 文件 | 内容 |
| --- | --- |
| `state.json` | 待办、日记、工作块、冒险日志、设置 |
| `logs/YYYY-MM.jsonl` | 逐条事件，只追加不重写 |
| `archive/` | 三个月以上的月度汇总 |

删掉整个 `data` 文件夹就重置了。删之前先退出应用，主进程每分钟会重写一次 `state.json`。
也可以走界面：设置 → 数据 → 清空全部数据。

## 目录结构

```
main.js              主进程：双窗口、每分钟采样一次
preload.js           contextBridge 白名单
modules/
  sampler.js         Win32 读前台窗口（koffi 调 user32 / kernel32）
  classify.js        进程名 → 类别
  store.js           三层文件存储
  lines.js           乐乐的日常台词
  story.js           遭遇 / 桌游 / 冒险
renderer/            页面，普通 HTML + CSS + JS，没有框架
scripts/launch.js    启动器（清掉 ELECTRON_RUN_AS_NODE）
tools/               自检工具
```

## 自检

```bash
node tools/foreground-probe.js             # 看当前所有窗口都被归到了哪一类
node tools/foreground-probe.js --selftest  # 映射表、概率表、桌游场景、狗的名单
```

这两个都是只读的，不会启动应用，也不会改任何数据。

## 已知限制

- 只有 Windows 版
- 只认 Win32 进程名。UWP 应用的前台是 `ApplicationFrameHost.exe`，会落到「其他」
- 不判断你是不是离开了电脑，走开那段时间会算在最后一个应用上
- 只读进程名和窗口标题，读不到窗口里的内容，也不联网

## 关于

作者：伊玛目的门徒
博客：<https://blog.csdn.net/qq_37195257>
邮箱：luul11@163.com

> 我把乐伴（桌面陪伴型助理）开源，希望你能喜欢我的应用和乐乐，祝你早上、中午、晚上好~~

## License

MIT
