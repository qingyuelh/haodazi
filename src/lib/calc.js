/**
 * 鲸鱼娘桌宠 · 共享计算逻辑
 * 主进程（整点播报）和渲染层（每秒刷新）都用这一份，避免两边算出来不一样。
 * 同时兼容 CommonJS（主进程 require）与浏览器全局（渲染层 <script> 引入）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaleCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
  const DAY_MS = 86400000;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** "09:30" -> 570（当天零点起的分钟数）；非法返回 null */
  function parseHM(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(str == null ? '' : str).trim());
    if (!m) return null;
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return h * 60 + mi;
  }

  function dayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** ISO 星期：周一=1 … 周日=7 */
  function isoWeekday(d) {
    const w = d.getDay();
    return w === 0 ? 7 : w;
  }

  function workdaysOf(cfg) {
    const list = Array.isArray(cfg && cfg.workdays) ? cfg.workdays.filter((n) => n >= 1 && n <= 7) : [];
    return list.length ? list : [1, 2, 3, 4, 5];
  }

  function isWorkday(d, cfg) {
    return workdaysOf(cfg).indexOf(isoWeekday(d)) !== -1;
  }

  function lastDayOfMonth(year, month /* 0-based */) {
    return new Date(year, month + 1, 0).getDate();
  }

  /** 某月的工作日天数 */
  function workdaysInMonth(year, month /* 0-based */, cfg) {
    const days = lastDayOfMonth(year, month);
    let n = 0;
    for (let i = 1; i <= days; i++) {
      if (isWorkday(new Date(year, month, i), cfg)) n++;
    }
    return n || 1;
  }

  /**
   * 日薪：月薪 ÷ 计薪天数。
   * mode='month'  -> ÷ 本月实际工作日天数（随月份浮动，真实）
   * mode='fixed'  -> ÷ 固定天数（默认 21.75，社保标准）
   */
  function dailySalary(cfg, now) {
    const salary = Number(cfg.monthlySalary) || 0;
    let days;
    if (cfg.salaryMode === 'fixed') {
      days = Number(cfg.fixedWorkdays) || 21.75;
    } else {
      days = workdaysInMonth(now.getFullYear(), now.getMonth(), cfg);
    }
    if (!days || !isFinite(days)) days = 21.75;
    return salary / days;
  }

  /** 下一次发薪日（day=0 表示月末） */
  function paydayInfo(now, cfg) {
    const day = Number(cfg.paydayDay) || 0;
    const y = now.getFullYear();
    const m = now.getMonth();
    const mk = (yy, mm) => {
      const ld = lastDayOfMonth(yy, mm);
      const dd = day === 0 ? ld : Math.min(day, ld);
      return new Date(yy, mm, dd);
    };
    const today = dayStart(now);
    let d = mk(y, m);
    if (d.getTime() < today.getTime()) d = mk(y, m + 1);
    const days = Math.round((dayStart(d).getTime() - today.getTime()) / DAY_MS);
    return { date: d, days };
  }

  /** 距离下一个周五还有几天（今天周五 = 0） */
  function fridayInfo(now) {
    const cur = now.getDay();
    return (5 - cur + 7) % 7;
  }

  /** 下一个工作日的上班时刻（跳过休息日） */
  function nextWorkdayStart(now, cfg) {
    const s = parseHM(cfg.workStart) == null ? 9 * 60 : parseHM(cfg.workStart);
    const cursor = new Date(now.getTime());
    for (let i = 0; i < 21; i++) {
      const base = dayStart(cursor);
      const startAt = new Date(base.getTime() + s * 60000);
      if (isWorkday(cursor, cfg) && now.getTime() < startAt.getTime()) return startAt;
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    return null;
  }

  /**
   * 班次状态：
   *  - working  → 距下班还有
   *  - before   → 距上班还有（还没上班）
   *  - after    → 距明天上班还有（今天下班了）
   *  - rest     → 休息日，距下一个工作日上班还有
   * 支持跨夜班（下班时间 < 上班时间）。
   */
  function shiftState(now, cfg) {
    const s = parseHM(cfg.workStart) == null ? 9 * 60 : parseHM(cfg.workStart);
    const rawE = parseHM(cfg.workEnd) == null ? 18 * 60 : parseHM(cfg.workEnd);
    const e = rawE <= s ? rawE + 1440 : rawE;
    const base = dayStart(now);
    const nowMin = (now.getTime() - base.getTime()) / 60000;

    // 休息日：不排班，倒计时指向下一个工作日的上班时刻
    if (!isWorkday(now, cfg)) {
      return {
        phase: 'rest',
        label: '距离上班还有',
        target: nextWorkdayStart(now, cfg) || new Date(base.getTime() + DAY_MS + s * 60000),
        overnight: false,
      };
    }

    // 昨夜开的班（跨夜）
    const pStart = s - 1440;
    const pEnd = e - 1440;
    if (nowMin >= pStart && nowMin < pEnd) {
      return {
        phase: 'working',
        label: '距离下班还有',
        target: new Date(base.getTime() + pEnd * 60000),
        overnight: true,
      };
    }
    if (nowMin >= s && nowMin < e) {
      return {
        phase: 'working',
        label: '距离下班还有',
        target: new Date(base.getTime() + e * 60000),
        overnight: false,
      };
    }
    if (nowMin < s) {
      return {
        phase: 'before',
        label: '距离上班还有',
        target: new Date(base.getTime() + s * 60000),
        overnight: false,
      };
    }
    const tomorrow = new Date(base.getTime() + DAY_MS);
    return {
      phase: 'after',
      label: '距离上班还有',
      target: new Date(tomorrow.getTime() + s * 60000),
      overnight: false,
    };
  }

  /** 毫秒 -> HH:MM:SS（小时可超过 24） */
  function formatDuration(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  /** 时段名：凌晨/早上/上午/中午/下午/晚上 */
  function periodOf(now) {
    const h = now.getHours();
    if (h < 5) return '凌晨';
    if (h < 9) return '早上';
    if (h < 11) return '上午';
    if (h < 13) return '中午';
    if (h < 18) return '下午';
    if (h < 23) return '晚上';
    return '深夜';
  }

  /** 完整快照：卡片上要显示的所有数字 */
  function snapshot(cfg, now) {
    now = now || new Date();
    const shift = shiftState(now, cfg);
    const payday = paydayInfo(now, cfg);
    const daily = dailySalary(cfg, now);
    const workday = isWorkday(now, cfg);
    const ms = shift.target.getTime() - now.getTime();
    return {
      phase: shift.phase,
      label: shift.label,
      overnight: shift.overnight,
      countdown: formatDuration(ms),
      countdownMs: ms,
      friday: fridayInfo(now),
      payday: payday.days,
      paydayText: `${payday.date.getFullYear()}-${pad(payday.date.getMonth() + 1)}-${pad(payday.date.getDate())}`,
      daily: daily,
      todayEarned: workday ? daily : 0,
      workday: workday,
      weekdayCN: '周' + WEEKDAY_CN[now.getDay()],
      clock: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      periodCN: periodOf(now),
      workStart: cfg.workStart,
      workEnd: cfg.workEnd,
    };
  }

  /** 整点播报用的一句话。opt.upbeat=true 时用元气满满的口吻 */
  function speechText(snap, opt) {
    const upbeat = !!(opt && opt.upbeat);
    const clock = snap.clock.replace(':', '点') + '分';
    if (upbeat) {
      const bits = [];
      bits.push(`叮咚～现在是${snap.periodCN}${clock}！`);
      if (snap.phase === 'working') {
        bits.push(`距离下班还有${humanDuration(snap.countdownMs)}，再冲一会儿！`);
      } else if (snap.phase === 'before') {
        bits.push(`距离上班还有${humanDuration(snap.countdownMs)}，今天也要元气满满哦！`);
      } else if (snap.phase === 'rest') {
        bits.push(`今天是休息日，距离下一个工作日上班还有${humanDuration(snap.countdownMs)}，好好放松！`);
      } else {
        bits.push('今天已经下班啦，回去好好休息吧！');
      }
      bits.push(`距离周五还有${snap.friday}天，距离发薪还有${snap.payday}天。`);
      bits.push(
        snap.workday
          ? `今天已经赚了${snap.todayEarned.toFixed(2)}元，继续冲呀！`
          : '今天没有工资收入，休息一下也是赚！'
      );
      return bits.join('');
    }

    const bits = [];
    bits.push(`现在是${snap.periodCN}${snap.clock.replace(':', '点')}分`);
    if (snap.phase === 'working') {
      bits.push(`距离下班还有${humanDuration(snap.countdownMs)}`);
    } else if (snap.phase === 'before' || snap.phase === 'rest') {
      bits.push(`今天休息，距离上班还有${humanDuration(snap.countdownMs)}`);
    } else {
      bits.push('今天已经下班了');
    }
    bits.push(`距离周五还有${snap.friday}天`);
    bits.push(`距离发薪还有${snap.payday}天`);
    bits.push(snap.workday ? `今天赚了${snap.todayEarned.toFixed(2)}元` : '今天休息');
    return bits.join('，') + '。';
  }

  /** 03:17:38 -> "3小时17分38秒" */
  function humanDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const out = [];
    if (h) out.push(`${h}小时`);
    if (h || m) out.push(`${m}分`);
    out.push(`${s}秒`);
    return out.join('');
  }

  /* ------------------------------------------------------------ 布局 */

  const LAYOUT = {
    cardW: 344,
    cardH: 214,
    whaleW: 420,
    whaleH: 236,
    gap: 12,
    overlap: 30,
    pad: 24,
    // 窗口要小：窗口跟着宠物跑，每挪一次都要重新合成，
    // 920×680 的透明窗挪起来明显卡，缩到 480×640 流畅很多
    windowW: 480,
    windowH: 640,
    // 角色在 640×360 画面里真正有像素的范围（相对比例）
    // 悬停命中区就按这个来：鼠标必须落在她身上才出卡片，靠近不算
    visL: 0.33,
    visR: 0.67,
    visT: 0.2,
    visB: 0.9,
  };

  /** 桌宠缩放 -> 窗口尺寸与各元素尺寸（主进程算窗口、渲染层摆元素，必须一致） */
  function layout(scale) {
    const s = Math.min(1.7, Math.max(0.55, Number(scale) || 1));
    const whaleW = Math.round(LAYOUT.whaleW * s);
    const whaleH = Math.round(LAYOUT.whaleH * s);
    return {
      scale: s,
      cardW: LAYOUT.cardW,
      cardH: LAYOUT.cardH,
      whaleW,
      whaleH,
      gap: LAYOUT.gap,
      overlap: LAYOUT.overlap,
      pad: LAYOUT.pad,
      windowW: LAYOUT.windowW,
      windowH: LAYOUT.windowH,
    };
  }

  /**
   * 宠物在窗口里的固定落点（窗口内坐标）。
   * 窗口会跟着宠物跑，所以这个落点是恒定的，宠物的真实位置用屏幕坐标算。
   */
  function spot(layout) {
    return {
      x: Math.round((layout.windowW - layout.whaleW) / 2),
      y: layout.windowH - layout.pad - layout.whaleH,
    };
  }

  /**
   * 鲸鱼娘身体在窗口里的命中区（窗口内坐标）。
   * 角色只占 640×360 画面中间一小块，命中区按画面比例收窄，
   * 免得透明留白也挡住下层软件的点击。
   */
  function hitRegion(layout) {
    const stageX = layout.windowW - layout.pad - layout.whaleW;
    const stageY = layout.windowH - layout.pad - layout.whaleH;
    return {
      x0: stageX + layout.whaleW * LAYOUT.visL,
      x1: stageX + layout.whaleW * LAYOUT.visR,
      y0: stageY + layout.whaleH * LAYOUT.visT,
      y1: stageY + layout.whaleH * LAYOUT.visB,
    };
  }

  return {
    DAY_MS,
    WEEKDAY_CN,
    LAYOUT,
    layout,
    spot,
    hitRegion,
    pad,
    parseHM,
    dayStart,
    isoWeekday,
    isWorkday,
    workdaysInMonth,
    workdaysOf,
    dailySalary,
    paydayInfo,
    fridayInfo,
    shiftState,
    nextWorkdayStart,
    formatDuration,
    periodOf,
    snapshot,
    speechText,
    humanDuration,
  };
});
