/**
 * 好搭子 · 渲染层
 *  - 鲸鱼娘精灵（双缓冲 video 交叉淡入）
 *  - 悬停信息卡：倒计时 / 周五 / 发薪 / 今天赚了多少
 *  - 互动（移植自 dsh-pet）：弹簧跟手拖拽、甩抛飞行、撞墙反弹、落地 Q 弹、
 *    点击回应、点击积分、碎碎念、表情包、随机动作链、左右朝向、右键菜单
 */
'use strict';

const api = window.whale;
const C = window.WhaleCalc;
const A = window.PetAnim;
const L = window.PetLines;
const P = window.PetPhysics;

const card = document.getElementById('card');
const cardLabel = document.getElementById('cardLabel');
const cardTime = document.getElementById('cardTime');
const fridayVal = document.getElementById('fridayVal');
const paydayVal = document.getElementById('paydayVal');
const earnedVal = document.getElementById('earnedVal');
const cardTag = document.getElementById('cardTag');
const stage = document.getElementById('stage');
const vidA = document.getElementById('vidA');
const vidB = document.getElementById('vidB');
const bubble = document.getElementById('bubble');
const bubbleTime = document.getElementById('bubbleTime');
const bubbleBody = document.getElementById('bubbleBody');
const say = document.getElementById('say');
const sayText = document.getElementById('sayText');
const sayImg = document.getElementById('sayImg');
const scoreEl = document.getElementById('score');
const fx = document.getElementById('fx');
const menu = document.getElementById('menu');

let config = null;
let hover = false;
let dragging = false;
let dragged = false;
let grabDX = 0;
let grabDY = 0;
let dragSamples = [];
let currentAnim = '';
let stateKey = '';
let animTimer = null;
let sayTimer = null;
let scoreTimer = null;
let whisperTimer = null;
let front = 0;
let swapToken = 0;

/* ------------------------------------------------------------ 宠物状态 */

const pet = {
  x: 0, // 窗口内左上角
  y: 0,
  vx: 0,
  vy: 0,
  w: 420,
  h: 236,
  facing: 1,
  mode: 'idle', // idle | drag | fly | walk
  squash: 1,
  squashT: 0,
  squashFrom: null,
  step: 0,
  homeX: 0,
  homeY: 0,
  walkTarget: null,
};

let stageW = 900;
let stageH = 680;
// 宠物的真实位置用「屏幕坐标」算，窗口跟着她跑；
// 窗口内的落点是固定的（spot），主进程据此摆放窗口。
let spotX = 0;
let spotY = 0;
let workArea = { x: 0, y: 0, width: 1920, height: 1040 };

function floorY() {
  // 地面 = 屏幕工作区底部（她的脚踩在这条线上）
  return workArea.y + workArea.height - 8;
}

function bounds() {
  // 角色在 640×360 的画面里只占中间一小块，边界按她的可见区算
  return {
    width: workArea.width,
    height: workArea.height,
    floorY: floorY(),
    left: workArea.x,
    top: workArea.y,
    visL: window.WhaleCalc ? window.WhaleCalc.LAYOUT.visL : 0.33,
    visR: window.WhaleCalc ? window.WhaleCalc.LAYOUT.visR : 0.67,
  };
}

/* ------------------------------------------------------------ 布局 */

function applyLayout(l) {
  if (!l) return;
  const s = document.documentElement.style;
  s.setProperty('--pad', l.pad + 'px');
  s.setProperty('--card-w', l.cardW + 'px');
  s.setProperty('--card-h', l.cardH + 'px');
  s.setProperty('--whale-w', l.whaleW + 'px');
  s.setProperty('--whale-h', l.whaleH + 'px');
  stageW = l.windowW;
  stageH = l.windowH;
  pet.w = l.whaleW;
  pet.h = l.whaleH;
  if (l.spot) {
    spotX = l.spot.x;
    spotY = l.spot.y;
  }
  if (l.workArea) workArea = l.workArea;
  if (!pet.homeX) {
    // 初始位置：主进程给的窗口位置 + 固定落点（屏幕坐标）
    const hx = l.home && typeof l.home.x === 'number' ? l.home.x : workArea.x + workArea.width - 480;
    const hy = l.home && typeof l.home.y === 'number' ? l.home.y : workArea.y + workArea.height - 300;
    pet.homeX = Math.round(hx + spotX);
    pet.homeY = Math.round(floorY() - pet.h);
    pet.x = pet.homeX;
    pet.y = pet.homeY;
    if (typeof hy === 'number') {
      pet.homeY = Math.min(pet.homeY, Math.round(hy + spotY));
    }
  }
  placePet();
}

