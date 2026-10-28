(function () {
  const E = window.Engine;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };
  // 用 index.html 入面嘅 SVG sprite（#i-名）
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const icon = (name) => {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'ico');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG_NS, 'use');
    u.setAttribute('href', `#i-${name}`);
    s.append(u);
    return s;
  };

  const SLOTS = [
    { id: 'face', num: '01', en: 'FACE', label: '人物', source: 'https://ai-portrait-gallery.pages.dev/', sourceName: 'AIモデル顔データベース' },
    { id: 'outfit', num: '02', en: 'OUTFIT', label: '服裝', source: null, sourceName: null },
    { id: 'pose', num: '03', en: 'POSE', label: '姿勢', source: 'https://ai-pose-gallery.pages.dev/', sourceName: 'ポーズ集 POSE-DB-01' }
  ];
  // 舞台頂嘅鏡頭讀數
  const READOUT = [['aspect', 'AR'], ['shot', 'SHOT'], ['lens', 'LENS'], ['aperture', 'F'], ['light', 'LIGHT'], ['style', 'STYLE']];
  const PAGE = 120;
  const STORE_KEY = 'compose-studio:v1';

  // ---------- 狀態 ----------
  const state = {
    libs: { face: [], outfit: [], pose: [] },
    selected: { face: null, outfit: null, pose: null },
    tab: 'face',
    filter: { face: { folder: '', q: '' }, outfit: { folder: '', q: '' }, pose: { folder: '', q: '' } },
    page: { face: 1, outfit: 1, pose: 1 },
    pendingSlot: 'face',
    promptEdited: false,
    history: [],
    abort: null,
    prefs: {
      engine: 'gemini',
      lang: 'en',
      keepHair: true,
      remember: false,
      opts: {},
      engines: {},
      enhancer: {}
    }
  };

  // ---------- 儲存 ----------
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(state.prefs, JSON.parse(raw));
    } catch (e) { /* 冇得用 storage 就用預設 */ }
    for (const g of E.presets) {
      if (!state.prefs.opts[g.id] && g.default) state.prefs.opts[g.id] = g.default.slice();
    }
  }
  function savePrefs() {
    const copy = JSON.parse(JSON.stringify(state.prefs));
    if (!copy.remember) {
      for (const id of Object.keys(copy.engines)) delete copy.engines[id].apiKey;
      delete copy.enhancer.apiKey;
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(copy)); } catch (e) { /* ignore */ }
  }
  function engineSettings(id) {
    const a = E.adapters.get(id);
    const s = state.prefs.engines[a.id] || (state.prefs.engines[a.id] = {});
    for (const f of a.fields) if (s[f.key] == null && f.default != null) s[f.key] = f.default;
    return s;
  }
  function enhancerSettings() {
    const s = state.prefs.enhancer;
    for (const f of E.enhancer.fields) if (s[f.key] == null && f.default != null) s[f.key] = f.default;
    return s;
  }

  // ---------- 狀態列 ----------
  function setStatus(msg, isError = false) {
    const s = $('#status');
    s.textContent = msg || '';
    s.classList.toggle('error', !!isError);
  }

  // ---------- 素材庫 ----------
  function addFiles(slot, fileList) {
    const files = Array.from(fileList).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    if (!files.length) {
      setStatus('嗰個資料夾入面搵唔到 PNG、JPG 或 WebP 圖片。', true);
      return;
    }
    const lib = state.libs[slot];
    const seen = new Set(lib.map((i) => i.id));
    let added = 0;
    for (const f of files) {
      const path = f.webkitRelativePath || f.name;
      const id = `${path}:${f.size}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const segs = path.split('/');
      const folder = segs.length > 2 ? segs[segs.length - 2] : segs.length === 2 ? segs[0] : '';
      lib.push({ id, file: f, path, folder, name: f.name.replace(/\.[^.]+$/, ''), url: null });
      added++;
    }
    lib.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    state.page[slot] = 1;
    setStatus(`載入咗 ${added} 張${SLOTS.find((s) => s.id === slot).label}圖。`);
    renderTabs();
    renderLibrary();
  }

  function clearLibrary(slot) {
    for (const item of state.libs[slot]) if (item.url) URL.revokeObjectURL(item.url);
    state.libs[slot] = [];
    if (state.selected[slot]) { state.selected[slot] = null; renderSlots(); updatePrompt(); }
    state.filter[slot] = { folder: '', q: '' };
    renderTabs();
    renderLibrary();
  }

  function thumbUrl(item) {
    if (!item.url) item.url = URL.createObjectURL(item.file);
    return item.url;
  }

  function filtered(slot) {
    const { folder, q } = state.filter[slot];
    const needle = q.trim().toLowerCase();
    return state.libs[slot].filter((i) =>
      (!folder || i.folder === folder) && (!needle || i.path.toLowerCase().includes(needle)));
  }

  function pickFolder(slot) {
    state.pendingSlot = slot;
    $('#folderInput').value = '';
    $('#folderInput').click();
  }
  function pickFiles(slot) {
    state.pendingSlot = slot;
    $('#filesInput').value = '';
    $('#filesInput').click();
  }

  function renderTabs() {
    const tabs = $('#tabs');
    tabs.replaceChildren(...SLOTS.map((s) => el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(state.tab === s.id),
      onclick: () => setTab(s.id)
    }, icon(s.id), s.label, el('span', { class: 'count', text: state.libs[s.id].length || '' }))));
  }

  function setTab(slot) {
    state.tab = slot;
    renderTabs();
    renderLibrary();
    renderSlots();
  }

  function renderLibrary() {
    const slot = state.tab;
    const meta = SLOTS.find((s) => s.id === slot);
    const box = $('#library');
    const lib = state.libs[slot];

    if (!lib.length) {
      const desc = meta.source
        ? el('p', {}, '去原站下載', el('a', { href: meta.source, target: '_blank', rel: 'noopener', text: meta.sourceName }), '嘅圖片，放入一個資料夾，再喺度載入。圖片只會留喺你部機。')
        : el('p', { text: '揀一個放咗服裝圖嘅資料夾。冇服裝圖都得，可以喺右邊用文字描述。' });
      box.replaceChildren(el('div', { class: 'empty' },
        el('div', { class: 'glyph-lg' }, icon(slot)),
        el('h3', { text: `未載入${meta.label}素材` }),
        desc,
        el('div', { class: 'actions' },
          el('button', { class: 'btn primary', onclick: () => pickFolder(slot) }, icon('folder'), '載入資料夾'),
          el('button', { class: 'btn', onclick: () => pickFiles(slot) }, icon('images'), '揀幾張圖'))));
      return;
    }

    const folders = [...new Set(lib.map((i) => i.folder).filter(Boolean))];
    const f = state.filter[slot];

    const search = el('input', { type: 'search', placeholder: '搜尋檔名，例如 P012、front', value: f.q, 'aria-label': '搜尋' });
    search.addEventListener('input', () => { f.q = search.value; state.page[slot] = 1; renderGrid(); });

    const toolbar = el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search'), search),
      folders.length > 1
        ? (() => {
            const sel = el('select', { class: 'pill-select', 'aria-label': '資料夾' },
              el('option', { value: '', text: '全部資料夾' }),
              ...folders.map((name) => el('option', { value: name, text: name, selected: f.folder === name })));
            sel.addEventListener('change', () => { f.folder = sel.value; state.page[slot] = 1; renderGrid(); });
            return sel;
          })()
        : null,
      el('button', { class: 'btn small', onclick: () => pickFolder(slot) }, icon('folder-plus'), '加資料夾'),
      el('button', { class: 'btn small ghost', onclick: () => clearLibrary(slot) }, icon('trash'), '清空'),
      el('span', { class: 'shown', id: 'shownCount' }));

    const grid = el('div', { class: 'grid', id: 'grid' });
    const more = el('div', { class: 'more', id: 'more' });
    box.replaceChildren(toolbar, grid, more);
    renderGrid();

    function renderGrid() {
      const list = filtered(slot);
      const page = list.slice(0, state.page[slot] * PAGE);
      const sel = state.selected[slot];
      grid.replaceChildren(...page.map((item) => el('button', {
        class: 'item', 'aria-pressed': String(!!sel && sel.id === item.id), title: item.path,
        onclick: () => select(slot, item)
      }, el('img', { src: thumbUrl(item), alt: item.name, loading: 'lazy', decoding: 'async' }),
        el('span', { class: 'item-name', 'aria-hidden': 'true', text: item.name }))));
      $('#shownCount').textContent = `${list.length} 張`;
      more.replaceChildren(list.length > page.length
        ? el('button', { class: 'btn', onclick: () => { state.page[slot]++; renderGrid(); } }, icon('chevron'), `顯示多 ${Math.min(PAGE, list.length - page.length)} 張`)
        : '');
    }
  }

  function select(slot, item) {
    const cur = state.selected[slot];
    state.selected[slot] = cur && cur.id === item.id ? null : item;
    renderSlots();
    document.querySelectorAll('#grid .item').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!state.selected[slot] && b.title === state.selected[slot].path));
    });
    updatePrompt();
  }

  // ---------- 算式上嘅三格 ----------
  function renderSlots() {
    for (const s of SLOTS) {
      const host = document.querySelector(`.slot[data-slot="${s.id}"]`);
      const item = state.selected[s.id];
      const label = el('div', { class: 'slot-label' },
        el('span', { class: 'num', text: s.num }),
        el('strong', { text: s.label }),
        el('span', { class: 'en', text: s.en }));
      const frame = el('button', {
        class: `slot-frame${item ? ' filled' : ''}${state.tab === s.id ? ' active' : ''}`,
        'aria-label': `${s.label}：${item ? item.name : '未揀'}，按一下喺下面揀`,
        onclick: () => setTab(s.id)
      }, item
        ? el('img', { src: thumbUrl(item), alt: '' })
        : el('span', { class: 'slot-empty' },
          el('span', { class: 'glyph' }, icon(s.id)),
          el('span', { text: s.id === 'outfit' ? '揀服裝圖，或者用文字描述' : `揀一張${s.label}圖` })));
      const meta = el('div', { class: 'slot-meta' },
        el('span', { class: 'name', text: item ? item.name : '未揀', title: item ? item.path : null }),
        item ? el('button', { class: 'clear', onclick: () => { state.selected[s.id] = null; renderSlots(); renderLibrary(); updatePrompt(); } }, icon('x'), '移除') : null);
      host.replaceChildren(label, frame, meta);
    }
    updateGenerateButton();
  }

  // ---------- 場景選項 ----------
  function renderPresets() {
    const box = $('#presets');
    box.replaceChildren(...E.presets.map((g, i) => {
      const chosen = state.prefs.opts[g.id] || [];
      return el('div', { class: 'group' },
        el('h3', {}, el('span', { class: 'gi', text: String(i + 1).padStart(2, '0') }), g.label, g.max > 1 ? el('small', { text: `最多 ${g.max} 個` }) : null),
        el('div', { class: 'chips' }, ...g.options.map((o) => el('button', {
          class: 'chip', 'aria-pressed': String(chosen.includes(o.id)), title: o.en,
          onclick: () => toggleOpt(g, o.id)
        }, g.id === 'aspect' ? el('span', { class: 'ratio', style: `aspect-ratio:${o.id.replace(':', '/')}` }) : null, o.zh))));
    }));
  }
  function renderReadout() {
    const parts = [];
    for (const [id, tag] of READOUT) {
      const group = E.presets.find((g) => g.id === id);
      const ids = state.prefs.opts[id] || [];
      const first = group && group.options.find((o) => o.id === ids[0]);
      if (!first) continue;
      parts.push(el('span', {}, el('b', { text: tag }), ids.length > 1 ? `${first.zh} +${ids.length - 1}` : first.zh));
    }
    $('#readout').replaceChildren(...parts);
  }
  function toggleOpt(g, id) {
    let cur = (state.prefs.opts[g.id] || []).slice();
    if (cur.includes(id)) {
      if (g.required && cur.length === 1) return;
      cur = cur.filter((x) => x !== id);
    } else if (g.max === 1) {
      cur = [id];
    } else {
      cur.push(id);
      if (cur.length > g.max) cur.shift();
    }
    state.prefs.opts[g.id] = cur;
    savePrefs();
    renderPresets();
    renderReadout();
    updatePrompt();
  }

  // ---------- Prompt ----------
  function orderedRefs() {
    return ['face', 'outfit', 'pose'].filter((r) => state.selected[r]).map((role) => ({ role, item: state.selected[role] }));
  }
  function currentText() {
    return { outfit: $('#outfitText').value, hair: $('#hairText').value, extra: $('#extraText').value };
  }
  function buildPrompt() {
    return E.buildPrompt({
      refs: orderedRefs(),
      opts: state.prefs.opts,
      text: currentText(),
      keepHair: state.prefs.keepHair,
      lang: state.prefs.lang
    });
  }
  function updatePrompt(force = false) {
    if (state.promptEdited && !force) {
      $('#promptNote').textContent = '你改過 prompt，揀嘅嘢未有套用。按「重新生成」更新。';
      updateGenerateButton();
      return;
    }
    $('#prompt').value = buildPrompt();
    state.promptEdited = false;
    $('#promptNote').textContent = '';
    updateGenerateButton();
  }
  function updateGenerateButton() {
    const hasPrompt = $('#prompt').value.trim().length > 0;
    $('#generate').disabled = !!state.abort || !hasPrompt || orderedRefs().length === 0;
  }

  // ---------- 出圖 ----------
  async function prepareImage(file, maxSide = 1536) {
    const bmp = await createImageBitmap(file);
    const long = Math.max(bmp.width, bmp.height);
    const mime = /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg';
    if (long <= maxSide) { bmp.close(); return { blob: file, mime: file.type || mime, name: file.name }; }
    const k = maxSide / long;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    return { blob, mime: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '.jpg') };
  }

  async function generate() {
    const adapter = E.adapters.get(state.prefs.engine);
    const refs = orderedRefs();
    const prompt = $('#prompt').value.trim();
    const aspect = (state.prefs.opts.aspect || ['3:4'])[0];
    if (!refs.length || !prompt) return;

    const ctrl = new AbortController();
    state.abort = ctrl;
    $('#cancel').hidden = false;
    $('#resultFrame').classList.add('busy');
    updateGenerateButton();
    setStatus('準備緊…');

    try {
      const images = [];
      for (const r of refs) images.push({ role: r.role, ...(await prepareImage(r.item.file)) });
      const blobs = await adapter.generate({
        prompt, images, aspect,
        size: E.sizeFor(aspect),
        settings: engineSettings(adapter.id),
        signal: ctrl.signal,
        onStatus: (m) => setStatus(m)
      });
      const time = new Date();
      for (const blob of blobs) {
        state.history.unshift({ url: URL.createObjectURL(blob), blob, prompt, engine: adapter.name, time });
      }
      setStatus(`完成，出咗 ${blobs.length} 張。`);
      renderResult();
    } catch (e) {
      if (e.name === 'AbortError') setStatus('已取消。');
      else setStatus(e.message || String(e), true);
    } finally {
      state.abort = null;
      $('#cancel').hidden = true;
      $('#resultFrame').classList.remove('busy');
      updateGenerateButton();
    }
  }

  function renderResult() {
    const latest = state.history[0];
    const frame = $('#resultFrame');
    if (latest) {
      frame.disabled = false;
      frame.classList.add('filled');
      frame.replaceChildren(el('img', { src: latest.url, alt: '最新結果' }));
      frame.onclick = () => openViewer(latest);
      $('#resultMeta').textContent = latest.engine;
    }
    $('#history').replaceChildren(...state.history.slice(1).map((h, i) => el('button', {
      'aria-label': `第 ${i + 2} 新嘅結果`, onclick: () => openViewer(h)
    }, el('img', { src: h.url, alt: '' }))));
  }

  function openViewer(h) {
    $('#viewerImg').src = h.url;
    $('#viewerPrompt').textContent = h.prompt;
    const a = $('#viewerDownload');
    a.href = h.url;
    const stamp = h.time.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `compose-${stamp}.${h.blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;
    $('#viewerCopy').onclick = () => copy(h.prompt);
    $('#viewerDlg').showModal();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已複製 prompt。');
    } catch (e) {
      setStatus('瀏覽器唔俾複製，請手動揀字複製。', true);
    }
  }

  async function enhance() {
    const btn = $('#enhance');
    const prompt = $('#prompt').value.trim();
    if (!prompt) return;
    btn.disabled = true;
    setStatus('本地 LLM 潤飾緊…');
    try {
      const out = await E.enhancer.run(prompt, enhancerSettings());
      $('#prompt').value = out;
      state.promptEdited = true;
      $('#promptNote').textContent = '已用本地 LLM 潤飾。';
      setStatus('潤飾完成。');
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      btn.disabled = false;
      updateGenerateButton();
    }
  }

  // ---------- 設定 ----------
  function fieldInput(f, store) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    const input = f.type === 'textarea'
      ? el('textarea', { id, rows: 6, placeholder: f.placeholder || '', spellcheck: 'false' })
      : el('input', { id, type: f.type === 'password' ? 'password' : 'text', placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
    input.value = store[f.key] != null ? store[f.key] : '';
    input.addEventListener('input', () => { store[f.key] = input.value; savePrefs(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: f.label }), input);
  }

  function renderSettings() {
    const list = $('#engineList');
    list.replaceChildren(...E.adapters.all().map((a) => {
      const radio = el('input', { type: 'radio', name: 'engine', value: a.id, checked: state.prefs.engine === a.id });
      radio.addEventListener('change', () => { state.prefs.engine = a.id; savePrefs(); renderSettings(); renderEngineName(); });
      return el('label', { class: 'engine' }, radio,
        el('span', { class: 'eico' }, icon(a.kind === 'local' ? 'cpu' : 'cloud')),
        el('span', { class: 'etext' }, el('strong', { text: a.name }), el('small', { text: a.kind === 'local' ? 'LOCAL' : 'CLOUD' })));
    }));
    const a = E.adapters.get(state.prefs.engine);
    $('#engineHelp').textContent = a.help || '';
    const s = engineSettings(a.id);
    $('#engineFields').replaceChildren(...a.fields.map((f) => fieldInput(f, s)));
    const es = enhancerSettings();
    $('#enhancerFields').replaceChildren(...E.enhancer.fields.map((f) => fieldInput(f, es)));
    $('#remember').checked = !!state.prefs.remember;
  }
  function renderEngineName() {
    const a = E.adapters.get(state.prefs.engine);
    $('#engineName').textContent = a.name;
    $('#engineIcon').setAttribute('href', a.kind === 'local' ? '#i-cpu' : '#i-cloud');
  }

  // ---------- 啟動 ----------
  function init() {
    loadPrefs();
    $('#lang').value = state.prefs.lang;
    $('#keepHair').checked = !!state.prefs.keepHair;

    renderTabs();
    renderLibrary();
    renderSlots();
    renderPresets();
    renderReadout();
    renderEngineName();
    updatePrompt(true);

    $('#folderInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#filesInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#generate').addEventListener('click', generate);
    $('#cancel').addEventListener('click', () => state.abort && state.abort.abort());
    $('#copyPrompt').addEventListener('click', () => copy($('#prompt').value));
    $('#resetPrompt').addEventListener('click', () => updatePrompt(true));
    $('#enhance').addEventListener('click', enhance);
    $('#prompt').addEventListener('input', () => { state.promptEdited = true; $('#promptNote').textContent = '你改過 prompt。'; updateGenerateButton(); });
    for (const id of ['#outfitText', '#hairText', '#extraText']) $(id).addEventListener('input', () => updatePrompt());
    $('#keepHair').addEventListener('change', (e) => { state.prefs.keepHair = e.target.checked; savePrefs(); updatePrompt(); });
    $('#lang').addEventListener('change', (e) => { state.prefs.lang = e.target.value; savePrefs(); updatePrompt(true); });
    $('#remember').addEventListener('change', (e) => { state.prefs.remember = e.target.checked; savePrefs(); });

    const openSettings = () => { renderSettings(); $('#settingsDlg').showModal(); };
    $('#openSettings').addEventListener('click', openSettings);
    $('#engineBtn').addEventListener('click', openSettings);
    $('#openSources').addEventListener('click', () => $('#sourcesDlg').showModal());
    document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  }

  init();
})();
