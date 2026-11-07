// 「圖片分析」頁：上載一張參考圖，用視覺模型反推服裝或姿勢 prompt。
// 只負責介面；API 呼叫在 js/vision.js。
window.Engine = window.Engine || {};

(function () {
  const state = { mode: 'outfit', file: null, preview: null, result: null, busy: false, abort: null };
  let ui = null; // { el, icon, t, setStatus, visionSettings, useOutfit, usePose }
  let nodes = null;

  const $ = (sel) => document.querySelector(sel);

  const t = (key, vars) => ui.t(key, vars);

  function modeName(mode) {
    return t(`an.mode.${mode}`);
  }

  function renderModes() {
    nodes.mode.replaceChildren(...['outfit', 'pose'].map((m) => ui.el('button', {
      type: 'button', 'aria-pressed': String(state.mode === m), disabled: state.busy, onclick: () => setMode(m)
    }, ui.icon(m), modeName(m))));
  }

  function renderSide() {
    nodes.lede.textContent = t(`an.lede.${state.mode}`);
    nodes.steps.replaceChildren(...[1, 2, 3].map((n) => ui.el('li', { text: t(`an.step${n}`) })));
    nodes.use.replaceChildren(ui.icon('arrow-out'), ui.el('span', { text: t(`an.use.${state.mode}`) }));
    nodes.useHint.textContent = t(`an.useHint.${state.mode}`);
    nodes.use.hidden = !state.result;
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    state.result = null;
    nodes.result.hidden = true;
    nodes.badge.textContent = '';
    renderModes();
    renderSide();
    nodes.note.textContent = '';
  }

  function setFile(file) {
    if (!file || state.busy) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      nodes.note.textContent = t('status.noImages');
      return;
    }
    if (state.preview) URL.revokeObjectURL(state.preview);
    state.file = file;
    state.preview = URL.createObjectURL(file);
    nodes.preview.src = state.preview;
    nodes.preview.hidden = false;
    nodes.empty.hidden = true;
    nodes.run.disabled = false;
    nodes.clear.hidden = false;
    nodes.result.hidden = true;
    state.result = null;
    nodes.note.textContent = t('an.ready');
  }

  function clear() {
    if (state.abort) state.abort.abort();
    if (state.preview) URL.revokeObjectURL(state.preview);
    state.file = null;
    state.preview = null;
    state.result = null;
    nodes.preview.removeAttribute('src');
    nodes.preview.hidden = true;
    nodes.empty.hidden = false;
    nodes.run.disabled = true;
    nodes.clear.hidden = true;
    nodes.result.hidden = true;
    nodes.badge.textContent = '';
    nodes.note.textContent = '';
  }

  function showResult(res) {
    state.result = res;
    nodes.en.value = res.en;
    nodes.zh.value = res.zh;
    nodes.tags.replaceChildren(...res.tags.map((x) => ui.el('span', { class: 'chip', text: x })));
    nodes.result.hidden = false;
    const s = ui.visionSettings();
    nodes.badge.textContent = `${t(`an.provider.${s.provider}`)} · ${s.model || ''}`;
    renderSide();
    nodes.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function run() {
    if (!state.file || state.busy) return;
    const settings = ui.visionSettings();
    const mode = state.mode;
    const ctrl = new AbortController();
    state.abort = ctrl;
    state.busy = true;
    renderModes();
    nodes.run.disabled = true;
    nodes.result.hidden = true;
    nodes.note.textContent = t('an.reading');
    ui.setStatus(t('an.reading'));
    try {
      const res = await Engine.vision.analyse({ file: state.file, mode, settings, signal: ctrl.signal });
      if (state.mode !== mode) return;
      showResult(res);
      nodes.note.textContent = t('an.done');
      ui.setStatus(t('an.done'));
    } catch (e) {
      if (e.name === 'AbortError') nodes.note.textContent = t('status.cancelled');
      else {
        nodes.note.textContent = e.message || String(e);
        ui.setStatus(e.message || String(e), true);
      }
    } finally {
      state.busy = false;
      state.abort = null;
      renderModes();
      nodes.run.disabled = !state.file;
    }
  }

  async function copyValue(value) {
    try {
      await navigator.clipboard.writeText(value);
      nodes.note.textContent = t('an.copied');
      ui.setStatus(t('an.copied'));
    } catch (e) {
      nodes.note.textContent = t('an.copyFail');
      ui.setStatus(t('an.copyFail'), true);
    }
  }

  function useResult() {
    if (!state.result) return;
    const text = state.result.en || state.result.zh;
    if (!text) return;
    if (state.mode === 'outfit') ui.useOutfit(text);
    else ui.usePose(text);
    ui.setStatus(t('an.used'));
  }

  function openPicker() {
    nodes.input.value = '';
    nodes.input.click();
  }

  function init(opts) {
    ui = opts;
    nodes = {
      page: $('#pageAnalyse'),
      mode: $('#anMode'),
      drop: $('#anDrop'),
      input: $('#anInput'),
      pick: $('#anPick'),
      preview: $('#anPreview'),
      empty: $('#anEmpty'),
      lede: $('#anLede'),
      steps: $('#anSteps'),
      run: $('#anRun'),
      clear: $('#anClear'),
      note: $('#anNote'),
      result: $('#anResult'),
      badge: $('#anBadge'),
      en: $('#anEn'),
      zh: $('#anZh'),
      tags: $('#anTags'),
      use: $('#anUse'),
      useHint: $('#anUseHint')
    };
    if (!nodes.page) return;

    renderModes();
    renderSide();

    nodes.pick.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
    nodes.drop.addEventListener('click', (e) => {
      if (e.target === nodes.input || e.target.closest('#anPick')) return;
      openPicker();
    });
    nodes.drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
    });
    nodes.input.addEventListener('change', () => setFile(nodes.input.files && nodes.input.files[0]));
    nodes.run.addEventListener('click', run);
    nodes.clear.addEventListener('click', (e) => { e.stopPropagation(); clear(); });
    nodes.use.addEventListener('click', useResult);
    $('#anCopyEn').addEventListener('click', () => copyValue(nodes.en.value));
    $('#anCopyZh').addEventListener('click', () => copyValue(nodes.zh.value));

    // 拖放
    for (const type of ['dragenter', 'dragover']) {
      nodes.drop.addEventListener(type, (e) => { e.preventDefault(); nodes.drop.classList.add('drag'); });
    }
    for (const type of ['dragleave', 'drop']) {
      nodes.drop.addEventListener(type, (e) => { e.preventDefault(); nodes.drop.classList.remove('drag'); });
    }
    nodes.drop.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    // 貼上（只在這一頁可見時）
    document.addEventListener('paste', (e) => {
      if (nodes.page.hidden) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); setFile(file); return; }
        }
      }
    });
  }

  // 介面語言改變後重新繪製動態文字
  function refresh() {
    if (!nodes) return;
    renderModes();
    renderSide();
    if (state.result) {
      const s = ui.visionSettings();
      nodes.badge.textContent = `${t(`an.provider.${s.provider}`)} · ${s.model || ''}`;
    }
  }

  Engine.analyse = { init, refresh, clear };

  Engine.i18n.add({
    zh: {
      'page.analyse': '圖片分析',
      'an.title': '由圖片反推 prompt',
      'an.mode': '分析類型',
      'an.mode.outfit': '服裝',
      'an.mode.pose': '姿勢',
      'an.drop': '上載參考圖',
      'an.dropTitle': '把參考圖拖到這裡',
      'an.dropHint': '也可以貼上（⌘V / Ctrl+V），或按下面的按鈕',
      'an.pick': '選擇圖片',
      'an.run': '分析',
      'an.clear': '清除',
      'an.copy': '複製',
      'an.result': '分析結果',
      'an.en': 'English prompt',
      'an.zh': '中文 prompt',
      'an.use': '帶到 Prompt',
      'an.use.outfit': '帶到「服裝描述」',
      'an.use.pose': '帶到「姿勢描述」',
      'an.useHint.outfit': '會清除已選的服裝圖，改用這段文字。',
      'an.useHint.pose': '會清除已選的姿勢圖，改用這段文字。',
      'an.lede.outfit': '睇相入面的衫，抽出款式、顏色、材質同配飾，砌成可以直接貼落 prompt 的描述。唔會理人物、姿勢同背景。',
      'an.lede.pose': '睇相入面的身體姿勢，抽出企姿、手腳位置同鏡頭角度，砌成姿勢 prompt。唔會理衫、人物同背景。',
      'an.step1': '加入一張參考圖',
      'an.step2': '按「分析」，用你在設定揀的視覺模型',
      'an.step3': '複製 prompt，或直接帶到 Prompt 頁',
      'an.ready': '已加入圖片，可以分析。',
      'an.reading': '分析中…',
      'an.done': '分析完成。',
      'an.copied': '已複製。',
      'an.copyFail': '瀏覽器封鎖了複製，請手動選取文字。',
      'an.used': '已帶到 Prompt。',
      'an.provider.gemini': 'Gemini',
      'an.provider.openai': 'OpenAI',
      'an.provider.grok': 'Grok',
      'an.provider.local': '本地模型',
      'set.vision': '圖片分析（Vision）',
      'set.visionHelp': '「圖片分析」頁用它反推服裝或姿勢 prompt。雲端服務會沿用上面對應引擎的 API key；本地模型可使用下方 Enhancer 的地址。',
      'vision.provider': '分析服務',
      'vision.model': '視覺模型',
      'vision.modelPh': '留空使用預設：{model}',
      'vision.baseUrl': '本地模型地址',
      'vision.baseUrlPh': '留空使用 Enhancer 的地址',
      'vision.local': '本地（OpenAI 相容）'
    },
    en: {
      'page.analyse': 'Analyse',
      'an.title': 'Image → prompt',
      'an.mode': 'What to read',
      'an.mode.outfit': 'Outfit',
      'an.mode.pose': 'Pose',
      'an.drop': 'Upload a reference image',
      'an.dropTitle': 'Drop a reference image here',
      'an.dropHint': 'You can also paste it (⌘V / Ctrl+V) or use the button below',
      'an.pick': 'Choose image',
      'an.run': 'Analyse',
      'an.clear': 'Clear',
      'an.copy': 'Copy',
      'an.result': 'Result',
      'an.en': 'English prompt',
      'an.zh': 'Chinese prompt',
      'an.use': 'Send to Prompt',
      'an.use.outfit': 'Use as outfit description',
      'an.use.pose': 'Use as pose description',
      'an.useHint.outfit': 'Clears the selected outfit image and uses this text instead.',
      'an.useHint.pose': 'Clears the selected pose image and uses this text instead.',
      'an.lede.outfit': 'Read the clothing only: garments, colours, materials and accessories, written as a prompt you can paste. It ignores the person, pose and background.',
      'an.lede.pose': 'Read the body pose only: stance, limb positions and camera angle, written as a pose prompt. It ignores the clothing, person and background.',
      'an.step1': 'Add a reference image',
      'an.step2': 'Press "Analyse" to use the vision model chosen in Settings',
      'an.step3': 'Copy the prompt, or send it to the Prompt page',
      'an.ready': 'Image ready to analyse.',
      'an.reading': 'Analysing…',
      'an.done': 'Done.',
      'an.copied': 'Copied.',
      'an.copyFail': 'The browser blocked copying. Select the text and copy it manually.',
      'an.used': 'Sent to the Prompt page.',
      'an.provider.gemini': 'Gemini',
      'an.provider.openai': 'OpenAI',
      'an.provider.grok': 'Grok',
      'an.provider.local': 'Local model',
      'set.vision': 'Image analysis (Vision)',
      'set.visionHelp': 'Used by the Analyse page to turn a reference image into an outfit or pose prompt. Cloud providers reuse the matching engine API key above; a local model can use the Enhancer address below.',
      'vision.provider': 'Analysis service',
      'vision.model': 'Vision model',
      'vision.modelPh': 'Leave empty for {model}',
      'vision.baseUrl': 'Local model URL',
      'vision.baseUrlPh': 'Leave empty to use the Enhancer URL',
      'vision.local': 'Local (OpenAI-compatible)'
    }
  });
})();