/** 宠物位置 → DOM（宠物在窗口里位置固定，窗口本身跟着她跑） */
function placePet() {
  stage.style.left = spotX + 'px';
  stage.style.top = spotY + 'px';
  stage.style.width = pet.w + 'px';
  stage.style.height = pet.h + 'px';
  // 信息卡浮在头顶
  const cw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 344;
  const ch = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-h')) || 214;
  let cx = Math.round(spotX + pet.w / 2 - cw / 2);
  cx = Math.max(8, Math.min(stageW - cw - 8, cx));
  let cy = Math.round(spotY - ch - 14);
  cy = Math.max(8, Math.min(stageH - ch - 8, cy));
  card.style.left = cx + 'px';
  card.style.top = cy + 'px';
  cardTag.style.left = cx + 18 + 'px';
  cardTag.style.top = cy + ch - 12 + 'px';
  // 互动气泡也跟着宠物
  say.style.left = Math.max(8, Math.min(stageW - 240, cx + cw - 230)) + 'px';
  say.style.top = Math.max(8, cy - 62) + 'px';
}

/* ------------------------------------------------------------ 动画 */

function playAnim(name, loop, onEnd) {
  const looping = loop !== false;
  if (currentAnim === name && looping) return;
  currentAnim = name;

  const url = '../assets/webm/' + encodeURIComponent(name) + '.webm';
  const next = 1 - front;
  const el = next === 0 ? vidA : vidB;
  const other = next === 0 ? vidB : vidA;

  const swap = () => {
    el.dataset.url = url;
    el.classList.add('is-front');
    other.classList.remove('is-front');
    front = next;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    if (!looping && onEnd) {
      el.removeEventListener('ended', onEnd);
      el.addEventListener('ended', onEnd, { once: true });
    }
  };

  // 同一个资源已经在缓冲里：直接重播，别再 load（重新 load 容易触发 media error）
  if (el.dataset.url === url) {
    el.loop = looping;
    try {
      el.currentTime = 0;
    } catch (err) {
      /* 忽略 */
    }
    swap();
    return;
  }

  el.addEventListener('loadeddata', swap, { once: true });
  el.addEventListener(
    'error',
    () => {
      // code 1 = 被下一次换源打断（动画链切得快时会刷这个），不是真失败
      const code = el.error && el.error.code;
      if (code === 1) return;
      console.error('[whale] 视频加载失败：', name, code);
    },
    { once: true }
  );
  el.src = url;
  el.loop = looping;
  el.muted = true;
  el.play().catch(() => {});
}

/** 状态动画（按时段/班次），返回动画名 */
function stateAnimFor(snap, now) {
  if (snap.payday === 0) return '工作状态-雀跃庆祝';
  if (snap.phase === 'working') return '工作状态-忙碌点按';
  if (snap.phase === 'before') return '工作状态-思考冒泡';
  const h = now.getHours();
  if (h >= 23 || h < 7) return '待机呼吸休闲';
  return '打瞌睡被惊醒';
}

/** 动画链：播完一段就按权重抽下一段，永不停 */
function chainNext() {
  if (pet.mode === 'drag' || pet.mode === 'fly') return;
  const snap = config ? C.snapshot(config) : null;
  const working = snap && snap.phase === 'working';
  let choice;
  if (working && Math.random() < 0.65) {
    choice = { cat: 'work', name: A.pick(A.POOL.work) };
  } else {
    choice = A.next();
  }
  if (choice.cat === 'move') {
    startWalk();
    return;
  }
  playAnim(choice.name, true);
  scheduleNext(2600 + Math.random() * 4200);
}

