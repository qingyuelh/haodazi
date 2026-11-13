/**
 * Edge TTS 鐨?Sec-MS-GEC v2 浠ょ墝锛堢函 JS 绉绘锛屾簮鑷?edge-tts 鐨?drm.py锛? *
 * 涓轰粈涔堣嚜宸卞疄鐜帮細edge-tts 鏄?Python 鍖咃紝璁╁埆鐨勭數鑴戣 Python + pip 瑁呭寘澶姌鑵撅紱
 * 杩欓噷鐢?BigInt 绮剧‘妯℃嫙 Python 鐨?64 浣嶈繍绠楋紝Node 鍘熺敓璺戯紝瑁呭畬鍗崇敤銆? *
 * 浠ょ墝鏍煎紡锛?<CS64 16 hex>-<SHA256 64 hex>"锛屾寜 300 绉掔獥鍙ｆ粴鍔ㄣ€? */
'use strict';

const T = require('./gec-tables.js');

const MASK = 0xffffffffn;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

function rol16(value) {
  const v = value & MASK;
  return (((v << 16n) | (v >> 16n)) & MASK);
}

function wordsLe4Even(data) {
  const pad = ((-data.length) % 4 + 4) % 4; // Python-style modulo
  const padded = Buffer.alloc(data.length + pad);
  data.copy(padded);
  const n = padded.length / 4;
  const words = [];
  for (let i = 0; i < n; i++) words.push(padded.readUInt32LE(i * 4));
  if (words.length % 2) words.push(0);
  return words;
}

function sigma0(value) {
  const v = BigInt(value);
  return ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & MASK;
}

function sigma1(value) {
  const v = BigInt(value);
  return ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & MASK;
}

/** SHA-256 涓诲惊鐜紙鏀寔浠庣 first_round 杞画璺戯級 */
function sha256Rounds(state, words, firstRound) {
  let [a, b, c, d, e, f, g, h] = state.map((x) => BigInt(x));
  const constants = (firstRound === 14 ? T._SHA256_BLOCK_CONSTANTS : T._SHA256_ROUND_CONSTANTS).map((x) => BigInt(x));
  const aligned = Math.min(64, Math.floor((firstRound + 7) / 8) * 8);

  for (let index = firstRound; index < aligned; index++) {
    const rotE = e * 0x100000001n;
    const rotA = a * 0x100000001n;
    const t1 =
      h +
      ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) +
      (g ^ (e & (f ^ g))) +
      constants[index] +
      words[index];
    const t2 = ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)));
    // Python: a,b,c,d,e,f,g,h = (t1+t2)&m, a, b, c, (d+t1)&m, e, f, g
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;
    const oldE = e;
    const oldF = f;
    const oldG = g;
    a = (t1 + t2) & MASK;
    b = oldA;
    c = oldB;
    d = oldC;
    e = (oldD + t1) & MASK;
    f = oldE;
    g = oldF;
    h = oldG;
  }

  for (let index = aligned; index < 64; index += 8) {
    // 8 轮一组，展开写（与 Python 版一一对应）
    let rot = e * 0x100000001n;
    let rotA = a * 0x100000001n;
    let t1 = h + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (g ^ (e & (f ^ g))) + constants[index] + words[index];
    d = (d + t1) & MASK;
    h = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)))) & MASK;

    rot = d * 0x100000001n;
    rotA = h * 0x100000001n;
    t1 = g + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (f ^ (d & (e ^ f))) + constants[index + 1] + words[index + 1];
    c = (c + t1) & MASK;
    g = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((h & a) | (b & (h | a)))) & MASK;

    rot = c * 0x100000001n;
    rotA = g * 0x100000001n;
    t1 = f + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (e ^ (c & (d ^ e))) + constants[index + 2] + words[index + 2];
    b = (b + t1) & MASK;
    f = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((g & h) | (a & (g | h)))) & MASK;

    rot = b * 0x100000001n;
    rotA = f * 0x100000001n;
    t1 = e + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (d ^ (b & (c ^ d))) + constants[index + 3] + words[index + 3];
    a = (a + t1) & MASK;
    e = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((f & g) | (h & (f | g)))) & MASK;

    rot = a * 0x100000001n;
    rotA = e * 0x100000001n;
    t1 = d + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (c ^ (a & (b ^ c))) + constants[index + 4] + words[index + 4];
    h = (h + t1) & MASK;
    d = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((e & f) | (g & (e | f)))) & MASK;

    rot = h * 0x100000001n;
    rotA = d * 0x100000001n;
    t1 = c + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (b ^ (h & (a ^ b))) + constants[index + 5] + words[index + 5];
    g = (g + t1) & MASK;
    c = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((d & e) | (f & (d | e)))) & MASK;

    rot = g * 0x100000001n;
    rotA = c * 0x100000001n;
    t1 = b + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (a ^ (g & (h ^ a))) + constants[index + 6] + words[index + 6];
    f = (f + t1) & MASK;
    b = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((c & d) | (e & (c | d)))) & MASK;

    rot = f * 0x100000001n;
    rotA = b * 0x100000001n;
    t1 = a + ((rot >> 6n) ^ (rot >> 11n) ^ (rot >> 25n)) + (h ^ (f & (g ^ h))) + constants[index + 7] + words[index + 7];
    e = (e + t1) & MASK;
    a = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((b & c) | (d & (b | c)))) & MASK;
  }
  return [a, b, c, d, e, f, g, h];
}

/** 鎵╁睍 SHA-256 鐨勬秷鎭皟搴?*/
function expandSchedule(words, firstWord) {
  for (let index = firstWord; index < 64; index++) {
    const x = BigInt(words[index - 2]);
    const y = BigInt(words[index - 15]);
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push((s1 + BigInt(words[index - 7]) + s0 + BigInt(words[index - 16])) & MASK);
  }
}

