/* WorkMate · 主界面逻辑
 *
 * 跑在 Electron 的渲染进程里；直接双击 index.html 用浏览器打开也能跑（降级模式）。
 * 之所以不用框架：这东西的全部价值在「规则与状态」，不在渲染；引入框架只会
 * 让「改一行要等一次构建」多此一举。
 *
 * 结构（自上而下）：
 *   0  常量与时间工具        —— 北京时间写死，不信机器时区
 *   1  存储与状态            —— 走主进程的三层文件，随时可导出
 *   2  自然语言解析          —— 确定性规则，同一句话永远同一个结果
 *   3  一句话拆多条          —— 含「在此之前」的前置关系
 *   4  感知与工作块          —— 主进程推来的前台应用 + 系统空闲
 *   5  提醒调度              —— 静默 / 预算 / 顺延 / 逾期摘要
 *   6  记忆与画像            —— 日记、习惯、风险，全是规则算出来的
 *   7  台词与冒险            —— 日常碎碎念，以及出门打怪
 *   8  宠物状态机            —— 只切状态，动画交给序列帧
 *   9  界面渲染              —— 目标 DOM 更新，不整体重绘
 *   10 事件绑定与启动
 */
(function () {
  "use strict";

  /* ===================== 0. 常量与时间工具 ===================== */

  var BJ = 8 * 3600;                 // 北京时间偏移，写死
  var DAY = 86400;
  var MANUAL_MIN = 30;               // 手动纠正归类后，覆盖自动识别多少分钟

  // 远行：总时长 1–3 小时，途中每半小时发生一件事
  var TRIP_STEP = 30 * 60;
  var TRIP_MIN = 60 * 60;
  var TRIP_MAX = 3 * 3600;

  var CATS = [
    { id: "coding",  label: "编程", color: "#7B68EE" },
    { id: "docs",    label: "文档", color: "#3B82F6" },
    { id: "browse",  label: "浏览", color: "#14B8A6" },
    { id: "ops",     label: "运维", color: "#F59E0B" },
    { id: "meeting", label: "会议", color: "#EC4899" },
    { id: "rest",    label: "休息", color: "#22C55E" },
    { id: "self",    label: "本应用", color: "#64748B" },
    { id: "other",   label: "其他", color: "#94A3B8" }
  ];
  var CAT_MAP = {};
  CATS.forEach(function (c) { CAT_MAP[c.id] = c; });

  // 演示数据里每个类别派一个代表软件，冒险日志才有对手可打
  var DEMO_APP = {
    coding: "Trae", docs: "WPS", browse: "Chrome",
    ops: "PowerShell", meeting: "腾讯会议", other: "资源管理器"
  };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function nowSec() { return Math.floor(Date.now() / 1000); }

  // 北京时间的「今天零点」。用固定偏移而不是本地时区：
  // 机器时区可以被改、虚拟机与远程桌面还会变，用本地日期算作息会整体错位。
  function bjDayStart(ts) {
    ts = ts == null ? nowSec() : ts;
    return Math.floor((ts + BJ) / DAY) * DAY - BJ;
  }
  function bjDate(ts) {
    var d = new Date(((ts == null ? nowSec() : ts) + BJ) * 1000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function bjHM(ts) {
    var d = new Date((ts + BJ) * 1000);
    return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function bjWeek(ts) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date((ts + BJ) * 1000).getUTCDay()];
  }
  // 「2026-10-25」这类日期串的星期。直接按日历日算，不要再套 bjDayStart
  // （它吃的是时间戳，喂字符串会得到 NaN —— 事实清单里渲染成 undefined 踩过）。
  function weekdayOfDay(day) {
    var w = new Date(day + "T00:00:00Z").getUTCDay();
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][w];
  }
  function bjHour(ts) { return new Date((ts + BJ) * 1000).getUTCHours(); }
  function dayDiff(a, b) { return Math.round((bjDayStart(a) - bjDayStart(b)) / DAY); }

  function bjWhen(ts) {
    var diff = dayDiff(ts, nowSec());
    var hm = bjHM(ts);
    if (diff === 0) return "今天 " + hm;
    if (diff === 1) return "明天 " + hm;
    if (diff === -1) return "昨天 " + hm;
    var d = new Date((ts + BJ) * 1000);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + hm;
  }

  // 「4 小时 12 分钟」式的时长
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + " 秒";
    var m = Math.round(sec / 60);
    if (m < 60) return m + " 分钟";
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + " 小时 " + r + " 分钟" : h + " 小时";
  }
  // 「3 天前」式的跨度
  function span(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 90) return Math.round(sec) + " 秒";
    if (sec < 3600) return Math.round(sec / 60) + " 分钟";
    if (sec < DAY) return dur(sec);
    var d = Math.floor(sec / DAY), h = Math.round((sec % DAY) / 3600);
    return h ? d + " 天 " + h + " 小时" : d + " 天";
  }

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel) { return document.querySelector(sel); }
  function uid(prefix) {
    return (prefix || "id") + "_" + nowSec().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ===================== 1. 存储与状态 ===================== */

  function defaults() {
    return {
      v: 1,
      created_at: nowSec(),
      settings: {
        cat: "browse",          // 兜底类别：读不到前台时按「浏览」算
        paused: false,
        quietStart: "21:30",
        quietEnd: "08:30",
        lunchStart: "12:00",
        lunchEnd: "13:30",
        budgetMax: 2,
        budgetWindowMin: 30,
        budgetGapMin: 6,
        deferMin: 10,
        adaptiveQuiet: true,
        sound: false,
        sitEvery: 50,
        catManualUntil: 0     // 手动纠正归类的有效期（秒）。过了就回到自动识别
      },
      days: {},            // day -> { activeSec, byCat, byApp, blocks: [], fired, sits }
      currentBlock: null,
      reminders: [],
      notes: { short: {}, mid: {}, long: {} },
      stories: [],         // 冒险日志，最多留 40 条
      trip: null,          // 进行中的远行：{start, end, next, n}
      budget: [],
      digestDay: "",
      onboarded: false,
      demo: false
    };
  }

  var state = null;
  var saveTimer = null;
  var resetting = false;      // 清空数据期间挡住回写，否则刚删完又被 beforeunload 写回来

  /* 落盘交给主进程（三层文件）。写成异步，但调用方不用等——
     一分钟一拍的节奏里，写文件慢几十毫秒不影响任何显示。 */
  function load() {
    return WM.load().then(function (s) {
      if (!s || typeof s !== "object") return null;
      var d = defaults();
      // 浅合并，保证老数据缺字段也能跑
      Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
      Object.keys(d.settings).forEach(function (k) {
        if (s.settings[k] === undefined) s.settings[k] = d.settings[k];
      });
      if (!s.notes) s.notes = d.notes;
      if (!Array.isArray(s.stories)) s.stories = [];
      // 关掉应用期间已经到点的远行，直接作废，不要在启动瞬间补发一堆事件
      if (s.trip && (!s.trip.end || s.trip.end < nowSec())) s.trip = null;
      // 旧版本的「最近发生」是持久化的系统日志，现在改成内存里的狗子动态，顺手清掉
      delete s.feed;
      return s;
    }).catch(function () { return null; });
  }

  function save() {
    if (resetting) return;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      WM.save(state).then(function (r) {
        if (r && r.ok === false) toast("写文件失败：" + (r.error || "未知原因"));
      });
    }, 400);
  }

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (state && !resetting) WM.save(state);
  }

  // 温层日志：只追加不重写，主进程负责跨月压成汇总
  function logEvent(evt) {
    if (!WM.isDesktop) return;
    evt.day = evt.day || bjDate();
    evt.t = nowSec();
    WM.log(evt);
  }

  /* 狗子的动态：只在内存里，不落盘，关掉应用就清空。
     它记的是「今天乐乐干了什么」，不是要长期保存的档案。
     tag 固定两个汉字，列表才排得整齐。 */
  var dogFeed = [];
  function log(tag, text) {
    dogFeed.unshift({ ts: nowSec(), tag: tag, text: text });
    if (dogFeed.length > 12) dogFeed.length = 12;
  }

  // 「还没做完」：0=待触发，1=已提醒但没打勾。只把 status=2 当完成，
  // 否则提醒响过之后那一行会从列表里消失——用户会以为它被删了。
  function isOpen(r) { return r.status !== 2; }

  function ensureDay(day) {
    if (!state.days[day]) {
      state.days[day] = { activeSec: 0, byCat: {}, byApp: {}, blocks: [], fired: 0, sits: 0 };
    }
    var d = state.days[day];
    if (!d.byCat) d.byCat = {};
    if (!d.byApp) d.byApp = {};
    if (!d.blocks) d.blocks = [];
    return d;
  }

  function prune() {
    // 热文件只留最近三周：再往前的东西已经在 logs/ 的月度 jsonl 里了，
    // 留在内存里只会让每次全量重写变慢。
    var keys = Object.keys(state.days).sort();
    while (keys.length > 21) {
      delete state.days[keys.shift()];
    }
    var cutoff = nowSec() - 30 * DAY;
    state.reminders = state.reminders.filter(function (r) {
      return r.status !== 2 || (r.done_at || 0) > cutoff;
    });
    if (state.stories && state.stories.length > 40) state.stories.length = 40;
  }

  /* ===================== 2. 自然语言解析 ===================== */
  /* 一套纯规则。时间必须确定：同一句话永远同一个结果，
     所以这里不调任何模型，也不需要联网。 */

  function cnNum(s) {
    s = String(s || "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var D = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
    function digit(c) { return D[c] === undefined ? null : D[c]; }
    if (s === "十") return 10;
    if (s.charAt(0) === "十") {
      var d1 = digit(s.charAt(1));
      return d1 == null ? null : 10 + d1;
    }
    var i = s.indexOf("十");
    if (i > 0) {
      var tens = digit(s.charAt(0));
      if (tens == null) return null;
      var rest = s.slice(i + 1);
      if (!rest) return tens * 10;
      var d2 = digit(rest.charAt(0));
      return d2 == null ? null : tens * 10 + d2;
    }
    if (s.length === 1) return digit(s);
    return null;
  }

  var NUMCH = "0123456789零〇一二两三四五六七八九十";

  function findHour(text) {
    var units = [":", "点", "时"];
    for (var u = 0; u < units.length; u++) {
      var unit = units[u];
      var pos = text.indexOf(unit);
      if (pos < 0) continue;
      var start = pos;
      while (start > 0 && NUMCH.indexOf(text.charAt(start - 1)) >= 0) start--;
      if (start >= pos) continue;
      var v = cnNum(text.slice(start, pos));
      if (v == null) continue;
      if (unit === ":") {
        var m = text.slice(pos + 1).match(/^\d+/);
        var minute = m ? parseInt(m[0], 10) : 0;
        return { h: v, minute: minute, start: start, end: pos + 1 + (m ? m[0].length : 0) };
      }
      return { h: v, minute: -1, start: start, end: pos + 1 };
    }
    return null;
  }

  function findMinute(text, hourEnd) {
    var rest = text.slice(hourEnd);
    if (rest.charAt(0) === "半") return 30;
    var m = rest.match(/^\s*(\d{1,2})\s*分/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function findWeekday(text) {
    var prefixes = ["下下周", "下周", "周", "星期", "礼拜"];
    for (var i = 0; i < prefixes.length; i++) {
      var p = prefixes[i];
      var pos = text.indexOf(p);
      while (pos >= 0) {
        var ch = text.charAt(pos + p.length);
        var map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
        if (map[ch] !== undefined) {
          return { idx: map[ch], pos: pos, end: pos + p.length + 1, nextWeek: p.charAt(0) === "下" };
        }
        pos = text.indexOf(p, pos + 1);
      }
    }
    return null;
  }

  function findDateOnly(text) {
    var kws = [["后天", 2], ["明天", 1], ["明日", 1], ["今天", 0], ["今日", 0]];
    for (var i = 0; i < kws.length; i++) {
      var p = text.indexOf(kws[i][0]);
      if (p >= 0) return { off: kws[i][1], start: p, end: p + kws[i][0].length };
    }
    var w = findWeekday(text);
    if (w) {
      var todayIdx = (Math.floor((bjDayStart() + BJ) / DAY) + 4) % 7;
      var ahead = ((w.idx - todayIdx) % 7 + 7) % 7;
      if (ahead === 0) ahead = 7;                       // 只写「周三」而今天就是周三 → 按下周算
      if (w.nextWeek && ahead < 7) ahead += 7;
      var start = w.pos;
      if (start > 0 && text.charAt(start - 1) === "下") start -= 1;
      return { off: ahead, start: start, end: w.end };
    }
    return null;
  }

  function extractTitle(raw, start, end) {
    var i = raw.indexOf("提醒我");
    if (i >= 0) {
      var t0 = raw.slice(i + 3).replace(/^[\s，,。.、：:!！?？]+/, "").replace(/[\s，,。.、：:!！?？]+$/, "");
      if (t0) return t0;
    }
    var s = raw.slice(0, Math.min(start, raw.length)) + raw.slice(Math.min(end, raw.length));
    var t = s
      .replace(/^[\s，,。.、：:!！?？的去在要【】\[\]()（）]+/, "")
      .replace(/[\s，,。.、：:!！?？的去在要【】\[\]()（）]+$/, "")
      .replace(/^(可能|大概|也许|需要|要|得|应该|需)+/, "")
      .replace(/[了吧啊呀。！!]+$/, "")
      .replace(/^提醒我/, "")
      .trim();
    return t || "提醒";
  }

  function parseWhen(text, now) {
    now = now || nowSec();
    // 先规整数字与单位之间的空格："30 分钟后" 与 "30分钟后" 必须等价——
    // 界面上的快捷按钮就带空格，不规整的话规则解析会整个落空，
    // 最后把整句当成标题，记出一条叫「30 分钟后提醒我喝水」的待办。
    var raw = String(text || "").trim()
      .replace(/([0-9零〇一二两三四五六七八九十])\s+(分钟|小时|点|时|分)/g, "$1$2");
    if (!raw) return null;
    var dayStart = bjDayStart(now);

    // 1) 相对：30分钟后 / 半小时后 / 2小时后
    var rel = [["分钟后", 60], ["分钟之后", 60], ["小时后", 3600], ["小时之后", 3600]];
    for (var i = 0; i < rel.length; i++) {
      var kw = rel[i][0], unit = rel[i][1];
      var pos = raw.indexOf(kw);
      if (pos < 0) continue;
      var start = pos;
      while (start > 0 && (NUMCH.indexOf(raw.charAt(start - 1)) >= 0 || raw.charAt(start - 1) === "半")) start--;
      var seg = raw.slice(start, pos);
      if (seg === "半") {
        return { fire_at: now + unit / 2, title: extractTitle(raw, start, pos + kw.length), matched: raw.slice(start, pos + kw.length) };
      }
      var v = cnNum(seg);
      if (v == null) continue;
      return { fire_at: now + v * unit, title: extractTitle(raw, start, pos + kw.length), matched: raw.slice(start, pos + kw.length) };
    }

    // 2) 时刻：15:30 / 三点 / 下午三点半
    var h = findHour(raw);
    if (h) {
      var minute = h.minute >= 0 ? h.minute : findMinute(raw, h.end);
      var hh = h.h;
      var before = raw.slice(0, h.start);
      if (/(下午|晚上|傍晚)$/.test(before) && hh < 12) hh += 12;
      else if (/中午$/.test(before) && hh < 12) hh = 12 + (hh % 12);

      var dayOffset = 0, dateMatched = "";
      if (raw.indexOf("后天") >= 0) { dayOffset = 2; dateMatched = "后天"; }
      else if (raw.indexOf("明天") >= 0 || raw.indexOf("明日") >= 0) { dayOffset = 1; dateMatched = "明天"; }
      else if (raw.indexOf("今天") >= 0 || raw.indexOf("今日") >= 0) { dateMatched = "今天"; }

      if (dayOffset === 0) {
        var w = findWeekday(raw);
        if (w) {
          var todayIdx = (Math.floor((dayStart + BJ) / DAY) + 4) % 7;
          var ahead = ((w.idx - todayIdx) % 7 + 7) % 7;
          if (ahead === 0) {
            var t = dayStart + hh * 3600 + minute * 60;
            ahead = t > now ? 0 : 7;
          }
          if (w.nextWeek && ahead === 0) ahead = 7;
          dayOffset = ahead;
          dateMatched = raw.slice(w.pos, w.end);
        }
      }

      var fire = dayStart + dayOffset * DAY + hh * 3600 + minute * 60;
      if (dayOffset === 0 && fire <= now + 30) fire += DAY;   // 今天已过点 → 明天
      if (fire <= now) fire += DAY;

      var end = h.end;
      if (minute > 0) {
        var m2 = raw.slice(h.end).match(/^\s*(\d{1,2}\s*分|半)/);
        if (m2) end = h.end + m2[0].length;
      }
      var start2 = dateMatched ? raw.indexOf(dateMatched) : h.start;
      if (start2 < 0) start2 = h.start;
      return {
        fire_at: fire,
        title: extractTitle(raw, start2, end),
        matched: raw.slice(start2, end).trim()
      };
    }

    // 3) 只有日期：默认上午 10 点（「后天出差」绝不能记成半小时后）
    var d = findDateOnly(raw);
    if (d) {
      var f = dayStart + d.off * DAY + 10 * 3600;
      if (f <= now) f += DAY;
      return { fire_at: f, title: extractTitle(raw, d.start, d.end), matched: raw.slice(d.start, d.end) };
    }
    return null;
  }

  /* ===================== 3. 一句话拆多条 ===================== */
  /* 把「后天出差，在此之前订票和酒店」拆成两条：一条日程、一条前置任务。
     规则只做三件事：
       ① 按标点断句；
       ② 认出「日程」（有事件动词 + 有时间）与「议题」（无时间的补充说明）；
       ③ 把「在此之前 / 提前」的句子挂到日程前面，时间取日程前 48 小时，
          若已过去则落在 2 小时后 —— 「订机票」不该等到出发当天才提醒。
  */

  var EVENT_RE = /(出差|开会|会议|拜访|汇报|评审|路演|培训|面试|签约|对接|宣讲|出差到)/;
  var PRE_RE = /(在此之前|提前|事先|之前|出发前)/;

  function pickPlace(c) {
    var m = c.match(/(?:出差)?(?:去|到)([\u4e00-\u9fa5]{2,6})/);
    if (!m) return "";
    return m[1].replace(/(出差|开会|拜访|见|的|了|，|。).*$/, "");
  }

  function cleanAction(c) {
    var t = String(c || "")
      .replace(/在此之前|提前|事先/g, "")
      .replace(/还需要|还要|需要/g, "");
    // 前缀可能层层嵌套（「后天可能需要…」），剥三轮才干净
    for (var i = 0; i < 3; i++) {
      t = t
        .replace(/^(今天|明天|后天|今日|明日)/, "")
        .replace(/^(下下周|下周|周|星期|礼拜)[一二三四五六日天]/, "")
        .replace(/^(可能|大概|也许|需要|要|得|需|应该)+/, "");
    }
    return t
      .replace(/^[\s，,。.、：:!！?？]+/, "")
      .replace(/[\s，,。.、：:!！?？]+$/, "")
      .replace(/[了吧啊呀]+$/, "")
      .trim();
  }

  function preTime(eventStart, now) {
    var t = eventStart - 48 * 3600;
    return t > now + 1800 ? t : now + 2 * 3600;
  }

  function splitItems(raw, now) {
    now = now || nowSec();
    var text = String(raw || "").trim();
    if (!text) return [];

    var clauses = text.split(/[，。；;、,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (clauses.length <= 1) {
      var p0 = parseWhen(text, now);
      return [{
        title: p0 ? p0.title : cleanAction(text),
        fire_at: p0 ? p0.fire_at : now + 1800,
        kind: "task", place: "", note: "", priority: 2,
        matched: p0 ? p0.matched : ""
      }];
    }

    var items = [];
    var event = null;
    var pendingPre = [];
    var loose = [];

    clauses.forEach(function (c) {
      var p = parseWhen(c, now);
      var isPre = PRE_RE.test(c);

      if (isPre && !event) { pendingPre.push(c); return; }

      if (!event && EVENT_RE.test(c) && p) {
        var place = pickPlace(c);
        event = {
          title: cleanAction(c).replace(/[，,。]+$/, ""),
          fire_at: p.fire_at,
          kind: "event",
          place: place,
          note: "",
          priority: 1,
          matched: p.matched
        };
        items.push(event);
        return;
      }

      if (isPre && event) { pendingPre.push(c); return; }

      if (p) {
        items.push({
          title: p.title, fire_at: p.fire_at, kind: "task",
          place: "", note: "", priority: 2, matched: p.matched
        });
        return;
      }

      // 没有时间：日程后的补充说明（见谁、讲什么）并入备注，而不是硬造一条待办
      if (event) { loose.push(c); return; }
      loose.push(c);
    });

    // 备注：日程后面的议题/对象
    if (event && loose.length) {
      event.note = loose.join("；");
    }

    // 前置任务：挂到日程之前
    pendingPre.forEach(function (c) {
      var p = parseWhen(c, now);
      var title = cleanAction(c);
      if (!title) return;
      items.push({
        title: title,
        fire_at: p ? p.fire_at : (event ? preTime(event.fire_at, now) : now + 1800),
        kind: "task",
        place: "",
        note: event ? "为「" + event.title + "」做准备" : "",
        priority: 1,
        matched: p ? p.matched : ""
      });
    });

    // 没有日程时，散句各自成条，时间跟第一条对齐：
    // 「明天三点发周报，还要给张总回邮件」是两件事，不该把第二句塞进备注。
    if (!event && loose.length) {
      var base = items.length ? items[0].fire_at : now + 1800;
      loose.forEach(function (c) {
        var t = cleanAction(c);
        if (!t) return;
        items.push({
          title: t, fire_at: base, kind: "task",
          place: "", note: "", priority: 2, matched: ""
        });
      });
    }

    // 兜底：什么都没解析出来，整句当一条待办，时间用默认值
    if (!items.length) {
      items.push({
        title: cleanAction(clauses.join("，")) || text,
        fire_at: now + 1800,
        kind: "task", place: "", note: "", priority: 2, matched: ""
      });
    }
    return items;
  }

  /* ===================== 4. 感知与工作块 ===================== */

  var senseTicks = 0;
  var sample = null;          // 主进程推来的最近一拍
  var snapshots = [];         // 最近 20 拍的完整窗口明细，只放内存，给「轮询」页看
  var pollPick = 0;           // 轮询页当前看的是第几拍（0 = 最新）

  /* 手动纠正优先，30 分钟后失效回到自动识别。
     为什么要这个：手写映射表不可能覆盖所有软件，认错了总得给人一条出路。 */
  function currentCat() {
    var until = state.settings.catManualUntil || 0;
    if (until && nowSec() < until) return state.settings.cat || "browse";
    return (sample && sample.cat) || state.settings.cat || "browse";
  }

  /* 只区分「暂停 / 在跑」，不猜人有没有离开。
     代价说清楚：离开电脑的那段时间会算在最后一次的前台应用上。
     这是有意的取舍——宁可少猜，也不要拿一个拍脑袋的阈值去改数据。 */
  function isActiveNow() {
    if (!state) return false;
    return !state.settings.paused;
  }

  function closeBlock() {
    if (!state.currentBlock) return;
    var b = state.currentBlock;
    var day = bjDate(b.start);
    var d = ensureDay(day);
    if (b.secs >= 60) {
      // app 要一起存下来：界面里靠它证明「这段是自动记的」，不是编的
      d.blocks.push({ start: b.start, end: b.end, cat: b.cat, secs: b.secs, app: b.app || "" });
      if (d.blocks.length > 240) d.blocks = d.blocks.slice(-240);
      // 只把够长的段落写进温层日志，碎片不记
      logEvent({ k: "block", day: day, start: b.start, secs: b.secs, cat: b.cat, app: b.app || "" });
    }
    state.currentBlock = null;
  }

  function tickSense(s) {
    if (!state) return;
    if (s) {
      sample = s;
      snapshots.unshift({
        at: s.at || nowSec(),
        fgExe: s.exe || "",
        fgCat: s.cat,
        fgKnown: s.known !== false,
        windows: Array.isArray(s.windows) ? s.windows : [],
      });
      if (snapshots.length > 20) snapshots.length = 20;
      // 如果你正在看某一拍的历史，新数据进来后下标要跟着后移，
      // 否则你盯着的那一拍会悄悄变成别的
      if (pollPick > 0) pollPick = Math.min(pollPick + 1, 19);
    }

    var now = nowSec();
    var day = bjDate(now);
    var d = ensureDay(day);
    var cat = currentCat();
    var active = isActiveNow();
    // 这一拍代表多少秒，由主进程的采样节拍决定（现在是一分钟）
    var step = (sample && sample.step) || 60;

    if (active) {
      d.activeSec = (d.activeSec || 0) + step;
      d.byCat[cat] = (d.byCat[cat] || 0) + step;
      if (sample && sample.app) {
        var rec = d.byApp[sample.app];
        if (!rec || typeof rec !== "object") rec = d.byApp[sample.app] = { secs: 0, cat: cat };
        rec.secs += step;
        rec.cat = cat;
      }

      var b = state.currentBlock;
      if (b && b.cat === cat && now - b.end <= 120) {
        b.end = now; b.secs += step; b.app = (sample && sample.app) || b.app;
      } else {
        closeBlock();
        state.currentBlock = { start: now, end: now, cat: cat, secs: step, app: (sample && sample.app) || "" };
      }
    } else if (state.currentBlock) {
      closeBlock();
    }

    // 久坐提醒：连续工作到阈值且有足够长的间隔
    maybeSitReminder(now);

    // 跨天：把当前块归到起始那天，避免 0 点整丢一段
    if (state.currentBlock && bjDate(state.currentBlock.start) !== day) {
      closeBlock();
    }

    // 一拍就是一分钟，正好是「每分钟刷一次界面」的天然节奏。
    // 再密就会打断列表滚动和 hover 状态，再疏数字就显得卡。
    senseTicks += 1;
    if ($stats["st-active"]) renderStats();
    render();

    chatterTick(now, active);

    prune();
    save();
    renderLive();
  }

  function maybeSitReminder(now) {
    var every = state.settings.sitEvery || 0;
    if (!every) return;
    if (!state.currentBlock) return;
    if (state.currentBlock.secs < every * 60) return;
    var last = state.days[bjDate(now)] && state.days[bjDate(now)].sitAt;
    if (last && now - last < 2 * 3600) return;
    var d = ensureDay(bjDate(now));
    d.sitAt = now;
    d.sits = (d.sits || 0) + 1;
    state.reminders.push(makeReminder({
      title: "起来走两步，顺便看看远处",
      fire_at: now,
      kind: "stand",
      priority: 2
    }, now));
    save();
  }

  function todayDay() { return ensureDay(bjDate()); }

  function todayBlocks() {
    var d = todayDay();
    var list = d.blocks.slice();
    var b = state.currentBlock;
    if (b && bjDate(b.start) === bjDate() && b.secs >= 60) {
      list.push({ start: b.start, end: b.end, cat: b.cat, secs: b.secs, app: b.app || "" });
    }
    return list.sort(function (a, b2) { return a.start - b2.start; });
  }

  /* 界面上只列满 2 分钟的段。
     更短的碎片仍然是数据：早就加进 activeSec 和 byCat 了，也会进工作块统计，
     只是「今天在做什么」里不列出来，否则一分钟切一次窗口，列表会全是噪音。 */
  var SHOW_BLOCK_MIN = 120;
  function shownBlocks() {
    return todayBlocks().filter(function (b) { return b.secs >= SHOW_BLOCK_MIN; });
  }

  function dayStat(day) {
    var d = state.days[day] || { activeSec: 0, byCat: {}, blocks: [] };
    var blocks = (d.blocks || []).slice();
    if (day === bjDate() && state.currentBlock && state.currentBlock.secs >= 60) {
      blocks.push(state.currentBlock);
    }
    return {
      activeSec: d.activeSec || 0,
      byCat: d.byCat || {},
      blocks: blocks.sort(function (a, b) { return a.start - b.start; })
    };
  }

  /* ===================== 5. 提醒调度 ===================== */

  function toMin(hhmm) {
    var p = String(hhmm || "0:0").split(":");
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  function minuteOfDay(ts) {
    var d = new Date((ts + BJ) * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  function inRange(min, a, b) {
    var s = toMin(a), e = toMin(b);
    if (s === e) return false;
    return s <= e ? (min >= s && min < e) : (min >= s || min < e);
  }

  function isQuiet(ts) {
    var S = state.settings;
    var min = minuteOfDay(ts);
    if (inRange(min, S.quietStart, S.quietEnd)) {
      if (S.adaptiveQuiet && isActiveNow()) return false;
      return true;
    }
    if (inRange(min, S.lunchStart, S.lunchEnd)) return true;
    return false;
  }

  function budgetOk(now) {
    var S = state.settings;
    var win = S.budgetWindowMin * 60;
    state.budget = (state.budget || []).filter(function (t) { return now - t < win; });
    if (state.budget.length >= S.budgetMax) return false;
    if (state.budget.length) {
      var last = Math.max.apply(null, state.budget);
      if (now - last < S.budgetGapMin * 60) return false;
    }
    return true;
  }

  function mailReminderText(r, now) {
    var parts = [r.title];
    var late = now - r.fire_at;
    if (late >= 120) parts.push("已逾期 " + span(late));
    if (r.duration_min) parts.push("约 " + dur(r.duration_min * 60));
    if (r.place) parts.push(r.place);
    if (r.note) parts.push(r.note);
    if (r.priority === 1) parts.push("重要");
    return parts.join(" · ");
  }

  function fire(r, now) {
    r.status = 1;
    r.fired_at = now;
    if (r.level < 1) state.budget.push(now);
    var d = ensureDay(bjDate(now));
    d.fired = (d.fired || 0) + 1;

    var text = mailReminderText(r, now);
    say("⏰ " + text, 12000);
    petAlert();
    beep();
    notifySystem(r);
    log("提醒", r.title);
    save();
    render();
  }

  function tickRemind() {
    if (!state) return;
    var now = nowSec();
    var due = state.reminders.filter(function (r) { return r.status === 0 && r.fire_at <= now; })
      .sort(function (a, b) { return a.fire_at - b.fire_at; });

    for (var i = 0; i < due.length; i++) {
      var r = due[i];
      var hard = r.level >= 1;
      var block = false;

      if (hard) {
        if (state.settings.cat === "meeting" && (r.defers || 0) < 2) block = true;
      } else {
        if (isQuiet(now)) block = true;
        else if (state.settings.cat === "meeting") block = true;
        else if (!budgetOk(now)) block = true;
      }

      if (block) {
        r.fire_at = now + state.settings.deferMin * 60;
        r.defers = (r.defers || 0) + 1;
        r.deferred_at = now;
        save();
      } else {
        fire(r, now);
      }
    }
  }

  function maybeDigest() {
    var now = nowSec();
    var day = bjDate(now);
    if (state.digestDay === day) return;
    var overdue = state.reminders.filter(function (r) {
      return isOpen(r) && r.fire_at < now - 6 * 3600;
    });
    if (overdue.length < 2) return;
    var h = bjHour(now);
    if (h < 9 || h >= 21) return;
    if (isQuiet(now)) return;
    state.digestDay = day;
    var names = overdue.slice(0, 3).map(function (r) { return r.title; }).join("、");
    say("有 " + overdue.length + " 件事逾期了：" + names + (overdue.length > 3 ? " 等" : "") + "。挑一件先做？", 13000);
    log("催办", overdue.length + " 件逾期");
    save();
  }

  function notifySystem(r) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;   // 看得见页面时，气泡已经够了
    try {
      new Notification("乐伴WorkMate · " + bjHM(nowSec()), { body: r.title, tag: "wm-" + r.id });
    } catch (e) {}
  }

  var audioCtx = null;
  function beep() {
    if (!state.settings.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime;
      [0, 0.14].forEach(function (dt, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = i === 0 ? 880 : 1180;
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(0.14, t + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + dt); o.stop(t + dt + 0.24);
      });
    } catch (e) {}
  }

  function makeReminder(it, now) {
    now = now || nowSec();
    return {
      id: uid("r"),
      title: it.title || "提醒",
      fire_at: it.fire_at || now + 1800,
      level: (it.priority === 1 || it.kind === "event") ? 1 : 0,
      priority: it.priority || 2,
      kind: it.kind || "task",
      place: it.place || "",
      note: it.note || "",
      duration_min: it.duration_min || 0,
      status: 0,
      created_at: now,
      fired_at: 0,
      done_at: 0,
      defers: 0
    };
  }

  /* ===================== 6. 记忆与问答 ===================== */

  function catLabel(id) { return (CAT_MAP[id] || CAT_MAP.other).label; }
  function catColor(id) { return (CAT_MAP[id] || CAT_MAP.other).color; }

  function topCats(byCat, n) {
    return Object.keys(byCat).map(function (k) { return [k, byCat[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 3);
  }

  function dayFacts(day) {
    var st = dayStat(day);
    var blocks = st.blocks;
    var longest = blocks.reduce(function (m, b) { return Math.max(m, b.secs); }, 0);
    var created = state.reminders.filter(function (r) { return bjDate(r.created_at) === day; }).length;
    var done = state.reminders.filter(function (r) { return r.status === 2 && bjDate(r.done_at) === day; }).length;
    var pending = state.reminders.filter(function (r) { return isOpen(r) && r.fire_at < bjDayStart(day) + DAY; }).length;
    var overdue = state.reminders.filter(function (r) { return isOpen(r) && r.fire_at < nowSec(); }).length;
    var firstStart = blocks.length ? blocks[0].start : 0;
    var lastEnd = blocks.length ? blocks[blocks.length - 1].end : 0;
    return {
      day: day, activeSec: st.activeSec, byCat: st.byCat,
      blocks: blocks.length, longest: longest,
      firstStart: firstStart, lastEnd: lastEnd,
      created: created, done: done, pending: pending, overdue: overdue,
      sits: (state.days[day] && state.days[day].sits) || 0
    };
  }

  function factsText(day) {
    var f = dayFacts(day || bjDate());
    var lines = [];
    lines.push("日期：" + f.day + "（" + weekdayOfDay(f.day) + "）");
    lines.push("页面在线：" + dur(f.activeSec) + "（每 1 分钟一拍）");
    if (f.blocks) {
      lines.push("工作块：" + f.blocks + " 段，最长一段 " + dur(f.longest));
      lines.push("时段：第一段 " + bjHM(f.firstStart) + " 开始，最后一段 " + bjHM(f.lastEnd) + " 结束");
    } else {
      lines.push("工作块：没有采到任何数据——禁止据此评价忙闲");
    }
    var tc = topCats(f.byCat, 3).filter(function (x) { return x[1] > 0; });
    lines.push("时间去向：" + (tc.length ? tc.map(function (x) { return catLabel(x[0]) + " " + dur(x[1]) + "（" + pct(x[1], f.activeSec) + "%）"; }).join("、") : "无"));
    lines.push("待办：新建 " + f.created + " 件，完成 " + f.done + " 件，未完成 " + f.pending + " 件，其中逾期 " + f.overdue + " 件");
    if (f.sits) lines.push("起身提醒：" + f.sits + " 次");
    return lines.join("\n");
  }

  function buildDiary(day) {
    var f = dayFacts(day || bjDate());
    if (!f.activeSec || f.activeSec < 60) {
      return "今天没有留下活动记录，这里就不猜你忙不忙了。";
    }
    var s = "今天页面在线 " + dur(f.activeSec);
    var tc = topCats(f.byCat, 2).filter(function (x) { return x[1] > 0; });
    if (tc.length) {
      s += "，主要在" + catLabel(tc[0][0]) + "（" + pct(tc[0][1], f.activeSec) + "%）";
      if (tc[1]) s += "和" + catLabel(tc[1][0]) + "（" + pct(tc[1][1], f.activeSec) + "%）";
    }
    if (f.blocks) s += "；分成 " + f.blocks + " 段，最长的一段 " + dur(f.longest) + "。";
    else s += "。";

    var tail = [];
    if (f.done) tail.push("完成 " + f.done + " 件");
    if (f.pending) tail.push((f.done ? "还挂着 " : "挂着 ") + f.pending + " 件");
    if (f.overdue) tail.push("其中 " + f.overdue + " 件逾期");
    if (tail.length) s += tail.join("，") + "。";
    if (f.firstStart && f.lastEnd) {
      s += "从 " + bjHM(f.firstStart) + " 到 " + bjHM(f.lastEnd) + "，中间有几次离开。";
    }
    return s;
  }

  function habitStats(days) {
    days = days || 7;
    var today = bjDate();
    var list = [];
    for (var i = 0; i < days; i++) {
      var d = bjDate(nowSec() - i * DAY);
      var f = dayFacts(d);
      if (f.activeSec >= 300) list.push(f);
    }
    if (!list.length) return null;
    var avg = list.reduce(function (a, f) { return a + f.activeSec; }, 0) / list.length;
    var starts = list.filter(function (f) { return f.firstStart; }).map(function (f) { return bjHM(f.firstStart); });
    var ends = list.filter(function (f) { return f.lastEnd; }).map(function (f) { return bjHM(f.lastEnd); });
    var byCat = {};
    list.forEach(function (f) {
      Object.keys(f.byCat).forEach(function (k) { byCat[k] = (byCat[k] || 0) + f.byCat[k]; });
    });
    return {
      days: list.length,
      avg: avg,
      start: starts.length ? starts.sort()[0] : "—",
      end: ends.length ? ends.sort()[ends.length - 1] : "—",
      cats: topCats(byCat, 2),
      total: list.reduce(function (a, f) { return a + f.activeSec; }, 0)
    };
  }

  function risks() {
    var now = nowSec();
    var out = [];
    var overdue = state.reminders.filter(function (r) { return isOpen(r) && r.fire_at < now; });
    if (overdue.length) {
      var oldest = overdue.slice().sort(function (a, b) { return a.fire_at - b.fire_at; })[0];
      out.push({
        level: "err",
        text: "有 " + overdue.length + " 件事逾期，最久的是「" + oldest.title + "」，已经 " + span(now - oldest.fire_at) + "。"
      });
    }
    var pending = state.reminders.filter(isOpen);
    if (pending.length >= 5) {
      out.push({ level: "warn", text: "待办堆到 " + pending.length + " 件了。今天先清两件，比排序更重要。" });
    }
    if (state.currentBlock && state.currentBlock.secs >= 90 * 60) {
      out.push({ level: "warn", text: "已经连续坐了 " + dur(state.currentBlock.secs) + "，起来走两步。" });
    }
    var h = bjHour(now);
    if ((h >= 23 || h < 5) && isActiveNow()) {
      out.push({ level: "warn", text: "这个点还在电脑前。明天大概率会困，能收就收。" });
    }
    var today = todayDay();
    if (!today.activeSec && h >= 10 && h <= 18) {
      out.push({ level: "", text: "今天还没有记录到活动。如果刚打开页面，忽略这条。" });
    }
    return out;
  }

  /* ===================== 7. 台词与冒险 ===================== */

  var nextStoryAt = 0;      // 下次出门的时间点（秒）。不持久化，重启重新算
  var nextTeaseAt = 0;
  var nextWarmAt = 0;
  var lastTouchAt = 0;      // 上次被摸/被点的时间
  var tripAt = 0;           // 已经说要出门了，等它带着故事回来的时间点
  var boredSaid = false;    // 这一轮冷落只提醒一次

  /* 当天用过的应用，按时长降序。对战的对手从这里挑。 */
  function appList() {
    var d = state.days[bjDate()] || {};
    var byApp = d.byApp || {};
    return Object.keys(byApp).map(function (name) {
      var rec = byApp[name];
      var secs = (rec && typeof rec === "object") ? rec.secs : rec;
      var cat = (rec && typeof rec === "object") ? rec.cat : "other";
      return { name: name, secs: secs || 0, cat: cat || "other" };
    }).filter(function (a) { return a.secs >= 60; })
      .sort(function (a, b) { return b.secs - a.secs; });
  }

  function activePane() {
    var t = document.querySelector(".tab.active");
    return t ? t.dataset.pane : "";
  }

  /* 往冒险日志里加一条。出发 / 途中 / 回来，以及平时的自己出门，都走这里。 */
  function pushStory(label, text, kind) {
    state.stories.unshift({ ts: nowSec(), kind: kind || "trip", label: label, text: text });
    if (state.stories.length > 40) state.stories.length = 40;
    logEvent({ k: "story", kind: kind || "trip", text: text });
    say(text, 9000, label);
    save();
    if (activePane() === "memory") renderStory();
  }

  function tellStory(isBack) {
    // 没有应用记录也能讲故事（遭遇战/桌游/出门不依赖数据），
    // 只有「对战某某软件」需要当天用过东西。
    var recent = (state.stories || []).slice(0, 2).map(function (s) { return s.kind; });
    var r = Story.tell({ apps: appList() }, recent);
    if (!r || !r.text) return;
    pushStory(r.label, isBack ? "我回来了。" + r.text : r.text, r.kind);
  }

  /* 每分钟进来一次，只做几个时间比较，不干重活 */
  function chatterTick(now, active) {
    if (state.settings.paused) return;
    if (!lastTouchAt) lastTouchAt = now;

    // 专注夸：同一个工作块只夸一次，夸完打标记
    var cur = state.currentBlock;
    if (active && cur && cur.secs >= 25 * 60 && !cur.praised) {
      cur.praised = true;
      say(Lines.praise(Math.round(cur.secs / 60)), 6000, "夸你");
    }

    // 远行途中：每半小时发生一件事，走完就回家。期间不插播日常碎嘴。
    if (state.trip) {
      var t = state.trip;
      if (now >= t.end) { endTrip(); return; }
      if (now >= t.next) {
        t.next = now + TRIP_STEP;
        t.n = (t.n || 0) + 1;
        tripEvent();
        save();
      }
      return;
    }

    // 冷落太久：先申请出门，两三分钟后带着故事回来。
    // 这是「互动感」的核心——它不会一直等你，会自己找事做。
    if (!tripAt && !boredSaid && now - lastTouchAt > 30 * 60) {
      boredSaid = true;
      tripAt = now + (2 + Math.random() * 3) * 60;
      say(Lines.wantOut(), 7000, "请示");
      return;
    }
    if (tripAt && now >= tripAt) {
      tripAt = 0;
      boredSaid = false;
      lastTouchAt = now;
      tellStory(true);
      return;
    }

    // 自己出门：开机五分钟后先来一趟，之后每小时一趟
    if (!nextStoryAt) nextStoryAt = now + 5 * 60;
    if (now >= nextStoryAt) {
      nextStoryAt = now + 60 * 60;
      tellStory();
      return;
    }

    // 卖萌 / 真情：和冒险错开，第一次 20–40 分钟，之后 70–120 分钟一句。
    // 这类话少了才暖，多了就变噪音。
    if (!nextWarmAt) nextWarmAt = now + (20 + Math.random() * 20) * 60;
    if (now >= nextWarmAt) {
      nextWarmAt = now + (70 + Math.random() * 50) * 60;
      say(Lines.warm(), 8000, "撒娇");
      return;
    }

    // 窗口切得太碎，被它念叨一句，20 分钟最多一次
    if (active && now > nextTeaseAt) {
      var today = (state.days[bjDate()] || {}).blocks || [];
      if (today.length >= 6) {
        var short = today.slice(-6).filter(function (b) { return b.secs < 300; });
        if (short.length >= 3) {
          nextTeaseAt = now + 20 * 60;
          say(Lines.tease(), 5200, "吐槽");
        }
      }
    }
  }

  function renderStory() {
    var box = $("#story-list");
    if (!box) return;
    var list = state.stories || [];
    $("#story-sub").textContent = list.length ? list.length + " 段" : "";
    if (!list.length) {
      box.innerHTML = '<div class="empty">它还没出门。过一会儿再来看看。</div>';
      return;
    }
    box.innerHTML = list.slice(0, 8).map(function (s) {
      var when = bjDate(s.ts) === bjDate() ? bjHM(s.ts) : bjDate(s.ts).slice(5);
      return '<div class="feed-item"><time>' + when + "</time>" +
        "<span><b>" + esc(s.label) + "</b> · " + esc(s.text) + "</span></div>";
    }).join("");
  }

  /* ===================== 8. 宠物 ===================== */

  var petState = "idle";
  var bubbleTimer = null;
  var oneshotTimer = null;
  var zzzEl = null;
  var sprite = null;          // 左栏的序列帧播放器

  function setPet(next) {
    if (petState === next) return;
    document.body.classList.remove("state-" + petState);
    document.body.classList.add("state-" + next);
    petState = next;

    // 左栏这一只自己播；桌面上那只由主进程转发，两边同步
    if (sprite) sprite.play(sprite.mapState(next));
    if (next !== "hover") WM.petState(next);

    if (next === "sleepy" && !zzzEl) {
      zzzEl = document.createElement("div");
      zzzEl.className = "zzz";
      zzzEl.innerHTML = "<span>z</span><span>z</span><span>z</span>";
      $("#fx").appendChild(zzzEl);
    }
    if (next !== "sleepy" && zzzEl) {
      zzzEl.remove();
      zzzEl = null;
    }
    clearTimeout(oneshotTimer);
    if (next === "celebrate" || next === "alert") {
      var ms = next === "celebrate" ? 950 : 1600;
      oneshotTimer = setTimeout(function () { if (petState === next) setPet("idle"); }, ms);
    }
  }

  function say(text, ms, tag) {
    ms = ms || 4600;
    // 说了什么就记进「狗子动态」，tag 是那两个汉字
    if (tag) log(tag, text);
    // 桌面那只狗也要说话：主进程转发到桌宠窗
    if (WM.isDesktop) WM.say({ text: text, ms: ms });
    var bubble = $("#bubble");
    var scrollBox = bubble.querySelector(".bubble-body");
    $("#bubble-text").textContent = text;
    bubble.hidden = false;
    // 上一条如果是长提醒被滚到中段，下一条短句会从中间开始显示，看着像被裁掉
    if (scrollBox) scrollBox.scrollTop = 0;
    requestAnimationFrame(function () { bubble.classList.add("show"); });
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      bubble.classList.remove("show");
      setTimeout(function () { bubble.hidden = true; }, 200);
      if (petState === "talk") setPet("idle");
    }, ms);
    setPet("talk");
    clearTimeout(oneshotTimer);
    oneshotTimer = setTimeout(function () { if (petState === "talk") setPet("idle"); }, Math.min(ms, 2600));
  }

  function petAlert() {
    setPet("alert");
    var el = document.createElement("div");
    el.className = "bang";
    el.textContent = "!";
    $("#fx").appendChild(el);
    setTimeout(function () { el.remove(); }, 1800);
  }

  function petCelebrate() {
    setPet("celebrate");
    var el = document.createElement("div");
    el.className = "bang";
    el.textContent = "✓";
    el.style.background = "linear-gradient(90deg,#22C55E,#14B8A6)";
    $("#fx").appendChild(el);
    setTimeout(function () { el.remove(); }, 1200);
  }

  /* ===================== 9. 界面渲染 ===================== */

  var $stats = {};
  function cacheEls() {
    ["st-active", "st-focus", "st-blocks", "st-pending", "cats", "cats-total", "blocks", "blocks-sum",
      "feed", "diary-text", "diary-sub", "todo-list", "todo-sum", "story-list", "story-sub",
      "notes-short", "notes-mid", "notes-long", "hb-days", "hb-avg", "hb-span", "hb-cats", "risks",
      "live-dot", "live-text", "live-focus", "live-app", "today-date", "cat-select",
      "poll-sub", "poll-body"].forEach(function (id) {
      $stats[id] = document.getElementById(id);
    });
  }

  function renderLive() {
    if (!state) return;
    var el = $stats["live-dot"];
    var paused = state.settings.paused;
    el.className = "dot " + (paused ? "pause" : "on");
    $stats["live-text"].textContent = paused ? "已暂停" : "计时中";
    var b = state.currentBlock;
    $stats["live-focus"].textContent = b && b.secs >= 60 ? "连续 " + dur(b.secs) : "专注 —";

    // 此刻在做：显示进程名；类别在下面的「纠正」下拉里同步
    // 还没拍到任何东西时，按约定直接显示「浏览」。
    var cat = currentCat();
    var hasApp = !!(sample && (sample.app || sample.exe));
    var appEl = $stats["live-app"];
    if (appEl) {
      var name = "浏览";
      if (hasApp) {
        name = sample.app || String(sample.exe).split("\\").pop().replace(/\.exe$/i, "");
      }
      appEl.textContent = name;
      appEl.title = (sample && sample.title) || "";
    }
    var sel = $stats["cat-select"];
    if (sel && sel.value !== cat) sel.value = cat;

    // 设置页那行「当前前台」，顺便带上窗口标题
    var fgEl = document.getElementById("env-fg");
    if (fgEl) {
      var t = "—";
      if (sample) {
        t = sample.app || (sample.self ? "本应用" : "—");
        if (sample.title) t += " · " + sample.title.slice(0, 18);
      }
      fgEl.textContent = t;
    }
  }

  // 四个数字单独抽出来：只更这几处，避免整页重绘打断交互
  function renderStats() {
    var st = dayStat(bjDate());
    var blocks = todayBlocks();
    $stats["st-active"].textContent = st.activeSec ? dur(st.activeSec) : "—";
    var cur = state.currentBlock;
    $stats["st-focus"].textContent = cur && cur.secs >= 60 ? dur(cur.secs) : "—";
    $stats["st-blocks"].textContent = blocks.length || "—";
    $stats["st-pending"].textContent = state.reminders.filter(isOpen).length || "0";
    $stats["today-date"].textContent = bjDate() + " " + bjWeek(nowSec());
  }

  function renderToday() {
    var d = todayDay();
    var st = dayStat(bjDate());
    var blocks = shownBlocks();

    renderStats();

    // 时间去向
    var total = st.activeSec || 0;
    $stats["cats-total"].textContent = total ? dur(total) : "";
    var items = Object.keys(st.byCat).map(function (k) { return { id: k, sec: st.byCat[k] }; })
      .sort(function (a, b) { return b.sec - a.sec; })
      .filter(function (x) { return x.sec >= 60; });
    if (!items.length) {
      $stats["cats"].innerHTML = '<div class="empty">还没有数据。切到别的软件，1 分钟后开始记录。</div>';
    } else {
      var max = items[0].sec;
      $stats["cats"].innerHTML = items.map(function (x) {
        return '<div class="bar">' +
          '<div class="bar-head"><span class="b-l"><i class="swatch" style="background:' + catColor(x.id) + '"></i>' + esc(catLabel(x.id)) + '</span>' +
          '<span class="b-v">' + dur(x.sec) + ' · ' + pct(x.sec, total) + '%</span></div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(3, Math.round(x.sec / max * 100)) + '%;background:' + catColor(x.id) + '"></div></div>' +
          '</div>';
      }).join("");
    }

    // 工作块时间轴（全自动，不需要手填）
    $stats["blocks-sum"].textContent = blocks.length ? blocks.length + " 段 · " + dur(total) : "";
    if (!blocks.length) {
      $stats["blocks"].innerHTML = '<div class="empty">还没有工作记录。切到别的软件，满一分钟就会自己出现。</div>';
    } else {
      var maxB = Math.max.apply(null, blocks.map(function (b) { return b.secs; }));
      $stats["blocks"].innerHTML = blocks.slice(-14).map(function (b) {
        // 带上进程名：一眼能看出这段是「自己记的」还是「真的在用某个软件」
        var app = b.app ? '<i class="blk-app">' + esc(b.app) + "</i>" : "";
        return '<div class="blk">' +
          '<span class="blk-t">' + bjHM(b.start) + '</span>' +
          '<div class="blk-main">' +
          '<div class="blk-l"><span>' + esc(catLabel(b.cat)) + app + '</span><span>' + dur(b.secs) + '</span></div>' +
          '<span class="blk-track"><span class="blk-fill" style="width:' + Math.max(4, Math.round(b.secs / maxB * 100)) + '%;background:' + catColor(b.cat) + '"></span></span>' +
          '</div></div>';
      }).join("");
    }

    // 日记
    var note = state.notes.short[bjDate()];
    $stats["diary-text"].textContent = note ? note.text : "还没有写今天的日记。点下面按钮，用今天的数据生成一句。";
    $stats["diary-sub"].textContent = note ? "已生成" : "";

    // 最近发生：狗子的动态，只在内存里，关掉就清空
    if (!dogFeed.length) {
      $stats["feed"].innerHTML = '<div class="empty">它还没动。点它一下试试。</div>';
    } else {
      $stats["feed"].innerHTML = dogFeed.slice(0, 8).map(function (f) {
        return '<div class="feed-item"><time>' + bjHM(f.ts) + '</time>' +
          '<span><b class="feed-tag">' + esc(f.tag) + '</b> ' + esc(f.text) + "</span></div>";
      }).join("");
    }
  }

  function renderTodos() {
    var now = nowSec();
    var pending = state.reminders.filter(isOpen);
    var done = state.reminders.filter(function (r) { return r.status === 2; })
      .sort(function (a, b) { return (b.done_at || 0) - (a.done_at || 0); }).slice(0, 6);
    var overdue = pending.filter(function (r) { return r.fire_at < now; })
      .sort(function (a, b) { return a.fire_at - b.fire_at; });
    var upcoming = pending.filter(function (r) { return r.fire_at >= now; })
      .sort(function (a, b) { return a.fire_at - b.fire_at; });

    $stats["todo-sum"].textContent = pending.length
      ? pending.length + " 件未完成" + (overdue.length ? " · " + overdue.length + " 件逾期" : "")
      : "";

    function row(r) {
      var chips = [];
      var isOverdue = isOpen(r) && r.fire_at < now;
      chips.push('<span class="chip' + (isOverdue ? " overdue" : "") + '">' +
        (isOverdue ? "已逾期 " + span(now - r.fire_at) : bjWhen(r.fire_at)) + "</span>");
      if (r.kind === "event") chips.push('<span class="chip event">日程' + (r.place ? " · " + esc(r.place) : "") + "</span>");
      if (r.kind === "stand") chips.push('<span class="chip">起身</span>');
      if (r.priority === 1 && r.kind !== "event") chips.push('<span class="chip">重要</span>');
      if (r.defers) chips.push('<span class="chip">已顺延 ' + r.defers + " 次</span>");
      if (r.status === 1) chips.push('<span class="chip">已提醒</span>');
      if (r.status === 2) chips.push('<span class="chip done">已完成</span>');
      return '<div class="todo' + (r.status === 2 ? " done" : "") + '" data-id="' + r.id + '">' +
        '<input type="checkbox" data-act="toggle" ' + (r.status === 2 ? "checked" : "") + ' />' +
        '<div class="todo-main"><div class="todo-title">' + esc(r.title) + "</div>" +
        '<div class="todo-meta">' + chips.join("") + (r.note ? "<span>" + esc(r.note) + "</span>" : "") + "</div></div>" +
        '<button class="todo-del" data-act="del" title="删除">✕</button></div>';
    }

    var html = "";
    if (overdue.length) html += '<div class="todo-group"><h3>逾期</h3>' + overdue.map(row).join("") + "</div>";
    if (upcoming.length) html += '<div class="todo-group"><h3>待办</h3>' + upcoming.map(row).join("") + "</div>";
    if (done.length) html += '<div class="todo-group"><h3>已完成</h3>' + done.map(row).join("") + "</div>";
    if (!html) html = '<div class="empty">清单是空的。上面写一句试试。</div>';
    $stats["todo-list"].innerHTML = html;
  }

  function renderMemory() {
    if (!$stats["notes-short"]) return;
    renderStory();
    var now = nowSec();
    var keys = Object.keys(state.notes.short).sort().reverse();
    $stats["notes-short"].innerHTML = keys.length
      ? keys.slice(0, 7).map(function (k) {
          return '<div class="note"><b>' + k.slice(5) + " " + weekdayOfDay(k) + "</b> " + esc(state.notes.short[k].text) + "</div>";
        }).join("")
      : '<div class="empty">还没有。点下面的「压缩今天」。</div>';

    var mids = Object.keys(state.notes.mid).sort().reverse();
    $stats["notes-mid"].innerHTML = mids.length
      ? mids.slice(0, 4).map(function (k) {
          return '<div class="note"><b>' + k + "</b> " + esc(state.notes.mid[k].text) + "</div>";
        }).join("")
      : '<div class="empty">还没有。点下面的「压缩本月」。</div>';

    var longs = Object.keys(state.notes.long).sort().reverse();
    $stats["notes-long"].innerHTML = longs.length
      ? longs.slice(0, 2).map(function (k) {
          return '<div class="note"><b>' + k + "</b> " + esc(state.notes.long[k].text) + "</div>";
        }).join("")
      : '<div class="empty">还没有。先有月度摘要，再点「压缩长期」。</div>';

    var hb = habitStats(7);
    if (hb) {
      $stats["hb-days"].textContent = hb.days + " 天";
      $stats["hb-avg"].textContent = dur(hb.avg);
      $stats["hb-span"].textContent = hb.start + " / " + hb.end;
      $stats["hb-cats"].textContent = hb.cats.map(function (c) { return catLabel(c[0]) + " " + pct(c[1], hb.total) + "%"; }).join("、");
    } else {
      $stats["hb-days"].textContent = "—";
      $stats["hb-avg"].textContent = "—";
      $stats["hb-span"].textContent = "—";
      $stats["hb-cats"].textContent = "—";
    }

    var rk = risks();
    $stats["risks"].innerHTML = rk.length
      ? rk.map(function (r) { return '<div class="risk ' + r.level + '"><span>' + esc(r.text) + "</span></div>"; }).join("")
      : '<div class="empty">暂时没有需要注意的。</div>';
  }

  /* 轮询页分成两块：
       明细 —— 选中的那一拍，当时开着的所有窗口
       历史 —— 最近 20 拍，每拍只留前台那一行，点一行换上面的明细
     这一页是「自证清白」用的：不用信我说什么，看它每分钟读到了什么。 */
  function renderPoll() {
    var body = $stats["poll-body"];
    var hist = document.getElementById("poll-hist");
    var head = document.getElementById("poll-head");
    if (!body) return;

    if ($stats["poll-sub"]) {
      $stats["poll-sub"].textContent = snapshots.length
        ? "第 " + (pollPick + 1) + " / " + snapshots.length + " 拍"
        : "";
    }

    if (!snapshots.length) {
      if (head) head.textContent = "还没有拍到。等一分钟。";
      if (hist) hist.innerHTML = '<div class="empty">还没有拍到。等一分钟。</div>';
      body.innerHTML = '<tr><td colspan="3" class="empty">—</td></tr>';
      return;
    }
    if (pollPick >= snapshots.length) pollPick = 0;

    var snap = snapshots[pollPick];
    var list = snap.windows || [];
    var fgName = snap.fgExe ? String(snap.fgExe).split("\\").pop() : "—";

    if (head) {
      head.textContent = bjHM(snap.at) + " 这一拍 · " + list.length + " 个窗口 · 前台 " + fgName;
    }

    // ---- 明细 ----
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="3" class="empty">这一拍没读到窗口。</td></tr>';
    } else {
      body.innerHTML = list.map(function (w) {
        var cls = [];
        if (w.fg) cls.push("fg");
        if (w.known === false) cls.push("unknown");
        var exe = String(w.exe || "").split("\\").pop();
        var cat = catLabel(w.cat) + (w.known === false ? " · 表里没有" : "");
        return '<tr class="' + cls.join(" ") + '">' +
          "<td>" + (w.fg ? '<b class="fg-mark">前台</b>' : "") + esc(exe) + "</td>" +
          "<td>" + esc(cat) + "</td>" +
          '<td title="' + esc(w.title || "") + '">' + esc(w.title || "—") + "</td>" +
          "</tr>";
      }).join("");
    }

    // ---- 历史：只记前台 ----
    if (hist) {
      hist.innerHTML = snapshots.map(function (s, i) {
        var exe = s.fgExe ? String(s.fgExe).split("\\").pop() : "—";
        var cls = ["hist-item"];
        if (i === pollPick) cls.push("on");
        if (s.fgKnown === false) cls.push("unknown");
        return '<button type="button" class="' + cls.join(" ") + '" data-i="' + i + '">' +
          "<time>" + bjHM(s.at) + "</time>" +
          '<span class="hist-exe">' + esc(exe) + "</span>" +
          '<span class="hist-cat">' + esc(catLabel(s.fgCat)) + "</span>" +
          "</button>";
      }).join("");
    }
  }

  function render() {
    if (!state) return;
    renderLive();
    renderWalk();
    renderToday();
    renderTodos();
    renderPoll();
    renderMemory();
  }

  /* 远行按钮：途中显示剩余时间并禁用，回来再恢复 */
  function renderWalk() {
    var btn = document.getElementById("btn-walk");
    if (!btn || !state) return;
    if (state.trip && state.trip.end > nowSec()) {
      var left = state.trip.end - nowSec();
      btn.textContent = "远行中 · 还剩 " + dur(left);
      btn.disabled = true;
      btn.classList.add("on-trip");
    } else {
      btn.textContent = "远行冒险 →";
      btn.disabled = false;
      btn.classList.remove("on-trip");
    }
  }

  /* ===================== 10. 交互与启动 ===================== */

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 220);
    }, 2600);
  }

  function tabTo(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.pane === name);
    });
    document.querySelectorAll(".pane").forEach(function (p) {
      p.hidden = p.id !== "pane-" + name;
    });
    try { sessionStorage.setItem("wm.tab", name); } catch (e) {}
    // 切页要重绘：不然看到的是「上次渲染时」的内容。
    // 比如冒险日志在别的页生成，切回来还是空的。
    if (state) render();
  }

  function initTabs() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { tabTo(t.dataset.pane); });
    });
    var last = "today";
    try { last = sessionStorage.getItem("wm.tab") || "today"; } catch (e) {}
    tabTo(last);
  }

  function initCatSelect() {
    var sel = $stats["cat-select"];
    sel.innerHTML = CATS.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + "</option>";
    }).join("");
    sel.value = currentCat();
    sel.addEventListener("change", function () {
      state.settings.cat = sel.value;
      // 手动选了就按你选的算 30 分钟，否则下一拍自动识别会立刻把它顶掉
      state.settings.catManualUntil = nowSec() + MANUAL_MIN * 60;
      // 换类别即开新块：否则时间会被算到上一个类别头上
      closeBlock();
      save();
      render();
    });
  }

  function applySettingsToUI() {
    var S = state.settings;
    $("#set-quiet-start").value = S.quietStart;
    $("#set-quiet-end").value = S.quietEnd;
    $("#set-lunch-start").value = S.lunchStart;
    $("#set-lunch-end").value = S.lunchEnd;
    $("#set-budget-max").value = S.budgetMax;
    $("#set-budget-win").value = S.budgetWindowMin;
    $("#set-adaptive").checked = !!S.adaptiveQuiet;
    $("#set-sound").checked = !!S.sound;
    updateNotifyStatus();
  }

  function updateNotifyStatus() {
    var el = $("#notify-status");
    if (!("Notification" in window)) { el.textContent = "这个浏览器不支持系统通知"; return; }
    var p = Notification.permission;
    el.textContent = p === "granted" ? "已开启" : p === "denied" ? "已被拒绝（需在浏览器设置里改）" : "未开启";
  }

  function bindSettings() {
    function onTime(id, key) {
      $(id).addEventListener("change", function () {
        state.settings[key] = this.value || "00:00";
        save();
      });
    }
    onTime("#set-quiet-start", "quietStart");
    onTime("#set-quiet-end", "quietEnd");
    onTime("#set-lunch-start", "lunchStart");
    onTime("#set-lunch-end", "lunchEnd");

    $("#set-budget-max").addEventListener("change", function () {
      state.settings.budgetMax = clamp(parseInt(this.value, 10) || 0, 0, 8);
      this.value = state.settings.budgetMax;
      save();
    });
    $("#set-budget-win").addEventListener("change", function () {
      state.settings.budgetWindowMin = clamp(parseInt(this.value, 10) || 30, 10, 120);
      this.value = state.settings.budgetWindowMin;
      save();
    });
    $("#set-adaptive").addEventListener("change", function () {
      state.settings.adaptiveQuiet = this.checked; save();
    });
    $("#set-sound").addEventListener("change", function () {
      state.settings.sound = this.checked; save();
    });

    $("#btn-notify").addEventListener("click", function () {
      if (!("Notification" in window)) { toast("这个浏览器不支持系统通知"); return; }
      Notification.requestPermission().then(function (p) {
        updateNotifyStatus();
        toast(p === "granted" ? "系统通知已开启" : "没有拿到通知权限");
      });
    });
    $("#btn-notify-test").addEventListener("click", function () {
      if (!("Notification" in window) || Notification.permission !== "granted") {
        toast("先开启系统通知"); return;
      }
      try { new Notification("乐伴WorkMate", { body: "这就是到点提醒的样子。" }); } catch (e) {}
      say("通知发出来了。没看到的话，检查系统通知中心。");
    });

    // ---- 数据与环境 ----
    $("#btn-open-data").addEventListener("click", function () {
      if (WM.isDesktop) WM.openData();
      else toast("浏览器版没有数据文件夹");
    });
    $("#btn-rotate").addEventListener("click", function () {
      if (!WM.isDesktop) { toast("浏览器版不落盘，没有历史可归档"); return; }
      WM.rotate().then(function (done) {
        $("#store-status").textContent = (done && done.length)
          ? "已归档 " + done.length + " 个月"
          : "还没有需要归档的月份";
      });
    });

    if (WM.isDesktop) {
      WM.env().then(function (e) {
        $("#env-dir").textContent = e.dataDir || "—";
        $("#env-ver").textContent = "Electron " + e.versions.electron + " · Chrome " + e.versions.chrome;
        if (!e.samplerOk) {
          $("#store-status").textContent = "前台识别不可用，只能按空闲时间计时";
        }
      });
    } else {
      $("#env-dir").textContent = "浏览器存储";
      $("#env-ver").textContent = "浏览器（降级模式）";
    }

    $("#btn-export").addEventListener("click", exportJson);
    $("#btn-export-quick").addEventListener("click", exportJson);
    $("#btn-export-csv").addEventListener("click", exportCsv);
    $("#btn-import").addEventListener("click", function () { $("#file-import").click(); });
    $("#file-import").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(String(r.result));
          if (!data || !data.reminders) throw new Error("不是乐伴WorkMate 的导出文件");
          state = data;
          Object.keys(defaults()).forEach(function (k) { if (state[k] === undefined) state[k] = defaults()[k]; });
          saveNow();
          location.reload();
        } catch (e) { toast("导入失败：" + e.message); }
      };
      r.readAsText(f);
    });
    $("#btn-reset").addEventListener("click", function () {
      if (!confirm("清空全部数据？待办、日记、工作块、冒险日志都会删掉，且无法恢复。建议先导出 JSON。")) return;
      resetting = true;
      WM.reset().then(function (r) {
        if (r && r.ok === false) {
          resetting = false;
          toast("删除失败：" + (r.error || "未知原因"));
          return;
        }
        location.reload();
      });
    });
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    download(blob, "workmate-" + bjDate() + ".json");
    toast("已导出 JSON");
  }

  function exportCsv() {
    var rows = [["date", "start", "end", "minutes", "category"]];
    Object.keys(state.days).sort().forEach(function (d) {
      (state.days[d].blocks || []).forEach(function (b) {
        rows.push([d, bjHM(b.start), bjHM(b.end), Math.round(b.secs / 60), catLabel(b.cat)]);
      });
    });
    var csv = "\ufeff" + rows.map(function (r) { return r.join(","); }).join("\n");
    download(new Blob([csv], { type: "text/csv" }), "workmate-blocks-" + bjDate() + ".csv");
    toast("已导出 CSV");
  }

  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 待办 ---------- */

  function todoPreview() {
    var box = $("#todo-preview");
    var v = $("#todo-input").value.trim();
    if (!v) { box.hidden = true; return; }
    var items = splitItems(v, nowSec());
    if (!items.length) { box.hidden = true; return; }
    var txt = items.map(function (i) {
      return "「" + i.title + "」" + (i.kind === "event" ? "日程 " : "待办 ") + bjWhen(i.fire_at) +
        (i.place ? " · " + i.place : "");
    }).join("　");
    box.hidden = false;
    box.textContent = "将记成 " + items.length + " 条：" + txt;
  }

  // 快捷时间只负责「把时间写进句子」，光标留在「提醒我」后面，
  // 用户接着敲标题即可 —— 直接给一条只有时间的句子会记成一条叫「提醒」的待办。
  function fillQuick(text) {
    var el = $("#todo-input");
    el.value = text;
    el.focus();
    try { el.setSelectionRange(text.length, text.length); } catch (e) {}
    todoPreview();
  }

  function addTodo() {
    if (!state) return;
    var input = $("#todo-input");
    var text = input.value.trim();
    if (!text) { input.focus(); return; }

    // 纯规则解析：同一句话永远拆出同样的结果，不需要联网
    var items = splitItems(text, nowSec());
    if (!items || !items.length) { input.focus(); return; }
    var created = items.map(function (it) { return makeReminder(it); });
    state.reminders = state.reminders.concat(created);
    log("记下", created.map(function (r) { return r.title; }).join("、"));
    save();
    render();
    input.value = "";
    $("#todo-preview").hidden = true;

    if (created.length === 1) {
      say(Lines.addedOne(created[0].title) + "（" + bjWhen(created[0].fire_at) + "）", 6000);
    } else {
      say(Lines.addedMany(created.length, created[0].title), 7000);
      petCelebrate();
    }
  }

  function bindTodo() {
    $("#todo-add").addEventListener("click", addTodo);
    $("#todo-input").addEventListener("input", function () {
      clearTimeout(bindTodo._t);
      bindTodo._t = setTimeout(todoPreview, 220);
    });
    $("#todo-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); addTodo(); }
    });
    document.querySelectorAll(".quick-times [data-min]").forEach(function (b) {
      b.addEventListener("click", function () {
        fillQuick(b.dataset.min + " 分钟后提醒我");
      });
    });
    document.querySelectorAll(".quick-times [data-at]").forEach(function (b) {
      b.addEventListener("click", function () {
        fillQuick((b.dataset.at === "tomorrow10" ? "明天上午10点" : "后天上午10点") + "提醒我");
      });
    });
    $("#todo-clip").addEventListener("click", readClipboardToTodo);

    $("#todo-list").addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-act]");
      var host = ev.target.closest(".todo");
      if (!host) return;
      var id = host.dataset.id;
      var r = state.reminders.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      if (btn && btn.dataset.act === "del") {
        state.reminders = state.reminders.filter(function (x) { return x.id !== id; });
        save(); render();
        return;
      }
      if (ev.target.matches('input[type="checkbox"]')) {
        if (ev.target.checked) {
          r.status = 2; r.done_at = nowSec();
          log("完成", r.title);
          say("干完了：" + r.title, 3600);
          petCelebrate();
        } else {
          r.status = 0; r.done_at = 0;
        }
        save(); render();
      }
    });
  }

  function readClipboardToTodo() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast("这个浏览器不给读剪贴板，手动粘一下吧");
      return;
    }
    navigator.clipboard.readText().then(function (t) {
      t = (t || "").trim();
      if (!t) { toast("剪贴板是空的"); return; }
      $("#todo-input").value = t.slice(0, 160);
      todoPreview();
      toast("已读入剪贴板");
    }).catch(function () {
      toast("读剪贴板被拒绝了（需要 HTTPS 或手动授权）");
    });
  }

  /* ---------- 记忆 ---------- */

  /* 日记纯规则生成：几个真实数字，两三句话，不编造。
     没有模型参与，所以同一份数据写出来的日记永远一样——这是特性，不是缺陷。
     stay = true 时留在当前页（记忆页里点「压缩今天」用）。 */
  function writeDiary(stay) {
    var day = bjDate();
    var text = buildDiary(day);
    state.notes.short[day] = { text: text, at: nowSec(), facts: factsText(day) };
    logEvent({ k: "diary", day: day, text: text });
    save(); render();
    if (!stay) tabTo("today");
    say(text.length > 42 ? text.slice(0, 42) + "…" : text, 7000, "压缩");
  }

  /* ---------- 三层压缩 ----------
     日 → 月 → 长期，逐级往上，每一层只读下一层的数据：
       日   读分钟采样（state.days 里的 byCat / blocks）
       月   读本月每天的原始数字，算有效天数、日均、类别占比
       长期 读月度摘要里存下的 days / total / byCat
     所以每句话都能倒推出来源，也不会有「跳过某一层」的糊涂账。 */

  function rollupDay() {
    writeDiary(true);          // true = 留在记忆页，别跳回「今日」
  }

  function rollupMonth() {
    var months = {};
    Object.keys(state.days).forEach(function (d) {
      var key = d.slice(0, 7);
      (months[key] = months[key] || []).push(d);
    });
    var keys = Object.keys(months).sort();
    if (!keys.length) { toast("还没有任何记录，先攒一天"); return; }

    // 优先压本月；本月没数据就退到最近有数据的那个月
    var thisMonth = bjDate().slice(0, 7);
    var target = months[thisMonth] ? thisMonth : keys[keys.length - 1];

    var days = months[target].filter(function (d) { return (state.days[d].activeSec || 0) >= 300; });
    if (!days.length) { toast(target + " 没有够 5 分钟的记录，压不出东西"); return; }

    var total = 0;
    var byCat = {};
    days.forEach(function (d) {
      total += state.days[d].activeSec || 0;
      Object.keys(state.days[d].byCat || {}).forEach(function (k) {
        byCat[k] = (byCat[k] || 0) + state.days[d].byCat[k];
      });
    });

    var top = topCats(byCat, 2).map(function (c) {
      return catLabel(c[0]) + " " + pct(c[1], total) + "%";
    }).join("、");

    var text = target.replace("-", " 年 ") + " 月：有效 " + days.length + " 天，日均在线 " +
      dur(total / days.length) + "，时间主要花在 " + top + "。";

    // days / total / byCat 一起存下来，长期压缩直接用，不用回头重算
    state.notes.mid[target] = {
      text: text, at: nowSec(), days: days.length, total: total, byCat: byCat
    };

    // 这个月已经有摘要了，原始日记就可以删；今天的永远留着
    var today = bjDate();
    Object.keys(state.notes.short).forEach(function (k) {
      if (k !== today && state.notes.mid[k.slice(0, 7)]) delete state.notes.short[k];
    });

    save(); render();
    toast("压好了：" + target);
    say("这个月的账我收起来了。", 4000, "压缩");
  }

  function rollupLong() {
    var months = Object.keys(state.notes.mid).sort().filter(function (k) {
      var r = state.notes.mid[k];
      return r && typeof r.days === "number";
    });
    if (!months.length) {
      toast("长期是从月度摘要里再压一层的，先点「压缩本月」");
      return;
    }

    var days = 0, total = 0, byCat = {};
    months.forEach(function (k) {
      var r = state.notes.mid[k];
      days += r.days || 0;
      total += r.total || 0;
      Object.keys(r.byCat || {}).forEach(function (c) {
        byCat[c] = (byCat[c] || 0) + r.byCat[c];
      });
    });
    if (!days) { toast("月度摘要里没有有效天数"); return; }

    var top = topCats(byCat, 2).map(function (c) {
      return catLabel(c[0]) + " " + pct(c[1], total) + "%";
    }).join("、");

    state.notes.long.latest = {
      text: "记了 " + months.length + " 个月，共 " + days + " 个有效日，日均在线 " +
        dur(total / days) + "，时间主要花在 " + top + "。",
      at: nowSec()
    };

    save(); render();
    toast("长期印象更新了");
    say("我把这些日子收成一句话了。", 4200, "压缩");
  }

  /* ---------- 宠物交互 ---------- */

  /* 点一下 = 摸头。一半概率是「享受被摸」的反应，三成说真心话，两成日常碎嘴。
     每次点击都记一次「最近互动」，冷落计时从这里重新算。 */
  function petSays() {
    lastTouchAt = nowSec();
    boredSaid = false;
    var r = Math.random();
    if (r < 0.5) say(Lines.pat(), 4600, "摸头");
    else if (r < 0.8) say(Lines.warm(), 5200, "撒娇");
    else say(Lines.idle(), 4000, "闲聊");
  }

  function bindPet() {
    var pet = $("#pet");
    pet.addEventListener("mouseenter", function () { if (petState === "idle") setPet("hover"); });
    pet.addEventListener("mouseleave", function () { if (petState === "hover") setPet("idle"); });

    pet.addEventListener("click", function (ev) {
      if (ev.detail > 1) return;
      petSays();
    });
    pet.addEventListener("dblclick", function () {
      tabTo("todo");
      $("#todo-input").focus();
      say("说吧，我记着。");
    });
    pet.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      var menu = $("#ctxmenu");
      menu.hidden = false;
      menu.style.left = Math.min(ev.clientX, window.innerWidth - 190) + "px";
      menu.style.top = Math.min(ev.clientY, window.innerHeight - 240) + "px";
    });
    document.addEventListener("click", function (ev) {
      if (!ev.target.closest("#ctxmenu")) $("#ctxmenu").hidden = true;
    });
    $("#ctxmenu").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-act]");
      if (!b) return;
      var act = b.dataset.act;
      $("#ctxmenu").hidden = true;
      if (act === "say") say("我在。");
      if (act === "todo") { tabTo("todo"); $("#todo-input").focus(); }
      if (act === "pause") togglePause();
      if (act === "settings") tabTo("settings");
      if (act === "hide") {
        $("#stage").style.visibility = "hidden";
        toast("宠物隐藏了 30 分钟");
        setTimeout(function () { $("#stage").style.visibility = "visible"; }, 30 * 60 * 1000);
      }
    });
  }

  /* ---------- 远行冒险 ----------
     点一下把它送出门：总时长 1–3 小时随机，途中每半小时发生一件事，
     全部写进「乐乐的冒险日志」。出门期间不插播日常碎嘴。 */
  function tripActive() {
    return !!(state && state.trip && state.trip.end > nowSec());
  }

  function startTrip() {
    if (!state || tripActive()) return;
    var now = nowSec();
    var dur = Math.round(TRIP_MIN + Math.random() * (TRIP_MAX - TRIP_MIN));
    state.trip = { start: now, end: now + dur, next: now + TRIP_STEP, n: 0 };
    lastTouchAt = now;
    boredSaid = false;
    tripAt = 0;
    nextStoryAt = now + dur + 60 * 60;   // 这趟回来之后，自动的那趟再往后排一小时
    petCelebrate();
    pushStory("出发", Lines.wantOut(), "depart");
    render();
  }

  function tripEvent() {
    var r = Story.tell({ apps: appList() }, []);
    if (r && r.text) pushStory(r.label, r.text, r.kind);
  }

  function endTrip() {
    var r = Story.tell({ apps: appList() }, []);
    state.trip = null;
    if (r && r.text) pushStory("回来", "我回来了。" + r.text, r.kind);
    lastTouchAt = nowSec();
    nextStoryAt = nowSec() + 60 * 60;
    render();
  }

  function togglePause() {
    state.settings.paused = !state.settings.paused;
    if (state.settings.paused) closeBlock();
    save(); renderLive();
    toast(state.settings.paused ? "已暂停计时" : "继续计时");
    say(state.settings.paused ? "那我先不记了。" : "接着记。", 3200);
  }

  /* ---------- 键盘 ---------- */

  function bindKeys() {
    document.addEventListener("keydown", function (ev) {
      var mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.shiftKey && ev.code === "KeyT") { ev.preventDefault(); tabTo("todo"); $("#todo-input").focus(); }
      if (mod && ev.shiftKey && ev.code === "KeyD") { ev.preventDefault(); togglePause(); }
      if (ev.key === "Escape") { $("#ctxmenu").hidden = true; }
    });
  }

  /* ---------- 演示数据 ---------- */

  function seedDemo(blank) {
    var now = nowSec();
    var day = bjDate(now);
    var dayStart = bjDayStart(now);
    var d = ensureDay(day);

    if (!blank) {
      var plan = [["docs", 84], ["coding", 96], ["meeting", 47], ["coding", 74], ["ops", 33], ["docs", 62]];
      var end = Math.floor((now - 240) / 300) * 300;
      var blocks = [];
      for (var i = 0; i < plan.length; i++) {
        var cat = plan[i][0], mins = plan[i][1];
        var start = end - mins * 60;
        if (start < dayStart + 300) break;
        blocks.unshift({ start: start, end: end, cat: cat, secs: mins * 60, app: DEMO_APP[cat] || "" });
        end = start - (8 + Math.floor(Math.random() * 5)) * 60;
      }
      blocks.forEach(function (b) {
        d.blocks.push(b);
        d.activeSec += b.secs;
        d.byCat[b.cat] = (d.byCat[b.cat] || 0) + b.secs;
        // 演示数据也得有「用过哪些软件」，否则冒险日志没有对手可打
        var name = DEMO_APP[b.cat] || "资源管理器";
        var rec = d.byApp[name] || (d.byApp[name] = { secs: 0, cat: b.cat });
        rec.secs += b.secs;
      });

      var tomorrow10 = bjDayStart(now) + DAY + 10 * 3600;
      state.reminders = state.reminders.concat([
        {
          id: uid("r"), title: "给客户回邮件，确认周四的会议材料", fire_at: now - 26 * 3600,
          level: 1, priority: 1, kind: "task", place: "", note: "对方在等回复",
          duration_min: 20, status: 0, created_at: now - 50 * 3600, fired_at: 0, done_at: 0, defers: 0
        },
        {
          id: uid("r"), title: "整理客户名单和报价单", fire_at: now + 3 * 3600,
          level: 0, priority: 2, kind: "task", place: "",
          note: "为「出差去深圳」做准备", duration_min: 30, status: 0,
          created_at: now - 1800, fired_at: 0, done_at: 0, defers: 0
        },
        {
          id: uid("r"), title: "出差去深圳，讲市场风险系统", fire_at: tomorrow10,
          level: 1, priority: 1, kind: "event", place: "深圳",
          note: "见客户，讲市场风险系统", duration_min: 180, status: 0,
          created_at: now - 1800, fired_at: 0, done_at: 0, defers: 0
        },
        {
          id: uid("r"), title: "发周报", fire_at: now - 4 * 3600,
          level: 0, priority: 2, kind: "task", place: "", note: "", duration_min: 15,
          status: 2, created_at: now - 30 * 3600, fired_at: now - 4 * 3600, done_at: now - 3 * 3600, defers: 0
        }
      ]);

      // 昨天的记录：让「记忆分层」和「习惯」有对照
      var yKey = bjDate(now - DAY);
      var y = ensureDay(yKey);
      [[9, 40, 80, "coding"], [10, 55, 70, "docs"], [13, 35, 55, "meeting"], [14, 40, 95, "coding"], [16, 25, 50, "browse"]]
        .forEach(function (p) {
          var s = bjDayStart(now - DAY) + p[0] * 3600 + p[1] * 60;
          var e2 = s + p[2] * 60;
          y.blocks.push({ start: s, end: e2, cat: p[3], secs: p[2] * 60, app: DEMO_APP[p[3]] || "" });
          y.activeSec += p[2] * 60;
          y.byCat[p[3]] = (y.byCat[p[3]] || 0) + p[2] * 60;
        });
      state.notes.short[yKey] = { text: buildDiary(yKey), at: now - DAY, facts: factsText(yKey) };
      state.notes.short[day] = { text: buildDiary(day), at: now, facts: factsText(day) };
    }

    state.demo = !blank;
    state.onboarded = true;
    log("开工", blank ? "从空白开始记录" : "载入了演示数据");
    saveNow();
  }

  /* ---------- 启动 ---------- */

  function boot() {
    // 读文件是异步的（主进程 io），所以整条启动链也跟着异步一档
    load().then(function (s) {
      state = s;
      cacheEls();

      if (!state) {
        $("#welcome").hidden = false;
        $("#welcome-demo").addEventListener("click", function () {
          state = defaults();
          seedDemo(false);
          startApp();
        });
        $("#welcome-blank").addEventListener("click", function () {
          state = defaults();
          seedDemo(true);
          startApp();
        });
        return;
      }
      startApp();
    });
  }

  function startApp() {
    if (!state.onboarded) { state.onboarded = true; save(); }
    $("#welcome").hidden = true;
    $("#app").hidden = false;
    $("#demo-banner").hidden = !state.demo;

    // 左栏那只狗：序列帧播放器，尺寸和图集里的 192×208 等比
    sprite = PetSprite.create($("#pet-sprite"), { width: 132 });

    initTabs();
    initCatSelect();
    applySettingsToUI();
    bindSettings();
    bindTodo();
    bindPet();
    bindKeys();

    $("#q-todo").addEventListener("click", function () { tabTo("todo"); $("#todo-input").focus(); });
    $("#q-data").addEventListener("click", function () {
      if (WM.isDesktop) WM.openData();
      else toast("浏览器版没有数据文件夹，数据在浏览器存储里");
    });
    $("#btn-pause").addEventListener("click", togglePause);
    $("#btn-walk").addEventListener("click", startTrip);

    // 外链交给系统浏览器。应用内点链接不该悄悄弹一个新窗口出来。
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[href^="http"], a[href^="mailto:"]') : null;
      if (!a) return;
      ev.preventDefault();
      WM.openUrl(a.getAttribute("href"));
    });

    // 轮询页：点历史里的一行，上面的明细换成那一拍
    var hist = document.getElementById("poll-hist");
    if (hist) {
      hist.addEventListener("click", function (ev) {
        var b = ev.target.closest(".hist-item");
        if (!b) return;
        pollPick = Number(b.dataset.i) || 0;
        renderPoll();
      });
    }
    $("#btn-write-diary").addEventListener("click", function () { writeDiary(); });
    $("#btn-goto-memory").addEventListener("click", function () { tabTo("memory"); });
    $("#btn-rollup-day").addEventListener("click", rollupDay);
    $("#btn-rollup-month").addEventListener("click", rollupMonth);
    $("#btn-rollup-long").addEventListener("click", rollupLong);
    $("#banner-clear").addEventListener("click", function () {
      if (!confirm("清空演示数据，开始记录你自己的？")) return;
      // 不要直接删文件再刷新：那样会退回首屏引导，等于强制用户再选一次。
      // 这里重置成一份「已引导过的空白数据」，刷完直接进工作台。
      state = defaults();
      state.onboarded = true;
      state.demo = false;
      saveNow();
      location.reload();
    });

    render();

    // 采样由主进程推过来：每分钟一拍。窗口最小化、主窗口藏起来都照推，
    // 因为计时不在页面里跑。
    WM.onSample(function (s) { tickSense(s); });
    if (WM.isDesktop) WM.ready();     // 立刻补一拍，别让首屏空一分钟

    // 桌面那只狗被单击：台词统一在这里生成，再发回去显示
    if (WM.isDesktop && window.workmate.onPetClick) {
      window.workmate.onPetClick(petSays);
    }

    // 提醒 1 秒轮询，跨天检查每分钟一次
    setInterval(tickRemind, 1000);
    setInterval(function () { maybeDigest(); }, 60 * 1000);

    // 页面要关掉时兜一次落盘，别丢了最后几秒
    window.addEventListener("beforeunload", saveNow);

    // 你切回主面板时它会迎一句。十分钟以内反复点窗口不打扰。
    var lastFocusAt = nowSec();
    window.addEventListener("focus", function () {
      var gap = nowSec() - lastFocusAt;
      lastFocusAt = nowSec();
      lastTouchAt = nowSec();
      if (gap > 10 * 60) say(Lines.back(Math.round(gap / 60)), 5000, "迎接");
    });

    // 首屏问候：告诉用户「我在」，但别啰嗦
    setTimeout(function () {
      say(Lines.greet(bjHour(nowSec())), 5200, "问候");
    }, 700);

    document.addEventListener("visibilitychange", function () {
      renderLive();
      if (document.visibilityState === "visible") render();
    });
  }

  // 外部可读的状态快照：方便截图脚本/评审工具断言
  window.WorkMate = {
    get state() { return state; },
    version: "desktop-1.0",
    parse: parseWhen,
    split: splitItems,
    buildDiary: buildDiary,
    sample: function () { return sample; },
    story: function () { tellStory(); },
    add: function (text) { $("#todo-input").value = text; addTodo(); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