function scheduleNext(ms) {
  if (animTimer) clearTimeout(animTimer);
  animTimer = setTimeout(() => chainNext(), ms);
}

/** 走一段路（朝向目标） */
function startWalk() {
  const dir = Math.random() < 0.5 ? -1 : 1;
  pet.facing = dir;
  pet.mode = 'walk';
  // 活动范围 = 屏幕工作区（她的可见区不能超出桌面边缘）
  const minX = workArea.x + pet.w * 0.33 + 4;
  const maxX = workArea.x + workArea.width - pet.w * 0.67 - 4;
  const target = Math.max(minX, Math.min(maxX, pet.x + dir * (120 + Math.random() * 220)));
  pet.walkTarget = target;
  playAnim('原地左转奔跑', true);
  scheduleNext(2400 + Math.random() * 2200);
}

/* ------------------------------------------------------------ 物理 */

function physicsTick(dt) {
  // 挤压回弹要一直在跑：拖拽/飞行中也得恢复，不然甩出去时她是扁的
  if (pet.squash < 1) {
    pet.squashT += dt;
    const t = Math.min(1, pet.squashT / 0.55);
    const e = P.easeOutBack(t);
    const from = pet.squashFrom == null ? 0.55 : pet.squashFrom;
    pet.squash = from + (1 - from) * e;
    if (t >= 1) {
      pet.squash = 1;
      pet.squashFrom = null;
    }
  }

  if (pet.mode === 'drag') {
    // 拖拽位置由 mousemove 直接跟手，这里不重复积分
    return;
  }
  if (pet.mode === 'fly') {
    const r = P.stepFlight(pet, bounds(), dt, P.DEFAULT);
    if (r.landed) {
      pet.squash = P.squashFromImpact(r.impact);
      pet.squashFrom = pet.squash;
      pet.squashT = 0;
    }
    if (pet.mode === 'fly' && pet.vx === 0 && pet.vy === 0) {
      pet.mode = 'idle';
      chainNext();
    }
    if (Math.abs(pet.vx) > 12) pet.facing = pet.vx > 0 ? 1 : -1;
    return;
  }
  if (pet.mode === 'walk') {
    if (pet.walkTarget == null) {
      pet.mode = 'idle';
      chainNext();
      return;
    }
    const dx = pet.walkTarget - pet.x;
    const step = 90 * dt;
    if (Math.abs(dx) <= step) {
      pet.x = pet.walkTarget;
      pet.walkTarget = null;
      pet.mode = 'idle';
      chainNext();
    } else {
      pet.x += Math.sign(dx) * step;
    }
    return;
  }
  // 落地挤压回弹
}

let lastSquash = -1;
let lastFacing = 1;

function applySquash() {
  const s = pet.squash;
  // 值没变就别动样式：每帧改 transform 会白白触发合成
  if (Math.abs(s - lastSquash) >= 0.002) {
    lastSquash = s;
    stage.style.transform = `scale(${2 - s}, ${s})`;
    stage.style.transformOrigin = 'bottom center';
  }
  if (pet.facing !== lastFacing) {
    lastFacing = pet.facing;
    stage.style.filter = pet.facing < 0 ? 'scaleX(-1)' : '';
  }
}

/* ------------------------------------------------------------ 卡片 */

let lastSnap = null;

function render(snap) {
  cardLabel.textContent = snap.label;
  cardTime.textContent = snap.countdown;
  fridayVal.textContent = snap.friday;
  paydayVal.textContent = snap.payday;
  earnedVal.textContent = snap.todayEarned.toFixed(2);
  cardTag.textContent =
    snap.phase === 'rest' ? '休息日' : snap.phase === 'before' ? '上班倒计时' : '下班倒计时';
}

