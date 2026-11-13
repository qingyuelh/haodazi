/**
 * 语音合成（主进程侧）
 *
 * 三套引擎，优先级由设置决定：
 *   1. edge  —— 微软 Edge 神经网络音色（Node 原生实现，需联网，不需要装任何东西）
 *   2. piper —— 随包附带的离线神经网络女声（本地模型，断网也能用）
 *   3. system —— Windows 自带中文语音（渲染层 speechSynthesis，完全兜底）
 */
'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const edgeTts = require('./edge-tts.js');

/** Edge 音色：微软在线神经音色 */
const EDGE_VOICES = [
  { id: 'zh-CN-XiaoyiNeural', name: '元气少女（Xiaoyi）', desc: '活泼少女，元气满满' },
  { id: 'zh-CN-XiaoxiaoNeural', name: '元气女声（Xiaoxiao）', desc: '清亮自然，偏新闻腔' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '陕西少女（Xiaoni）', desc: '陕西口音，语调明亮' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '东北少女（Xiaobei）', desc: '东北口音，俏皮' },
  { id: 'zh-CN-XiaoshuangNeural', name: '元气童声（Xiaoshuang）', desc: '偏童声，清脆' },
  { id: 'zh-CN-YunxiNeural', name: '阳光少年（Yunxi）', desc: '男声，阳光有活力' },
];

/** 系统自带中文音色（离线兜底） */
const SYSTEM_VOICES = [
  { id: 'Microsoft Yaoyao - Chinese (Simplified, PRC)', name: '系统少女音（Yaoyao）' },
  { id: 'Microsoft Huihui - Chinese (Simplified, PRC)', name: '系统温柔音（Huihui）' },
  { id: 'Microsoft Kangkang - Chinese (Simplified, PRC)', name: '系统活泼音（Kangkang）' },
];

/** 随包附带的离线音色 */
const PIPER_VOICES = [{ id: 'zh_CN-huayan-medium', name: '离线女声（华颜）', desc: '随包附带，断网也能播' }];

/* ---------------------------------------------------------- 离线音调处理 */

/**
 * 给 WAV 变调（重采样法）：factor > 1 变高变快。
 * Piper 的中文女声偏播音腔，整体提上去一点会甜很多。
 */
function brightenWav(buf, factor) {
  try {
    if (!buf || buf.length < 64 || !factor || Math.abs(factor - 1) < 0.01) return buf;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return buf;
    let pos = 12;
    let fmt = null;
    let dataOff = -1;
    let dataLen = 0;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (id === 'fmt ') {
        fmt = {
          channels: buf.readUInt16LE(pos + 10),
          rate: buf.readUInt32LE(pos + 12),
          bits: buf.readUInt16LE(pos + 22),
        };
      } else if (id === 'data') {
        dataOff = pos + 8;
        dataLen = Math.min(size, buf.length - dataOff);
        break;
      }
      pos += 8 + size + (size % 2);
    }
    if (!fmt || dataOff < 0 || fmt.bits !== 16 || fmt.channels !== 1) return buf;
    const src = new Int16Array(buf.buffer, buf.byteOffset + dataOff, Math.floor(dataLen / 2));
    const outLen = Math.max(1, Math.floor(src.length / factor));
    const out = Buffer.alloc(44 + outLen * 2);
    buf.copy(out, 0, 0, 12); // RIFF 头
    out.write('WAVE', 12);
    out.write('fmt ', 16);
    out.writeUInt32LE(16, 20);
    out.writeUInt16LE(1, 24);
    out.writeUInt16LE(1, 26);
    out.writeUInt32LE(fmt.rate, 28);
    out.writeUInt32LE(fmt.rate * 2, 32);
    out.writeUInt16LE(2, 36);
    out.writeUInt16LE(16, 38);
    out.write('data', 40);
    out.writeUInt32LE(outLen * 2, 44);
    for (let i = 0; i < outLen; i++) {
      const sp = i * factor;
      const i0 = Math.floor(sp);
      const i1 = Math.min(src.length - 1, i0 + 1);
      const fr = sp - i0;
      const v = src[i0] * (1 - fr) + src[i1] * fr;
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), 48 + i * 2);
    }
    return out;
  } catch (e) {
    return buf;
  }
}

/* ---------------------------------------------------------- piper（本地离线） */

/** 找 piper 目录：打包后在 resources/tts，源码运行时在项目根的 tts */
function piperRoot() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'tts'));
  candidates.push(path.join(__dirname, '..', '..', 'tts'));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'piper', 'piper.exe'))) return dir;
  }
  return null;
}

let piperChecked = false;
let piperOk = false;

/** 本地离线音色是否可用 */
function piperAvailable() {
  if (piperChecked) return piperOk;
  piperChecked = true;
  const root = piperRoot();
  piperOk = !!(root && fs.existsSync(path.join(root, 'voices', 'zh_CN-huayan-medium.onnx')));
  return piperOk;
}

