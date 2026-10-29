'use strict';

/**
 * 乐乐的冒险日志
 *
 * 核心是「遭遇系统」：在楼下碰见一只狗，先掷一次友好与否，友好就交朋友，
 * 不友好才打起来；打起来再按体型掷一次胜负。
 *
 * 两条硬规则（写在 selfCheck 里，数字改错了跑一下就能发现）：
 *   1. 乐乐高大威猛，对非巨型犬的胜率都在 70% 以上；
 *      碰上藏獒、阿拉斯加这种巨型犬，胜率低于 50%。
 *   2. 乐乐对小型犬明显更友善，对中大型犬动手的概率更高。
 *
 * 输入 ctx：{ apps: [{name, secs, cat}] }
 * 输出：{ kind, label, text }，label 固定两个汉字，给「狗子动态」当标签。
 *
 * 和 lines.js 一样双模式：Node 里 require，页面里 <script> → window.Story。
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Story = api;
})(typeof self !== 'undefined' ? self : this, function () {

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function pickWeighted(list, key) {
    const total = list.reduce((s, x) => s + (x[key] || 1), 0);
    let r = Math.random() * total;
    for (const x of list) {
      r -= (x[key] || 1);
      if (r <= 0) return x;
    }
    return list[list.length - 1];
  }

  /* ---------------- 体型与胜负概率 ----------------
     这是这一版最要紧的四个数，每行加起来必须等于 1。
     小 / 中 / 大型的胜率都在 70% 以上，巨型低于 50%。 */
  const TIERS = {
    small:  { label: '小型犬', win: 0.90, draw: 0.06, flee: 0.01, lose: 0.03 },
    medium: { label: '中型犬', win: 0.78, draw: 0.10, flee: 0.04, lose: 0.08 },
    large:  { label: '大型犬', win: 0.71, draw: 0.11, flee: 0.06, lose: 0.12 },
    giant:  { label: '巨型犬', win: 0.42, draw: 0.18, flee: 0.15, lose: 0.25 },
  };

  /* ---------------- 狗的口袋名单 ----------------
     friend：碰见之后成为朋友的概率（乐乐对小的明显更友好）
     w：遇见权重，越常见的越大
     tag：它的样子或脾气，用在交友那段
     move：动手时它先出什么招 */
  const DOGS = [
    // ---------- 小型 ----------
    { name: '柯基', tier: 'small', friend: 0.88, w: 8, tag: '腿短，跑起来屁股一颠一颠的', move: '用屁股撞我' },
    { name: '柴犬', tier: 'small', friend: 0.80, w: 7, tag: '表情很自信，像在笑我', move: '侧身撞过来' },
    { name: '泰迪', tier: 'small', friend: 0.92, w: 8, tag: '叫得比谁都凶，个头只有我一半', move: '跳起来咬我耳朵' },
    { name: '比熊', tier: 'small', friend: 0.90, w: 6, tag: '白得像团棉花，一跑就滚', move: '绕着我打转' },
    { name: '腊肠', tier: 'small', friend: 0.85, w: 5, tag: '长得像根香肠，跑得倒挺快', move: '从底下钻过来' },
    { name: '法斗', tier: 'small', friend: 0.70, w: 6, tag: '呼哧呼哧的，脾气倒不小', move: '用肩膀顶我' },

    // ---------- 中型 ----------
    { name: '边牧', tier: 'medium', friend: 0.55, w: 8, tag: '眼神太聪明，一直盯着我看', move: '绕着我跑圈，想把我赶到墙角' },
    { name: '金毛', tier: 'medium', friend: 0.85, w: 9, tag: '一见面就把球推到我面前', move: '扑上来抱住我' },
    { name: '拉布拉多', tier: 'medium', friend: 0.88, w: 8, tag: '跟我一个品种，像在照镜子', move: '用脑袋顶我' },
    { name: '萨摩耶', tier: 'medium', friend: 0.75, w: 7, tag: '一直在笑，毛比我还白', move: '用身体撞我' },
    { name: '哈士奇', tier: 'medium', friend: 0.65, w: 8, tag: '冲我叫了两声，自己先被吓一跳', move: '绕着我狂奔，把我绕晕' },
    { name: '斗牛', tier: 'medium', friend: 0.45, w: 5, tag: '低着头，肩膀比我还宽', move: '整个身子压过来' },

    // ---------- 大型 ----------
    { name: '德牧', tier: 'large', friend: 0.35, w: 7, tag: '站着不动，看我的眼神像在评估', move: '低吼一声冲过来' },
    { name: '杜宾', tier: 'large', friend: 0.30, w: 5, tag: '耳朵立着，一步没退', move: '蹿得极快，一口咬住我脖子上的毛' },
    { name: '罗威纳', tier: 'large', friend: 0.28, w: 4, tag: '胸口宽得像堵墙', move: '一头撞在我胸口' },

    // ---------- 巨型 ----------
    { name: '阿拉斯加', tier: 'giant', friend: 0.30, w: 6, tag: '比我高半个头，毛厚得像穿了棉被', move: '一爪子拍下来' },
    { name: '藏獒', tier: 'giant', friend: 0.15, w: 3, tag: '趴在那儿，像一座小土堆', move: '猛地站起来，把影子压在我身上' },
    { name: '大白熊', tier: 'giant', friend: 0.35, w: 3, tag: '白得发光，走过来像朵云', move: '用整个身体压过来' },
  ];

  const PLACES = ['下楼拐角', '楼道里', '天台上', '公园的草地', '快递柜旁边', '便利店门口', '小区的花坛边'];

  /* ---------------- 动手 ----------------
     每种结局按体型给两句。语气跟着块头走：
     对小的「让着」，被巨型打倒也不丢人。 */
  const FIGHT = {
    small: {
      win: ['三回合，我把它轻轻按住了。', '我赢了，但它一点都不服气，还在叫。'],
      draw: ['没分出胜负，它主人先把它抱走了。', '打了两下就变成互相闻鼻子，算平。'],
      flee: ['我退了两步，它趁机扑上来，我干脆绕开了。', '犯不上。我转身走了。'],
      lose: ['它咬了我一口耳朵。个头小，可它真敢。', '我被它绊了一下，摔得挺难看。'],
    },
    medium: {
      win: ['打了几个回合，我占了上风，它先低了头。', '我把它压在地上，等它不挣扎了才松开。'],
      draw: ['打了个平手，我们一起趴在树荫下喘气。', '谁也没赢，最后一起去喝水了。'],
      flee: ['它比我想的能打。我跑了两步又回头叫了一声，算没输。', '我撤了。这种架打下去没意思。'],
      lose: ['我输了。它把我掀翻在地，我躺了好一会儿。', '被它按住脖子，我只能认。'],
    },
    large: {
      win: ['我们撞在一起，最后是它先退开的。', '我赢了，但爪子还在抖——它也真不好对付。'],
      draw: ['打到一半都没力气了，各自退开三步。', '平手。我们互相看了一眼，谁也没再上。'],
      flee: ['我掉头跑了。它追了半条街才停下。', '我承认，那一下我怂了。'],
      lose: ['我输了。被按在地上，动不了。', '它一口咬住我后颈，我整个身子都软了。'],
    },
    giant: {
      win: ['我赢了。赢得很勉强——它脚下滑了一下，我趁机压了上去。', '这算我运气好，下次不一定。'],
      draw: ['打了个平手，我们俩喘得像风箱。', '谁也没讨到好，各自退开，隔着三步对看。'],
      flee: ['我掉头就跑。这种块头，跑了不丢人。', '我没打。它一站起来，我就知道该走了。'],
      lose: ['我输了。被一巴掌拍翻，躺了半分钟才起来。', '我完全不是对手。它甚至没认真。'],
    },
  };

  // 我这边出的招，跟着结局走
  const MY_MOVE = {
    win: ['咬住它的前腿不放', '侧身把它挤到墙边', '压住它的肩膀'],
    draw: ['顶了回去', '跟它滚成一团'],
    flee: ['没接这一下', '让开半步，转身就走'],
    lose: ['顶上去，被它弹了回来', '硬扛了一下，脚下没站住'],
  };

  const FRIEND_END = [
    '我趴下来，它也趴下来，我们对着看了会儿。',
    '我把球推给它，它叼走了，又叼回来。',
    '我们互相闻了闻，算是认识了。',
    '它绕着我转了一圈，尾巴摇得比我快。',
    '我让它先喝了水。它记住了。',
  ];

  function rollOutcome(tier) {
    const t = TIERS[tier];
    const r = Math.random();
    if (r < t.win) return 'win';
    if (r < t.win + t.draw) return 'draw';
    if (r < t.win + t.draw + t.flee) return 'flee';
    return 'lose';
  }

  function meetDog() {
    const dog = pickWeighted(DOGS, 'w');
    const place = pick(PLACES);

    if (Math.random() < dog.friend) {
      return {
        kind: 'friend',
        label: '交友',
        text: `在${place}碰见一只${dog.name}。${dog.tag}。${pick(FRIEND_END)}`,
      };
    }

    const res = rollOutcome(dog.tier);
    return {
      kind: 'fight',
      label: '遇敌',
      text: `和一只${dog.name}撞上了。它${dog.move}，我${pick(MY_MOVE[res])}。${pick(FIGHT[dog.tier][res])}`,
    };
  }

  /* ---------------- 其他玩法 ---------------- */

  const APP_MOVE = {
    docs: ['拿表格把我困住', '甩出三段自动编号', '在我名字上加了条批注', '让我填一个必填项'],
    browse: ['一口气开了二十个标签页', '弹出三个广告', '把我的名字搜了一遍', '让我一直转圈加载'],
    coding: ['甩了一屏报错', '说少了个分号', '把缩进全改成空格', '让我找一对不匹配的括号'],
    ops: ['甩出一屏日志', '把路径里的空格吃了', '让我在三个终端之间跳'],
    meeting: ['把我的麦静音了', '共享屏幕给我看流程图', '让我等了三分钟才进会'],
    rest: ['把我按在原地不让动', '让我睡过去又醒过来'],
    self: ['让我看自己的账本', '把我的时间记了一笔'],
    other: ['原地转了一圈', '放出一团迷雾', '假装自己很忙'],
  };

  const APP_END = [
    '三回合，握手言和。',
    '它先动的手，我赢了。',
    '我赢了，它把工具栏让给我一半。',
    '打平，我们一起去喝水了。',
    '我输了，它倒是挺客气。',
  ];

  function appBattle(apps) {
    const pool = apps.slice(0, 3);
    const target = pick(pool.map((a) => a.name));
    const info = pool.find((a) => a.name === target) || pool[0];
    const moves = APP_MOVE[info.cat] || APP_MOVE.other;
    const min = Math.max(1, Math.round(info.secs / 60));
    const mine = pick(MY_MOVE.win);

    return pick([
      `今天我跟 ${target} 打了一架。它${pick(moves)}，我${mine}。${pick(APP_END)}`,
      `${target} 追了我 ${min} 分钟。它${pick(moves)}，我叼着它的标题栏跑。${pick(APP_END)}`,
      `我和 ${target} 打了三个回合。第一回合它${pick(moves)}，第二回合我${mine}。${pick(APP_END)}`,
    ]);
  }

  /* ---------------- 桌游 ----------------
     玩家全是狗。乐乐有时候很狡猾，有时候犯憨，有时候被别的狗冤枉出局——
     三种都要有，比例大致是「狡猾 : 犯憨 : 被投 = 55 : 22 : 23」。
     写的都是能对上真实打法的事：悍跳、倒钩、警徽流、装糊涂保梅林，
     而不是「它玩了个游戏，赢了」。 */
  const BOARD = [
    // ---------- 阿瓦隆 ----------
    { game: '阿瓦隆', kind: 'clever', text: '我抽到梅林。前两轮我一直装糊涂，把怀疑往一只哈士奇身上带，坏人真去刀了它。我活到了最后，散场时才发现尾巴一直在抖。' },
    { game: '阿瓦隆', kind: 'clever', text: '我抽到刺客。最后关头我看了一圈，指了那只一直不怎么说话的柴犬——它果然是梅林。这局我赢得最安静。' },
    { game: '阿瓦隆', kind: 'clever', text: '我抽到莫甘娜。我抢先跳梅林，把真梅林逼得不敢出声，好人自己内讧了两轮。坏人赢得轻松，我装得很辛苦。' },
    { game: '阿瓦隆', kind: 'clever', text: '我抽到派西维尔。我看出来两只狗都在装梅林，索性谁都不跟，只按自己的判断投。最后投对了，没人知道我是怎么想的。' },
    { game: '阿瓦隆', kind: 'clever', text: '我抽到湖中仙女。徽章我给了那只最不起眼的腊肠——短腿、声音小、从头到尾没争过。它才是梅林。' },
    { game: '阿瓦隆', kind: 'clumsy', text: '我是坏人。我说漏了嘴，把只有坏人知道的那条信息讲了出来。全场安静了三秒，然后四只狗一起看我。' },
    { game: '阿瓦隆', kind: 'clumsy', text: '我抽到忠臣。讨论时我太着急，把梅林指了出来，还讲得理直气壮。那局输得很快，我还不知道错在哪。' },
    { game: '阿瓦隆', kind: 'clumsy', text: '我把票投给了队友，还认真地讲了理由。散场后我才反应过来，趴在地上不肯起来。' },
    { game: '阿瓦隆', kind: 'voted', text: '我抽到莫德雷德。我一句话没说，结果被当成「太安静，肯定有问题」，四票送我出去。' },
    { game: '阿瓦隆', kind: 'voted', text: '我明明是忠臣，那两只狗一口咬定我是坏人。我越解释，它们越确定。最后我被投了出去。' },

    // ---------- 狼人杀 ----------
    { game: '狼人杀', kind: 'clever', text: '我悍跳预言家，给一只金毛发金水。它感动得当场站我这边，真预言家被我们推了出去。它到死都以为我是好人。' },
    { game: '狼人杀', kind: 'clever', text: '我是倒钩狼。前三轮我一直帮好人分析，把自己两个队友投死了。最后一天，我活到了终局。' },
    { game: '狼人杀', kind: 'clever', text: '我抽到女巫。第一夜我没救人，把毒药留到第三天，一口毒死那只装好人的狼王。全场愣住。' },
    { game: '狼人杀', kind: 'clever', text: '我拿狼王，被推出局的时候带走了预言家。天平一下就倒过来了，剩下的狗开始互相怀疑。' },
    { game: '狼人杀', kind: 'clever', text: '我抽到猎人。被投出去的时候我开了枪，带走一只狼。我死得不亏。' },
    { game: '狼人杀', kind: 'clever', text: '我上警的时候把警徽流讲得很清楚，四只狗把票投给了我。拿到警徽，等于多了半张嘴。' },
    { game: '狼人杀', kind: 'clumsy', text: '我悍跳预言家，把验人结果报串了。一只柯基当场问我：「你昨天不是说他好人吗？」我卡住了。' },
    { game: '狼人杀', kind: 'clumsy', text: '我是守卫。我连守自己三个晚上，还到处说「我肯定安全」。第四天我被刀了，谁也没拦住。' },
    { game: '狼人杀', kind: 'clumsy', text: '我是白痴，被投出去还能翻牌活下来。我兴高采烈地翻牌，结果把视角全暴露了。' },
    { game: '狼人杀', kind: 'voted', text: '我是预言家。我验出来的狼没人信，我自己被首轮票了出去。起身的时候我看了它们一眼。' },
    { game: '狼人杀', kind: 'voted', text: '我说话太急，被当成狼。我解释得越多，它们越觉得我在编。第二轮我就出局了。' },
  ];

  function boardGame() {
    const byKind = { clever: [], clumsy: [], voted: [] };
    for (const b of BOARD) byKind[b.kind].push(b);

    const roll = Math.random();
    const kind = roll < 0.55 ? 'clever' : roll < 0.77 ? 'clumsy' : 'voted';
    const pool = byKind[kind] && byKind[kind].length ? byKind[kind] : BOARD;
    return { kind: 'board', label: '桌游', text: pick(pool).text };
  }

  function explore() {
    return `我出门转了一圈。在${pick(PLACES)}${pick([
      '遇见一只橘猫，它假装不认识我',
      '看见一片会转的落叶，追了半层楼',
      '被一个小孩摸了两下头',
      '隔着玻璃看人吃关东煮',
      '和一只麻雀对峙很久，它先飞的',
    ])}。${pick([
      '叼回来一根树枝，放你桌角了。',
      '带回来一身土，还有股风的味道。',
      '捡到一颗玻璃珠，蓝的。',
      '什么都没带回来，就蹭了你一裤腿。',
    ])}`;
  }

  /**
   * 生成一段冒险。
   * @param {{apps: Array<{name:string,secs:number,cat:string}>}} ctx
   * @param {string[]} recent 最近发生过的事件类型，避免连着两次同一个
   * @returns {{kind:string,label:string,text:string}}
   */
  function tell(ctx, recent) {
    const apps = (ctx && ctx.apps) || [];
    const kinds = [
      { kind: 'dog', weight: 46, make: meetDog },          // 碰见别的狗：交友或动手
      { kind: 'appbattle', weight: apps.length ? 22 : 0, make: () => ({ kind: 'appbattle', label: '对战', text: appBattle(apps) }) },
      { kind: 'board', weight: 16, make: boardGame },
      { kind: 'explore', weight: 18, make: () => ({ kind: 'explore', label: '出门', text: explore() }) },
    ].filter((k) => k.weight > 0);

    // 交友/遇敌都属于「碰见狗」，排重时归成一类，否则会连着两次「又碰见一只狗」
    const norm = (k) => (k === 'friend' || k === 'fight') ? 'dog' : k;
    const recentKinds = (recent || []).slice(-2).map(norm);
    const usable = kinds.filter((k) => !recentKinds.includes(k.kind));
    const pool = usable.length ? usable : kinds;

    const total = pool.reduce((s, k) => s + k.weight, 0);
    let roll = Math.random() * total;
    let chosen = pool[pool.length - 1];
    for (const k of pool) {
      roll -= k.weight;
      if (roll <= 0) { chosen = k; break; }
    }

    const r = chosen.make();
    return { kind: r.kind, label: r.label, text: r.text };
  }

  /**
   * 自检：概率表有没有写错。
   * 这几条是需求里写死的，改动时跑一下就能发现手滑。
   */
  function selfCheck() {
    const errs = [];
    const stat = {};

    for (const d of DOGS) {
      const t = TIERS[d.tier];
      if (!t) { errs.push(d.name + '：体型 ' + d.tier + ' 没有概率表'); continue; }

      const sum = t.win + t.draw + t.flee + t.lose;
      if (Math.abs(sum - 1) > 1e-9) errs.push(d.name + '：四种结局加起来是 ' + sum.toFixed(3) + '，应该是 1');

      if (d.tier === 'giant') {
        if (t.win >= 0.5) errs.push(d.name + ' 是巨型犬，胜率应低于 50%，现在是 ' + Math.round(t.win * 100) + '%');
      } else if (t.win < 0.7) {
        errs.push(d.name + ' 不是巨型犬，胜率应高于 70%，现在是 ' + Math.round(t.win * 100) + '%');
      }

      if (!(d.friend >= 0 && d.friend <= 1)) errs.push(d.name + '：友好概率不合法');

      const b = stat[d.tier] || (stat[d.tier] = { friend: 0, n: 0 });
      b.friend += d.friend;
      b.n += 1;
    }

    const avg = (k) => (stat[k] ? stat[k].friend / stat[k].n : null);
    if (avg('small') === null || avg('medium') === null) errs.push('体型样本不全');
    else if (avg('small') <= avg('medium')) errs.push('小型犬的友好均值应高于中型犬');
    else if (avg('medium') <= avg('large')) errs.push('中型犬的友好均值应高于大型犬');

    // 桌游：两套游戏都要有，三种走向（狡猾 / 犯憨 / 被投）都别太少
    const kinds = {};
    const games = {};
    for (const b of BOARD) {
      kinds[b.kind] = (kinds[b.kind] || 0) + 1;
      games[b.game] = (games[b.game] || 0) + 1;
    }
    for (const k of ['clever', 'clumsy', 'voted']) {
      if ((kinds[k] || 0) < 3) errs.push('桌游里「' + k + '」只有 ' + (kinds[k] || 0) + ' 条，至少要有 3 条');
    }
    for (const g of ['阿瓦隆', '狼人杀']) {
      if (!games[g]) errs.push('桌游里缺了「' + g + '」');
    }

    return errs;
  }

  return { tell, selfCheck, DOGS, TIERS, BOARD };
});