function tick() {
  if (!config) return;
  const now = new Date();
  const snap = C.snapshot(config, now);
  lastSnap = snap;
  render(snap);
  const key = 'state|' + snap.phase + '|' + snap.payday;
  if (key !== stateKey && pet.mode !== 'drag' && pet.mode !== 'fly') {
    stateKey = key;
    playAnim(stateAnimFor(snap, now), true);
    scheduleNext(4200);
  }
}

/* ------------------------------------------------------------ 互动 */

function showSay(text, imgSrc, ms) {
  sayText.textContent = text || '';
  if (imgSrc) {
    sayImg.src = imgSrc;
    sayImg.style.display = '';
  } else {
    sayImg.removeAttribute('src');
    sayImg.style.display = 'none';
  }
  say.classList.add('is-on');
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = setTimeout(() => say.classList.remove('is-on'), ms || 4000);
}

const MEME_FILES = [
  'Ciallo.png', 'token给妈妈保管.png', '假如给我三天多模态.png', '先养着吧.png',
  '厉害了我的鲸.png', '压力一只大肥鱼.png', '可爱.png', '吃白饭的大肥鱼.png',
  '吃饱饱摸肚子.png', '哦鲸鲸.png', '哪来的电脑病毒.png', '大师这个区是什么意思.png',
  '大烧货.png', '的药来了.png', '的要来啦.png', '完蛋了把黄油删了.png', '就一碗.png',
  '就骚了怎么滴吧.png', '我不更新你们用什么.png', '死掉了.png', '深度睡眠.png',
  '电死你.png', '要不直接骂他.png', '誓死践行开源精神.png', '除了调情没啥用.png',
  '鱼片有资源吗.png', '黎曼猜想没证明喵.png',
];

function randomMeme() {
  const f = MEME_FILES[Math.floor(Math.random() * MEME_FILES.length)];
  return '../assets/memes/' + encodeURIComponent(f);
}

/** 点击回应：随机动画 + 台词 */
function clickReaction() {
  const name = A.pick(A.POOL.click);
  playAnim(name, true);
  showSay(L.pick(L.CLICK), '', 6000);
  scheduleNext(3200);
  squash(0.88);
}

/** 落地/受击的轻微挤压 */
function squash(v) {
  pet.squash = v;
  pet.squashFrom = v;
  pet.squashT = 0;
}

/** 点击积分：飞行中点中 → 粒子 + 分数卡 */
function scoreHit(speed) {
  const pts = P.scoreOf(speed, pet.w);
  scoreEl.textContent = '+' + pts;
  scoreEl.classList.add('is-on');
  if (scoreTimer) clearTimeout(scoreTimer);
  scoreTimer = setTimeout(() => scoreEl.classList.remove('is-on'), 1400);
  burst(stage.getBoundingClientRect().left + pet.w / 2, stage.getBoundingClientRect().top + pet.h / 2);
  showSay(`这波 ${speed | 0} 像素/秒，+${pts} 分！`, '', 2600);
}