/** 合成过程中的临时文件目录：优先用应用自己的数据目录 */
function workDir() {
  const dirs = [];
  if (process.env.WHALE_TTS_WORKDIR) dirs.push(process.env.WHALE_TTS_WORKDIR);
  try {
    dirs.push(path.join(require('electron').app.getPath('userData'), 'tts-cache'));
  } catch (e) {
    /* 非 Electron 环境（测试）忽略 */
  }
  dirs.push(path.join(os.tmpdir(), 'whale-tts'));
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (e) {
      /* 换下一个 */
    }
  }
  return os.tmpdir();
}

/**
 * 用本地 piper 合成（离线）
 * @returns {Promise<{url:string, engine:string}|null>}
 */
function synthesizePiper(text, opt = {}) {
  const root = piperRoot();
  if (!root || !text) return Promise.resolve(null);
  const exe = path.join(root, 'piper', 'piper.exe');
  const model = path.join(root, 'voices', 'zh_CN-huayan-medium.onnx');
  const espeak = path.join(root, 'piper', 'espeak-ng-data');
  if (!fs.existsSync(exe) || !fs.existsSync(model)) return Promise.resolve(null);

  const dir = workDir();
  const out = path.join(dir, `whale-piper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  // 语速：length_scale 越大越慢
  const rate = Number.isFinite(opt.rate) ? opt.rate : 18;
  const lengthScale = Math.max(0.6, Math.min(1.6, 1 - rate / 100));

  const args = [
    '--model', model,
    '--output_file', out,
    '--espeak_data', espeak,
    '--length_scale', String(lengthScale.toFixed(2)),
    '--quiet',
  ];

  return new Promise((resolve) => {
    let child = null;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (err) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* 忽略 */
      }
    }, 30000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      let url = null;
      try {
        if (fs.existsSync(out)) {
          let buf = fs.readFileSync(out);
          fs.unlinkSync(out);
          // 离线女声本身偏成熟，整体提调变甜一点
          buf = brightenWav(buf, 1.18);
          if (buf.length > 1024) url = 'data:audio/wav;base64,' + buf.toString('base64');
        }
      } catch (e) {
        /* 忽略 */
      }
      resolve(url ? { url, engine: 'piper' } : null);
    });
    try {
      child.stdin.write(String(text));
      child.stdin.end();
    } catch (e) {
      /* 忽略 */
    }
  });
}

/* ---------------------------------------------------------- Edge（在线） */

/**
 * 用 Edge 神经网络音色合成（需联网）
 * @returns {Promise<{url:string, engine:string}|null>}
 */
async function synthesizeEdge(text, opt = {}) {
  const args = {
    voice: opt.voice || EDGE_VOICES[0].id,
    rate: Number.isFinite(opt.rate) ? opt.rate : 24,
    pitch: Number.isFinite(opt.pitch) ? opt.pitch : 30,
    volume: Number.isFinite(opt.volume) ? opt.volume : 0,
  };
  let buf = await edgeTts.synthesize(text, args);
  // 偶尔握手会掉一下，重试一次
  if (!buf || !buf.length) {
    await new Promise((r) => setTimeout(r, 400));
    buf = await edgeTts.synthesize(text, args);
  }
  if (!buf || !buf.length) return null;
  // 加个空的 ID3 头，方便浏览器/播放器一眼认出是 mp3
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const mp3 = Buffer.concat([id3, buf]);
  return { url: 'data:audio/mpeg;base64,' + mp3.toString('base64'), engine: 'edge' };
}

/* ---------------------------------------------------------- 对外接口 */

/**
 * 按引擎优先级合成
 * @param {string} text
 * @param {{engine?:string, voice?:string, rate?:number, pitch?:number, volume?:number}} opt
 * @returns {Promise<{url:string, engine:string}|null>}
 */
async function synthesize(text, opt = {}) {
  if (!text) return null;
  const engine = opt.engine || 'auto';
  const tryEdge = async () => {
    const r = await synthesizeEdge(text, opt);
    return r;
  };
  const tryPiper = async () => synthesizePiper(text, opt);

  if (engine === 'edge') {
    return (await tryEdge()) || (await tryPiper());
  }
  if (engine === 'piper') {
    return (await tryPiper()) || (await tryEdge());
  }
  if (engine === 'system') return null;
  // auto：在线优先，断了就用随包的离线女声
  return (await tryEdge()) || (await tryPiper());
}

module.exports = {
  EDGE_VOICES,
  SYSTEM_VOICES,
  PIPER_VOICES,
  piperAvailable,
  piperRoot,
  synthesize,
  synthesizeEdge,
  synthesizePiper,
};
