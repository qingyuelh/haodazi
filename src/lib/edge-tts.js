/**
 * Edge 在线 TTS（纯 Node 实现，不需要 Python）
 *
 * 之前是靠 python -m edge_tts 合成，换台电脑没装 Python 就哑了；
 * 这里把 edge-tts 的协议在 Node 里重写一遍：
 *   Sec-MS-GEC 令牌（自己实现的 gec.js，与 Python 版逐位一致）
 *   + WebSocket 直连 speech.platform.bing.com
 * 合成结果是 mp3，直接给渲染层播。
 */
'use strict';

const crypto = require('crypto');
const { generateSecMsGecV2, TRUSTED_CLIENT_TOKEN } = require('./gec.js');

const CHROMIUM_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = '2-' + CHROMIUM_VERSION;
const WSS_BASE =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  '?TrustedClientToken=' +
  TRUSTED_CLIENT_TOKEN;

let WebSocketImpl = null;
function getWebSocket() {
  if (WebSocketImpl) return WebSocketImpl;
  try {
    WebSocketImpl = require('ws');
  } catch (err) {
    WebSocketImpl = null;
  }
  return WebSocketImpl;
}

function dateToString() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return (
    days[d.getUTCDay()] +
    ' ' +
    months[d.getUTCMonth()] +
    ' ' +
    p(d.getUTCDate()) +
    ' ' +
    d.getUTCFullYear() +
    ' ' +
    p(d.getUTCHours()) +
    ':' +
    p(d.getUTCMinutes()) +
    ':' +
    p(d.getUTCSeconds()) +
    ' GMT+0000 (Coordinated Universal Time)'
  );
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text, voice, rate, pitch, volume) {
  const pct = (v) => `${v >= 0 ? '+' : ''}${v}%`;
  const hz = (v) => `${v >= 0 ? '+' : ''}${v}Hz`;
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='${hz(pitch)}' rate='${pct(rate)}' volume='${pct(volume)}'>` +
    escapeXml(text) +
    '</prosody>' +
    '</voice>' +
    '</speak>'
  );
}

/**
 * 合成语音，返回 mp3 的 Buffer；失败返回 null
 * @param {string} text
 * @param {{voice?:string, rate?:number, pitch?:number, volume?:number, proxy?:string, timeout?:number}} opt
 */
function synthesize(text, opt = {}) {
  const WS = getWebSocket();
  if (!WS || !text) return Promise.resolve(null);

  const voice = opt.voice || 'zh-CN-XiaoyiNeural';
  const rate = Number.isFinite(opt.rate) ? Math.round(opt.rate) : 18;
  const pitch = Number.isFinite(opt.pitch) ? Math.round(opt.pitch) : 20;
  const volume = Number.isFinite(opt.volume) ? Math.round(opt.volume) : 0;
  const timeout = opt.timeout || 20000;

  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const chunks = [];
    let ws = null;
    const finish = (buf) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        if (ws && ws.readyState <= 1) ws.close();
      } catch (e) {
        /* 忽略 */
      }
      resolve(buf);
    };

    try {
      const gec = generateSecMsGecV2();
      const connectId = crypto.randomUUID().replace(/-/g, '');
      const url =
        WSS_BASE +
        `&ConnectionId=${connectId}` +
        `&Sec-MS-GEC=${gec}` +
        `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

      ws = new WS(url, {
        headers: {
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        },
      });
      if (process.env.WHALE_TTS_DEBUG) console.warn('[tts] URL:', url);
    } catch (err) {
      finish(null);
      return;
    }

    timer = setTimeout(() => finish(null), timeout);

    ws.on('open', () => {
      try {
        ws.send(
          `X-Timestamp:${dateToString()}\r\n` +
            'Content-Type:application/json; charset=utf-8\r\n' +
            'Path:speech.config\r\n\r\n' +
            '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
            '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"' +
            '},' +
            '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"' +
            '}}}}\r\n'        );
        const requestId = crypto.randomUUID().replace(/-/g, '');
        const ssml = buildSsml(text, voice, rate, pitch, volume);
        ws.send(
          `X-RequestId:${requestId}\r\n` +
            'Content-Type:application/ssml+xml\r\n' +
            `X-Timestamp:${dateToString()}Z\r\n` +
            'Path:ssml\r\n\r\n' +
            ssml
        );
      } catch (err) {
        finish(null);
      }
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Edge 的二进制帧格式：0x00 0x80 + 协议头文本("...\r\nPath:audio\r\n") + 音频数据
        // 直接当 mp3 用会解析失败，必须先剥掉前面的头
        const buf = Buffer.from(data);
        let start = 0;
        if (buf.length >= 2 && buf[0] === 0x00 && buf[1] === 0x80) start = 2;
        const head = buf.slice(start, start + 400).toString('latin1');
        const marker = head.indexOf('Path:audio');
        if (marker >= 0) {
          const nl = head.indexOf('\r\n', marker);
          start += nl >= 0 ? nl + 2 : marker + 'Path:audio'.length;
        } else {
          const sep = head.indexOf('\r\n\r\n');
          if (sep >= 0) start += sep + 4;
        }
        if (buf.length > start) chunks.push(buf.slice(start));
      } else {
        const text2 = data.toString();
        // 文本帧是元数据；出现 turn.end 表示合成结束
        if (text2.indexOf('turn.end') !== -1) {
          finish(chunks.length ? Buffer.concat(chunks) : null);
        }
      }
    });

    ws.on('error', (err) => {
      if (process.env.WHALE_TTS_DEBUG) console.warn('[tts] Edge TTS 连接失败：', err && err.message);
      finish(null);
    });
    ws.on('close', (code, reasonBuf) => {
      if (process.env.WHALE_TTS_DEBUG) {
        console.warn('[tts] Edge TTS 连接关闭：', code, (reasonBuf || '').toString().slice(0, 120), '收到字节:', chunks.length);
      }
      finish(chunks.length ? Buffer.concat(chunks) : null);
    });
  });
}

module.exports = { synthesize, buildSsml, dateToString };
