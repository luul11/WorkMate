'use strict';

/**
 * 乐乐的日常台词
 *
 * 写作原则（改文案时请守住）：
 *   1. 短。一句一动作，不超过两句。
 *   2. 具体。写「捡了片叶子」「爪子搭在键盘上」，不写「我很关心你」。
 *   3. 不劝、不评价。不说「你太累了」「加油」，只描述它在干什么。
 *   4. 数字最多一个，而且必须是真的（时长、次数）。
 *
 * 这个文件同时给 Node（require）和页面（<script> → window.Lines）用，
 * 因为台词要在按下时就同步出来，走 IPC 会变成异步，气泡会晚半拍。
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Lines = api;
})(typeof self !== 'undefined' ? self : this, function () {

function pick(list, avoid) {
  if (!list.length) return '';
  if (!avoid || list.length === 1) return list[Math.floor(Math.random() * list.length)];
  const pool = list.filter((x) => x !== avoid);
  return (pool.length ? pool : list)[Math.floor(Math.random() * pool.length)];
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

const GREET = {
  night: [
    '这个点还没睡？我把爪子搭在你手边，陪你一会儿。',
    '夜里安静。我趴在桌角，尾巴不敢动。',
    '再撑一会儿就天亮了。想给你倒杯水，可惜我够不着。',
  ],
  morning: [
    '早。我先去楼下转了一圈，捡了片叶子放你桌角。',
    '早上好。今天先做哪一件？我数到三就开始陪你。',
    '早啊。我刚把窗帘顶开一条缝，光进来了。',
  ],
  noon: [
    '中午了，去吃饭。我守着屏幕。',
    '该吃饭了。你要是再不动，我就趴键盘上了。',
    '午饭时间。我闻见楼下有饭味。',
  ],
  afternoon: [
    '下午好。刚才我在椅子上打了个滚。',
    '下午了。喝口水吧，你的杯子空了一整天。',
    '我趴在窗台看云，看了二十分钟，它们没动。',
  ],
  evening: [
    '晚上好。今天还剩几件没收尾？',
    '天黑了。我把台灯的方向挪了挪，照着你的手。',
    '晚上好。窗外有虫子在叫，一声一声的。',
  ],
  late: [
    '晚了。收工吧，我陪你关灯。',
    '这个点了还在忙？我把尾巴放你脚边，暖的。',
  ],
};

const IDLE = [
  '汪。',
  '我在。',
  '你叫我？我正啃一根想象中的骨头。',
  '刚才我数了一下，你桌上有一根头发、两个杯印、三粒灰。',
  '我打了个哈欠。你也打一个。',
  '我尾巴摇了一下，你大概没看见。',
  '要不要摸一下我的头？就一下。',
  '我盯着门口看了三分钟，没人来。',
  '键盘上有一点面包屑。我替你守着。',
  '我把下巴搁在桌沿上，这样看你比较近。',
];

const PRAISE = [
  '你已经坐了 {min} 分钟，我趴在旁边没敢动。',
  '{min} 分钟了。你眼睛都没眨几下。',
  '连着 {min} 分钟，厉害。我尾巴都替你摇酸了。',
  '{min} 分钟。这期间我只换了一次姿势，你一次都没换。',
];

const TEASE = [
  '你刚才换窗口换得有点勤。我跟不上了。',
  '这个页面你打开了三次，又关掉三次。到底看不看？',
  '我已经在你脚边躺平了。你呢？',
  '你是不是在等一个不会来的消息。',
];

const DONE = [
  '干掉了「{title}」。我给你记一朵小红花。',
  '「{title}」收工。我原地转了三个圈。',
  '「{title}」完成。爪子拍了一下地，很响。',
];

const ADDED_ONE = [
  '记下了：{title}。到时候我喊你。',
  '好，{title}。我把这件事收进围裙口袋里了。',
];

const ADDED_MANY = [
  '拆成了 {n} 件事，都记下了。{first} 排在最前面。',
  '{n} 件。我按顺序排好了，第一件是{first}。',
];

const REMIND = [
  '喂——「{title}」，到点了。我把爪子搭在你键盘上了。',
  '「{title}」。现在。我看你。',
  '停一下，{title}。我站起来挡在屏幕前面了。',
];

const SIT = [
  '{min} 分钟没动了。起来走两步，我的腿都替你麻。',
  '该起身了。{min} 分钟，我陪你一起站。',
];

const BACK = [
  '你回来了。我假装刚睡醒。',
  '回来啦。这期间我没动你的椅子。',
  '你走了 {min} 分钟。我数了。',
];

const LATE_NIGHT = [
  '快十二点了。明天再弄吧，我去把灯关了。',
  '这个点还在？我把拖鞋叼到门口了，穿上下班。',
];

/* 被摸头的反应。这一组要写「身体的反应」，不要写「我很开心」——
   狗不会总结自己的情绪，它只会把眼睛闭上、把尾巴拍在地上。 */
