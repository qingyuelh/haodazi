/**
 * 动画池与权重（对齐 dsh-pet 的「永不停止的动画链」思路）
 * idle 10 / turn 5 / move 5，其余归随机动作分类。
 */
(function (root) {
  'use strict';

  const POOL = {
    // 待机：安静地待着
    idle: ['待机呼吸休闲', '原地漂浮踏步', '鲸鱼吐泡泡特效', '原地专心玩魔方', '悠闲哼歌', '照镜子', '原地小憩沉眠'],
    // 转向：左右看看
    turn: ['东张西望', '整体换装试色', '螃蟹走路', '原地敲击桌面互动'],
    // 移动：真的走一段
    move: ['原地左转奔跑', '优雅女仆舞', '原地跳跃抓碎头顶物品', '可爱宅舞', '轻快摇摆舞'],
    // 点击回应：被戳到时的反应
    click: [
      '点击回应-傲娇生气',
      '点击回应-元气挥手',
      '点击回应-害羞惊讶',
      '点击回应-开心跃动',
      '点击回应-挠痒咯咯笑',
    ],
    // 随机动作：什么都可能来一下
    random: [
      '蓝鲸现世', '玩水枪', '下五子棋', '三球抛接', '打瞌睡被惊醒', '深度思考碎碎念',
      '吹笛子', '小提琴演奏', '吃白饭', '撸猫', '变鸽子', '放风筝', '骑木马', '抽陀螺',
      '拆礼物', '偷吃零食被抓住', '玩游戏气急败坏', '写代码', '吹气球', '被吓一跳', '超大伸懒腰',
    ],
    // 工作状态：按当前班次挑
    work: [
      '工作状态-忙碌点按',
      '工作状态-思考冒泡',
      '工作状态-雀跃庆祝',
      '工作状态-垂头叹气冒汗',
      '工作状态-清点归档',
      '工作状态-原地踱步张望',
    ],
    // 拖拽中被拎起来
    drag: ['被鼠标拖拽悬空反馈'],
    // 碎碎念
    whisper: ['碎碎念-对屏碎碎念', '碎碎念-发呆碎碎念', '碎碎念-擦桌碎碎念'],
  };

  const WEIGHTS = { idle: 10, turn: 5, move: 5, random: 80 };

  function pick(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  /** 按权重抽一个分类，再从该分类里抽一段动画 */
  function next(categoryBias) {
    const cats = Object.keys(WEIGHTS);
    let total = 0;
    const entries = [];
    for (const c of cats) {
      let w = WEIGHTS[c];
      if (categoryBias && categoryBias[c]) w *= categoryBias[c];
      if (w <= 0) continue;
      entries.push([c, w]);
      total += w;
    }
    if (!entries.length) return { cat: 'idle', name: pick(POOL.idle) };
    let r = Math.random() * total;
    let chosen = entries[0][0];
    for (const [c, w] of entries) {
      r -= w;
      if (r <= 0) {
        chosen = c;
        break;
      }
    }
    return { cat: chosen, name: pick(POOL[chosen]) };
  }

  root.PetAnim = { POOL, WEIGHTS, pick, next };
})(typeof globalThis !== 'undefined' ? globalThis : this);