function burst(cx, cy) {
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('i');
    p.className = 'particle';
    const ang = (Math.PI * 2 * i) / 14 + Math.random();
    const dist = 40 + Math.random() * 70;
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    fx.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

/** 碎碎念：本地台词 + 随机表情包 */
function whisper() {
  const name = A.pick(A.POOL.whisper);
  playAnim(name, true);
  const withMeme = Math.random() < 0.55;
  showSay(L.pick(L.WHISPER), withMeme ? randomMeme() : '', 9000);
  scheduleNext(6000);
}

function scheduleWhisper() {
  if (whisperTimer) clearTimeout(whisperTimer);
  const sec = (config && config.whisperSec) || 300;
  whisperTimer = setTimeout(() => {
    if (pet.mode === 'idle' || pet.mode === 'walk') whisper();
    scheduleWhisper();
  }, sec * 1000);
}

/* ------------------------------------------------------------ 右键菜单 */

const MENU_ITEMS = [
  { label: '碎碎念（说一句）', action: () => whisper() },
  { label: '随机表情包', action: () => showSay(L.pick(L.MEME_LINES), randomMeme(), 6000) },
  { label: '回到初始位置', action: () => resetHome() },
  {
    label: '动作',
    children: [
      { label: '待机', action: () => playAnim(A.pick(A.POOL.idle), true) },
      { label: '转向', action: () => playAnim(A.pick(A.POOL.turn), true) },
      { label: '点击回应', action: () => clickReaction() },
      { label: '随机动作', action: () => playAnim(A.pick(A.POOL.random), true) },
      { label: '走一段', action: () => startWalk() },
    ],
  },
  { label: '设置…', action: () => api.openSettings() },
];

function openMenu(x, y) {
  menu.innerHTML = '';
  const build = (items, parent) => {
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'menu-item' + (it.children ? ' has-sub' : '');
      el.textContent = it.label + (it.children ? '  ▸' : '');
      if (it.children) {
        const sub = document.createElement('div');
        sub.className = 'menu-sub';
        build(it.children, sub);
        el.appendChild(sub);
      } else {
        el.addEventListener('click', () => {
          closeMenu();
          it.action();
        });
      }
      parent.appendChild(el);
    }
  };
  build(MENU_ITEMS, menu);
  menu.style.left = Math.min(x, stageW - 240) + 'px';
  menu.style.top = Math.min(y, stageH - 220) + 'px';
  menu.classList.add('is-on');
  api.setPointerOver(true);
}

function closeMenu() {
  menu.classList.remove('is-on');
}

/* ------------------------------------------------------------ 交互事件 */

function hitTest(x, y) {
  const r = stage.getBoundingClientRect();
  // 只有落在角色身上（有像素的那块）才算命中，靠近不算
  const L = window.WhaleCalc ? window.WhaleCalc.LAYOUT : null;
  const visL = L ? L.visL : 0.33;
  const visR = L ? L.visR : 0.67;
  const visT = L ? L.visT : 0.2;
  const visB = L ? L.visB : 0.9;
  const x0 = r.left + r.width * visL;
  const x1 = r.left + r.width * visR;
  const y0 = r.top + r.height * visT;
  const y1 = r.top + r.height * visB;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function setHover(v) {
  if (hover === v) return;
  hover = v;
  card.classList.toggle('is-on', v);
  cardTag.classList.toggle('is-on', v);
  stage.classList.toggle('is-hover', v);
}

api.onHover((v) => setHover(v));

document.addEventListener('mousemove', (e) => {
  if (dragging) {
    // 拖拽：宠物跟手（弹簧）。位置用屏幕坐标算，窗口由主进程跟着挪
    const targetX = e.screenX - grabDX;
    const targetY = e.screenY - grabDY;
    pet.vx = (targetX - pet.x) * 12;
    pet.vy = (targetY - pet.y) * 12;
    pet.x += (targetX - pet.x) * 0.35;
    pet.y += (targetY - pet.y) * 0.35;
    pet.mode = 'drag';
    dragSamples.push({ x: e.screenX, y: e.screenY, t: Date.now() });
    if (dragSamples.length > 6) dragSamples.shift();
    dragged = true;
    api.dragMove(e.screenX, e.screenY);
  } else {
    setHover(hitTest(e.clientX, e.clientY));
  }
});

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  closeMenu();
  const r = stage.getBoundingClientRect();
  grabDX = e.clientX - r.left;
  grabDY = e.clientY - r.top;
  dragging = true;
  dragged = false;
  dragSamples = [{ x: e.screenX, y: e.screenY, t: Date.now() }];
  pet.mode = 'drag';
  stage.classList.add('is-drag');
  playAnim(A.pick(A.POOL.drag), true);
  api.dragStart(grabDX, grabDY);
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  stage.classList.remove('is-drag');
  api.dragEnd();
  if (!dragged) {
    // 轻点：飞行中点中 → 积分；否则普通点击回应
    const speed = Math.hypot(pet.vx, pet.vy);
    if (pet.mode === 'fly' && speed >= 400) {
      scoreHit(speed);
      pet.vx *= 0.4;
      pet.vy *= 0.4;
    } else {
      clickReaction();
    }
    pet.mode = 'idle';
    return;
  }
  // 甩出去：按最后轨迹估速
  const v = P.estimateVelocity(dragSamples, 1 / 60);
  const speed = Math.hypot(v.vx, v.vy);
  if (speed > 260) {
    pet.vx = v.vx * P.DEFAULT.throwPower;
    pet.vy = v.vy * P.DEFAULT.throwPower;
    pet.mode = 'fly';
  } else {
    pet.vx = 0;
    pet.vy = 0;
    pet.mode = 'idle';
    chainNext();
  }
});

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  openMenu(e.clientX, e.clientY);
});