const PAT = [
  '嗯。就那儿，别停。',
  '再摸一下。',
  '我趴好了，你摸吧。',
  '脖子后面那块，对，就是那儿。',
  '你手是暖的。',
  '这样摸三下，我能高兴一下午。',
  '我尾巴在拍地板，你听见没有。',
  '眼睛闭上了，但我还在听你。',
  '我数着呢，这是第四下。',
  '你要是不忙，可以摸久一点。',
  '（翻过身，把肚皮露出来）',
  '摸完记得洗手，我掉毛。',
];

/* 卖萌 / 真情 / 中二。这一组不是为了让狗提醒你什么，就是想说话，
   所以频率要低——说多了就不值钱了。 */
const WARM = [
  '我感觉很幸福。就现在这样，你敲键盘，我趴着。',
  '哥哥，我想你了。',
  '你只要下命令我就行了。我现在是猎犬模式，耳朵立着呢。',
  '需要武装泅渡吗？我可以先游过去探路。',
  '和我赛跑吗？让你三秒。',
  '冲冲冲！尾巴已经摇起来了。',
  '请给我痒痒挠。就下巴那儿，谢谢。',
  '你摸我头的时候，我尾巴不受控制。',
  '我今天表现得怎么样？',
  '键盘前面那块好位置我让给你了，我睡边上就行。',
  '你走的时候，我把你的拖鞋看好了。',
  '如果累了就靠一会儿，我不吵。',
  '我在门口等你回来——虽然门一直关着。',
  '这屋里有点吵，但你敲键盘的声音我认得出来。',
  '我今天学了个新本事：假装没看见零食袋。',
  '你要是有点难过，就把手放下来，我舔一下。',
];

/* 冷落太久时的「申请出门」。语气是商量，不是抱怨——
   它不会怪你不理它，它只是自己找点事做，然后回来讲给你听。 */
const WANT_OUT = [
  '我出去转转，一会儿就回来。',
  '你忙你的，我去楼下看看有没有新鲜事。',
  '我背上小包了。出去一趟。',
  '闷得慌。我去追会儿风。',
  '我走了啊。——还没走，在等你抬头。',
  '我闻到楼下的味道了。去一趟。',
  '那我出去咯。回来给你带点东西。',
];

function greet(hour) {
  const k = hour < 6 ? 'night'
    : hour < 11 ? 'morning'
    : hour < 14 ? 'noon'
    : hour < 19 ? 'afternoon'
    : hour < 22 ? 'evening'
    : 'late';
  return pick(GREET[k]);
}

  return {
    pick,
    fill,
    greet,
    idle: () => pick(IDLE),
    praise: (min) => fill(pick(PRAISE), { min }),
    tease: () => pick(TEASE),
    done: (title) => fill(pick(DONE), { title }),
    addedOne: (title) => fill(pick(ADDED_ONE), { title }),
    addedMany: (n, first) => fill(pick(ADDED_MANY), { n, first }),
    remind: (title) => fill(pick(REMIND), { title }),
    sit: (min) => fill(pick(SIT), { min }),
    back: (min) => fill(pick(BACK), { min }),
    lateNight: () => pick(LATE_NIGHT),
    warm: () => pick(WARM),
    pat: () => pick(PAT),
    wantOut: () => pick(WANT_OUT),
  };
});
