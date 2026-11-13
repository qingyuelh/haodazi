/**
 * 鲸鱼娘桌宠 · 设置页逻辑
 * 改动即时保存并推给桌宠窗口。
 */
'use strict';

const api = window.whale;
const C = window.WhaleCalc;

const $ = (id) => document.getElementById(id);

let config = null;
let saveTimer = null;

/* ------------------------------------------------------------ 表单读写 */

function fillForm(cfg) {
  config = cfg;
  $('workStart').value = cfg.workStart;
  $('workEnd').value = cfg.workEnd;
  $('monthlySalary').value = cfg.monthlySalary;
  $('paydayDay').value = String(cfg.paydayDay);
  $('announceHourly').checked = !!cfg.announceHourly;
  $('announceOnlyWhenWorking').checked = !!cfg.announceOnlyWhenWorking;
  $('upbeatText').checked = cfg.upbeatText !== false;
  $('speak').checked = !!cfg.speak;
  $('speakVolume').value = Math.round((cfg.speakVolume || 0) * 100);
  $('volText').textContent = Math.round((cfg.speakVolume || 0) * 100) + '%';
  $('speechRate').value = cfg.speechRate == null ? 24 : cfg.speechRate;
  $('rateText').textContent = $('speechRate').value + '%';
  $('speechPitch').value = cfg.speechPitch == null ? 30 : cfg.speechPitch;
  $('pitchText').textContent = $('speechPitch').value + 'Hz';
  $('systemRate').value = Math.round((cfg.systemRate == null ? 1.35 : cfg.systemRate) * 100);
  $('sysRateText').textContent = ($('systemRate').value / 100).toFixed(2);
  $('systemPitch').value = Math.round((cfg.systemPitch == null ? 1.7 : cfg.systemPitch) * 100);
  $('sysPitchText').textContent = ($('systemPitch').value / 100).toFixed(2);
  $('alwaysOnTop').checked = !!cfg.alwaysOnTop;
  $('autostart').checked = !!cfg.autostart;
  $('petScale').value = Math.round((cfg.petScale || 1) * 100);
  $('scaleText').textContent = Math.round((cfg.petScale || 1) * 100) + '%';

  const mode = document.querySelector('input[name="salaryMode"][value="' + cfg.salaryMode + '"]');
  if (mode) mode.checked = true;
  const vengine = document.querySelector('input[name="voiceEngine"][value="' + (cfg.voiceEngine || 'auto') + '"]');
  if (vengine) vengine.checked = true;

  if ($('edgeVoice')) $('edgeVoice').value = cfg.edgeVoice || 'zh-CN-XiaoyiNeural';
  if ($('systemVoice')) $('systemVoice').value = cfg.systemVoice || 'Microsoft Yaoyao - Chinese (Simplified, PRC)';
  refreshEngineRows();

  document.querySelectorAll('#weekBox input[type="checkbox"]').forEach((el) => {
    el.checked = (cfg.workdays || []).indexOf(Number(el.dataset.day)) !== -1;
  });

  refreshPreview();
}

function collectForm() {
  const workdays = [];
  document.querySelectorAll('#weekBox input[type="checkbox"]').forEach((el) => {
    if (el.checked) workdays.push(Number(el.dataset.day));
  });
  const modeEl = document.querySelector('input[name="salaryMode"]:checked');
  return {
    workStart: $('workStart').value || '09:00',
    workEnd: $('workEnd').value || '18:00',
    monthlySalary: Number($('monthlySalary').value) || 0,
    paydayDay: Number($('paydayDay').value) || 0,
    workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
    salaryMode: modeEl ? modeEl.value : 'month',
    announceHourly: $('announceHourly').checked,
    announceOnlyWhenWorking: $('announceOnlyWhenWorking').checked,
    speak: $('speak').checked,
    speakVolume: Number($('speakVolume').value) / 100,
    voiceEngine: (document.querySelector('input[name="voiceEngine"]:checked') || {}).value || 'auto',
    edgeVoice: $('edgeVoice') ? $('edgeVoice').value : 'zh-CN-XiaoyiNeural',
    systemVoice: $('systemVoice') ? $('systemVoice').value : 'Microsoft Yaoyao - Chinese (Simplified, PRC)',
    speechRate: Number($('speechRate').value),
    speechPitch: Number($('speechPitch').value),
    systemRate: Number($('systemRate').value) / 100,
    systemPitch: Number($('systemPitch').value) / 100,
    upbeatText: $('upbeatText').checked,
    alwaysOnTop: $('alwaysOnTop').checked,
    petScale: Number($('petScale').value) / 100,
  };
}

/** 引擎切换：不同引擎用不同的音色与参数面板 */
let piperAvailable = false;

function refreshEngineRows() {
  const engine = (document.querySelector('input[name="voiceEngine"]:checked') || {}).value || 'auto';
  const show = (id, on) => {
    const el = $(id);
    if (el) el.style.display = on ? '' : 'none';
  };
  const useEdge = engine === 'edge' || engine === 'auto';
  const useSystem = engine === 'system';
  show('rowEdgeVoice', useEdge);
  show('rowEdgeTune', engine !== 'system');
  show('rowSysVoice', useSystem);
  show('rowSysTune', useSystem);

  const hint = $('engineHint');
  if (!hint) return;
  if (engine === 'edge') {
    hint.textContent = '微软 Edge 的神经网络音色（联网即可，不用装任何东西）。语速/音调调得越高越活泼。';
  } else if (engine === 'piper') {
    hint.textContent = piperAvailable
      ? '随安装包附带的离线神经网络女声，断网也能播，语速可调。'
      : '没找到随包的离线语音模型（可能是安装包不完整）。';
  } else if (engine === 'system') {
    hint.textContent = 'Windows 自带的中文女声，完全离线，靠音调/语速调出活泼感。';
  } else {
    hint.textContent = piperAvailable
      ? '默认用 Edge 的元气少女音（联网）；断网自动切到随包的离线女声，不会哑。'
      : '默认用 Edge 的元气少女音（联网）；失败时回落到系统女声。';
  }
}