/** 鐢卞墠 7 瀛楄妭鐩愮畻鍑哄垵濮嬬姸鎬?*/
function sha256Init(data) {
  const words = [];
  for (let i = 0; i < 14; i++) words.push(0n);
  words.push(BigInt(data.readUIntBE(0, 3)));
  words.push(BigInt(data.readUIntBE(3, 4)));
  for (let index = 16; index < 30; index++) {
    let value = BigInt(T._SHA256_SCHEDULE[index - 16]);
    if (index - 2 >= 14) {
      value += index === 16 ? sigma1(words[index - 2]) ^ BigInt(T._SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]);
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) {
      value += index === 29 ? sigma0(words[index - 15]) ^ BigInt(T._SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]);
    }
    words.push(value & MASK);
  }
  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      BigInt(T._SHA256_ADJUSTMENT) -
      BigInt(T._SHA256_ROUND_CONSTANTS[14])) &
      MASK
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(T._SHA256_STATE.map((x) => BigInt(x)), words, 14);
  return T._SHA256_INITIAL.map((x, i) => (BigInt(x) + working[i]) & MASK);
}

function sha256Digest(data) {
  if (data.length < 7) throw new Error('token salt 鑷冲皯瑕?7 瀛楄妭');
  const length = 57 + data.length;
  const zeroCount = (((55 - length) % 64) + 64) % 64; // Python-style modulo (non-negative)
  const padLen = 1 + zeroCount + 8;
  const padded = Buffer.alloc(data.length - 7 + padLen);
  data.copy(padded, 0, 7);
  padded[data.length - 7] = 0x80;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(length * 8));
  lenBuf.copy(padded, padded.length - 8);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) words.push(BigInt(padded.readUInt32BE(offset + i * 4)));
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, i) => (x + working[i]) & MASK);
  }
  const out = Buffer.alloc(32);
  state.forEach((x, i) => out.writeUInt32BE(Number(x), i * 4));
  return out;
}

/** CS64 鎽樿 */
function cs64Digest(data, digest) {
  let keyA = BigInt(digest.readUInt32LE(0)) | 1n;
  let keyB = BigInt(digest.readUInt32LE(4)) | 1n;
  const factor = BigInt(T._CS64_FACTOR);
  const factors = [(keyA * factor) & MASK, (keyB * factor) & MASK];
  const terms = [];
  const offsets = [];
  T._CS64_COEFFICIENTS.forEach((pair, index) => {
    const coefficient = BigInt(pair[0]);
    const offset = BigInt(pair[1]);
    terms.push((coefficient * factors[index % 2]) & MASK);
    offsets.push(offset);
  });

  const words = wordsLe4Even(Buffer.concat([Buffer.from([0]), data]));
  words.forEach((word, index) => {
    const w = BigInt(word);
    let term = w * (index % 2 === 0 ? keyA : keyB);
    let offset = rol16(w) * (index % 2 === 0 ? 0xef0569fbn : 0xc31713dbn);
    if (index === 0) {
      term += BigInt(T._CS64_ADJUSTMENT0) * factors[0];
      offset += BigInt(T._CS64_ADJUSTMENT1);
    }
    terms.push(term & MASK);
    offsets.push(offset & MASK);
  });

  let swapAcc = 0n;
  let swapLast = 0n;
  let state = 0n;
  let acc = 0n;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];
    let t = rol16((offsets[index] + x) & MASK);
    let q = (t * 0x76f50f34n) & MASK;
    swapAcc = (swapAcc + ((rol16(q) * 0xc3efea97n + q) & MASK)) & MASK;
    t = rol16((offsets[index + 1] + y) & MASK);
    q = (t * 0x1881ce3cn) & MASK;
    swapLast = (rol16(q) * 0x35bd1ec9n + q) & MASK;
    swapAcc = (swapAcc + swapLast) & MASK;

    state = (state * keyA + x) & MASK;
    state = (rol16(state) * 0xcf98b111n) & MASK;
    state = (rol16(state) * 0x87085b9fn) & MASK;
    state = (rol16(state) * 0x12ceb96dn) & MASK;
    state = (rol16(state) * 0x257e1d83n) & MASK;
    acc += state;
    t = (state * keyB + y) & MASK;
    t = (rol16(t) * 0xa27416f5n) & MASK;
    t = (rol16(t) * 0xd38396ffn) & MASK;
    state = (rol16((rol16(t) * 0x7c932b89n) & MASK) * 0xbfa49f69n) & MASK;
    acc = (acc + state) & MASK;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}

function tokenHash(data) {
  const digest = sha256Digest(data);
  const cs = cs64Digest(data, digest);
  const csBuf = Buffer.alloc(8);
  csBuf.writeUInt32LE(Number(cs[0] & MASK), 0);
  csBuf.writeUInt32LE(Number(cs[1] & MASK), 4);
  return { cs64: csBuf.toString('hex').toUpperCase(), sha256: digest.toString('hex').toUpperCase() };
}

/** 鐢熸垚 Sec-MS-GEC v2 浠ょ墝 */
function generateSecMsGecV2(unixTimestamp) {
  let ticks = unixTimestamp == null ? Date.now() / 1000 : Number(unixTimestamp);
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const toHash = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const { cs64, sha256 } = tokenHash(toHash);
  return `${cs64}-${sha256}`;
}

module.exports = { generateSecMsGecV2, TRUSTED_CLIENT_TOKEN, tokenHash, sha256Digest, cs64Digest, sha256Init };