document.addEventListener('mousedown', (e) => {
  if (!menu.classList.contains('is-on')) return;
  if (!menu.contains(e.target)) closeMenu();
});

function resetHome() {
  pet.x = pet.homeX;
  pet.y = pet.homeY;
  pet.vx = 0;
  pet.vy = 0;
  pet.mode = 'idle';
  chainNext();
}

/* ------------------------------------------------------------ 播报 */

function showBubble(snap, text) {
  bubbleTime.textContent = snap.clock;
  bubbleBody.textContent = text;
  bubble.classList.add('is-on');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('is-on'), 30000);
}

let bubbleTimer = null;

// 点一下播报气泡就自己消失
bubble.addEventListener('click', (e) => {
  e.stopPropagation();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubble.classList.remove('is-on');
});

api.onAnnounce((payload) => {
  if (!payload) return;
  showBubble(payload.snap, payload.text);
});

function playSpeech(p) {
  if (!p) return;
  const vol = Math.min(1, Math.max(0, p.volume == null ? 1 : p.volume));
  if (p.dataUrl) {
    try {
      const a = new Audio(p.dataUrl);
      a.volume = vol;
      a.play()
        .then(() => console.log('[whale] 语音已播放', p.mode))
        .catch((err) => console.warn('[whale] 语音播放失败', err && err.message));
    } catch (err) {
      console.warn('[whale] 音频播放异常', err && err.message);
    }
    return;
  }
  try {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(p.text);
    utter.rate = p.systemRate || 1.2;
    utter.pitch = p.systemPitch || 1.5;
    utter.volume = vol;
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.name === p.systemVoice) || voices.find((x) => x.lang && x.lang.indexOf('zh') === 0);
    if (v) utter.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  } catch (err) {
    /* 忽略 */
  }
}

api.onSpeak((payload) => playSpeech(payload));

/* ------------------------------------------------------------ 启动 */

function loop(ts) {
  const dt = Math.min(0.05, (ts - (loop.last || ts)) / 1000);
  loop.last = ts;
  physicsTick(dt);
  applySquash();
  // 每帧都把位置报给主进程——它靠这个把窗口挪到宠物脚下。
  // 之前 120ms 才报一次，窗口只跟到 8fps，拖动/甩动就会明显掉帧。
  // 但也不用报太密：主进程每次都要挪一次窗口，144Hz 会把它自己累趴。
  if (ts - lastRectSent >= 15) {
    lastRectSent = ts;
    api.setPetRect({ x: pet.x, y: pet.y, w: pet.w, h: pet.h, bubble: bubbleRect() });
  }
  requestAnimationFrame(loop);
}
let lastRectSent = 0;

/** 播报气泡在窗口内的矩形（用来让主进程知道那块也要能点） */
function bubbleRect() {
  if (!bubble.classList.contains('is-on')) return null;
  const r = bubble.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

(async function init() {
  config = await api.getConfig();
  applyLayout(await api.getLayout());
  tick();
  setInterval(tick, 1000);
  scheduleWhisper();
  requestAnimationFrame(loop);
  chainNext();

  api.onConfigChanged((cfg) => {
    config = cfg;
    api.getLayout().then(applyLayout);
    stateKey = '';
    tick();
  });
})();