/* ------------------------------------------------------------ 预览 */

function refreshPreview() {
  if (!config) return;
  const now = new Date();
  const daily = C.dailySalary(config, now);
  const payday = C.paydayInfo(now, config);

  $('pvDaily').textContent = '¥ ' + daily.toFixed(2);
  $('pvPayday').textContent = payday.days + ' 天';
  $('pvFriday').textContent = C.fridayInfo(now) + ' 天';

  const days = C.workdaysInMonth(now.getFullYear(), now.getMonth(), config);
  $('salaryHint').textContent =
    config.salaryMode === 'fixed'
      ? `月薪 ${config.monthlySalary} 元 ÷ 固定 ${config.fixedWorkdays} 天 = 日薪 ¥ ${daily.toFixed(2)}`
      : `月薪 ${config.monthlySalary} 元 ÷ 本月 ${days} 个工作日 = 日薪 ¥ ${daily.toFixed(2)}`;

  const s = C.parseHM(config.workStart);
  const e = C.parseHM(config.workEnd);
  const cross = e !== null && s !== null && e <= s;
  $('shiftHint').textContent =
    `每天 ${config.workStart} — ${config.workEnd}（${cross ? '跨夜班' : '白班'}），` +
    `本月共 ${days} 个工作日；今天是${C.WEEKDAY_CN[now.getDay()]}，${C.isWorkday(now, config) ? '要上班' : '休息'}。`;
}

/* ------------------------------------------------------------ 保存 */

function flashSaved() {
  const el = $('saved');
  el.classList.add('is-on');
  setTimeout(() => el.classList.remove('is-on'), 1200);
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const patch = collectForm();
    const next = await api.saveConfig(patch);
    config = next;
    refreshPreview();
    flashSaved();
  }, 180);
}

/* ------------------------------------------------------------ 绑定 */

function bind() {
  ['workStart', 'workEnd', 'monthlySalary', 'paydayDay', 'speakVolume', 'petScale'].forEach((id) => {
    $(id).addEventListener('input', () => {
      if (id === 'speakVolume') $('volText').textContent = $('speakVolume').value + '%';
      if (id === 'petScale') $('scaleText').textContent = $('petScale').value + '%';
      save();
    });
    $(id).addEventListener('change', save);
  });

  ['announceHourly', 'announceOnlyWhenWorking', 'speak', 'alwaysOnTop', 'upbeatText'].forEach((id) => {
    $(id).addEventListener('change', save);
  });

  ['speechRate', 'speechPitch', 'systemRate', 'systemPitch', 'edgeVoice', 'systemVoice'].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener('input', () => {
      if (id === 'speechRate') $('rateText').textContent = $('speechRate').value + '%';
      if (id === 'speechPitch') $('pitchText').textContent = $('speechPitch').value + 'Hz';
      if (id === 'systemRate') $('sysRateText').textContent = ($('systemRate').value / 100).toFixed(2);
      if (id === 'systemPitch') $('sysPitchText').textContent = ($('systemPitch').value / 100).toFixed(2);
      save();
    });
    $(id).addEventListener('change', save);
  });

  document.querySelectorAll('input[name="voiceEngine"]').forEach((el) => {
    el.addEventListener('change', () => {
      refreshEngineRows();
      save();
    });
  });

  $('autostart').addEventListener('change', async () => {
    const on = $('autostart').checked;
    const next = await api.setAutostart(on);
    if (config) config.autostart = next;
    flashSaved();
  });

  document.querySelectorAll('#weekBox input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', save);
  });

  document.querySelectorAll('input[name="salaryMode"]').forEach((el) => {
    el.addEventListener('change', save);
  });

  $('btnAnnounce').addEventListener('click', () => {
    api.announceNow();
    flashSaved();
  });

  $('btnShow').addEventListener('click', () => api.toggleVisible());

  $('btnReset').addEventListener('click', async () => {
    const defaults = await api.getDefaults();
    const next = await api.saveConfig(defaults);
    fillForm(next);
    flashSaved();
  });

  api.onConfigChanged((cfg) => {
    config = cfg;
    refreshPreview();
  });
}

/* ------------------------------------------------------------ 启动 */

function buildPaydayOptions() {
  const sel = $('paydayDay');
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '0';
  opt0.textContent = '月底（最后一天）';
  sel.appendChild(opt0);
  for (let d = 1; d <= 31; d++) {
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = d + ' 号';
    sel.appendChild(o);
  }
}

(async function init() {
  buildPaydayOptions();
  bind();

  // 语音引擎与音色列表
  try {
    const v = await api.voices();
    piperAvailable = !!v.piperAvailable;
    const fill = (sel, list, labeler) => {
      if (!sel || !list) return;
      sel.innerHTML = '';
      list.forEach((item) => {
        const o = document.createElement('option');
        o.value = item.id;
        o.textContent = labeler(item);
        sel.appendChild(o);
      });
    };
    fill($('edgeVoice'), v.edge, (x) => (x.desc ? x.name + ' · ' + x.desc : x.name));
    fill($('systemVoice'), v.system, (x) => x.name);
  } catch (err) {
    /* 忽略 */
  }

  fillForm(await api.getConfig());
  const state = await api.appState();
  $('verInfo').textContent = 'v' + state.version + (state.portable ? ' · 便携版' : '');
})();
