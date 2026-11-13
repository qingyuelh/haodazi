/**
 * 桌宠物理（对齐 dsh-pet 的手感思路，自己实现）
 *  - 拖拽：弹簧跟手（不抖、不飘）
 *  - 松手：按最后轨迹估速 → 沿抛物线飞行
 *  - 飞行：重力、撞墙恢复系数反弹、地面摩擦减速
 *  - 落地：按冲击速度做 Q 弹挤压回弹
 */
(function (root) {
  'use strict';

  const DEFAULT = {
    gravity: 2100, // px/s²
    restitution: 0.52, // 撞墙恢复系数
    groundFriction: 0.84, // 地面摩擦（每帧速度衰减）
    ceilingBounce: true, // 撞顶反弹
    throwPower: 1.0, // 甩出力度总系数
    springK: 0.26, // 跟手弹簧刚度
    springDamp: 0.72,
    size: 462, // 宠物尺寸（分数换算用，同 dsh-pet 口径）
  };

  /** 弹簧跟手：位置向目标逼近，速度带阻尼 */
  function springFollow(s, targetX, targetY, dt, cfg) {
    const k = cfg.springK;
    const damp = cfg.springDamp;
    const ax = (targetX - s.x) * k * 60 - s.vx * (1 - damp) * 12;
    const ay = (targetY - s.y) * k * 60 - s.vy * (1 - damp) * 12;
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }

  /** 用最近的指针采样估速度（px/s） */
  function estimateVelocity(samples, dt) {
    if (!samples || samples.length < 2) return { vx: 0, vy: 0 };
    const a = samples[0];
    const b = samples[samples.length - 1];
    const span = Math.max(0.016, (b.t - a.t) / 1000);
    return { vx: (b.x - a.x) / span, vy: (b.y - a.y) / span };
  }

  /**
   * 推进一帧飞行物理。
   * s: {x,y,vx,vy,w,h}；bounds: {width,height,floorY,visL,visR,left,top}
   * visL/visR = 角色在画面里的可见区比例（webm 640×360 里人物只占中间一部分，
   * 用整块画面算边界的话，人还没碰到屏幕边就先被弹回来了）
   * left/top = 屏幕工作区原点（多显示器时不是 0）
   * 返回 {landed, impact, wallHit}
   */
  function stepFlight(s, bounds, dt, cfg) {
    const out = { landed: false, impact: 0, wallHit: false };
    const visL = bounds.visL == null ? 0 : bounds.visL;
    const visR = bounds.visR == null ? 1 : bounds.visR;
    const bx = bounds.left || 0;
    const by = bounds.top || 0;
    s.vy += cfg.gravity * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    const left = s.x + s.w * visL;
    const right = s.x + s.w * visR;
    if (left < bx) {
      s.x = bx - s.w * visL;
      s.vx = Math.abs(s.vx) * cfg.restitution;
      out.wallHit = true;
    } else if (right > bx + bounds.width) {
      s.x = bx + bounds.width - s.w * visR;
      s.vx = -Math.abs(s.vx) * cfg.restitution;
      out.wallHit = true;
    }

    if (s.y < by) {
      s.y = by;
      if (cfg.ceilingBounce) {
        s.vy = Math.abs(s.vy) * cfg.restitution;
        out.wallHit = true;
      } else {
        s.vy = 0;
      }
    }

    const floor = bounds.floorY;
    if (s.y + s.h > floor) {
      s.y = floor - s.h;
      if (s.vy > 0) {
        out.impact = s.vy;
        out.landed = true;
        s.vy = -s.vy * cfg.restitution;
        if (Math.abs(s.vy) < 140) s.vy = 0;
      }
      s.vx *= cfg.groundFriction;
      if (Math.abs(s.vx) < 12) s.vx = 0;
    }
    return out;
  }

  /** 落地挤压：冲击越大压得越扁（0.55 ~ 0.8），回弹用 easeOutBack */
  function squashFromImpact(impact) {
    const t = Math.min(1, Math.abs(impact) / 2200);
    return 0.8 - 0.25 * t;
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const p = t - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  }

  /** 分数：越快/越小分越高（同 dsh-pet 口径） */
  function scoreOf(speed, size) {
    return Math.round((speed / 100) * (462 / Math.max(1, size)));
  }

  root.PetPhysics = {
    DEFAULT,
    springFollow,
    estimateVelocity,
    stepFlight,
    squashFromImpact,
    easeOutBack,
    scoreOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
