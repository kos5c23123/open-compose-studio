(function () {
  const E = window.Engine;
  const I = E.i18n;
  const t = E.t;
  const tx = E.tx;
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
  // 使用 index.html 內的 SVG sprite（#i-名稱）
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
    { id: 'face', num: '01', en: 'FACE', source: 'https://ai-portrait-gallery.pages.dev/', sourceName: 'AIモデル顔データベース' },
    { id: 'outfit', num: '02', en: 'OUTFIT', source: null, sourceName: null },
    { id: 'pose', num: '03', en: 'POSE', source: 'https://ai-pose-gallery.pages.dev/', sourceName: 'ポーズ集 POSE-DB-01' }
  ];
  const slotLabel = (id) => t(`slot.${id}`);
  // 舞台頂部的鏡頭讀數
  const READOUT = [['aspect', 'AR'], ['shot', 'SHOT'], ['lens', 'LENS'], ['aperture', 'F'], ['light', 'LIGHT'], ['style', 'STYLE']];
  const PAGE = 120;
  const STORE_KEY = 'compose-studio:v1';

  // 場景選項在目前介面語言下的名稱
  const groupName = (g) => (I.lang === 'en' ? g.en : g.zh);
  const optionName = (o) => {
    if (I.lang !== 'en') return o.zh;
    if (o.ui) return o.ui;
    return o.en.charAt(0).toUpperCase() + o.en.slice(1);
  };

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
      uiLang: null,
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
    } catch (e) { /* 無法使用 storage 時沿用預設值 */ }
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

  // ---------- 介面語言 ----------
  // HTML 內的固定文字以 data-i18n（文字）及 data-i18n-attr（屬性，格式為 "attr:key,attr:key"）標示
  function applyStatic() {
    const meta = I.langs.find((l) => l.id === I.lang);
    document.documentElement.lang = meta.html;
    document.title = t('doc.title');
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-attr]').forEach((n) => {
      for (const pair of n.dataset.i18nAttr.split(',')) {
        const [attr, key] = pair.split(':');
        n.setAttribute(attr.trim(), t(key.trim()));
      }
    });
    document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === I.lang));
    });
  }
  function setUiLang(id) {
    I.set(id);
    state.prefs.uiLang = I.lang;
    savePrefs();
    applyStatic();
    renderTabs();
    renderLibrary();
    renderSlots();
    renderPresets();
    renderReadout();
    renderEngineName();
    renderResult();
    if ($('#settingsDlg').open) renderSettings();
    $('#promptNote').textContent = state.promptEdited ? t('note.edited') : '';
    setStatus('');
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
      setStatus(t('status.noImages'), true);
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
    setStatus(t('status.loaded', { n: added, label: slotLabel(slot) }));
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
    }, icon(s.id), slotLabel(s.id), el('span', { class: 'count', text: state.libs[s.id].length || '' }))));
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
        ? el('p', {}, t('lib.dl.before'), el('a', { href: meta.source, target: '_blank', rel: 'noopener', text: meta.sourceName }), t('lib.dl.after'))
        : el('p', { text: t('lib.outfitHint') });
      box.replaceChildren(el('div', { class: 'empty' },
        el('div', { class: 'glyph-lg' }, icon(slot)),
        el('h3', { text: t(`lib.empty.${slot}`) }),
        desc,
        el('div', { class: 'actions' },
          el('button', { class: 'btn primary', onclick: () => pickFolder(slot) }, icon('folder'), t('lib.loadFolder')),
          el('button', { class: 'btn', onclick: () => pickFiles(slot) }, icon('images'), t('lib.pickFiles')))));
      return;
    }

    const folders = [...new Set(lib.map((i) => i.folder).filter(Boolean))];
    const f = state.filter[slot];

    const search = el('input', { type: 'search', placeholder: t('lib.searchPh'), value: f.q, 'aria-label': t('lib.search') });
    search.addEventListener('input', () => { f.q = search.value; state.page[slot] = 1; renderGrid(); });

    const toolbar = el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search'), search),
      folders.length > 1
        ? (() => {
            const sel = el('select', { class: 'pill-select', 'aria-label': t('lib.folder') },
              el('option', { value: '', text: t('lib.allFolders') }),
              ...folders.map((name) => el('option', { value: name, text: name, selected: f.folder === name })));
            sel.addEventListener('change', () => { f.folder = sel.value; state.page[slot] = 1; renderGrid(); });
            return sel;
          })()
        : null,
      el('button', { class: 'btn small', onclick: () => pickFolder(slot) }, icon('folder-plus'), t('lib.addFolder')),
      el('button', { class: 'btn small ghost', onclick: () => clearLibrary(slot) }, icon('trash'), t('lib.clear')),
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
      $('#shownCount').textContent = t('lib.count', { n: list.length });
      more.replaceChildren(list.length > page.length
        ? el('button', { class: 'btn', onclick: () => { state.page[slot]++; renderGrid(); } }, icon('chevron'), t('lib.more', { n: Math.min(PAGE, list.length - page.length) }))
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

  // ---------- 合成區的三格 ----------
  function renderSlots() {
    for (const s of SLOTS) {
      const host = document.querySelector(`.slot[data-slot="${s.id}"]`);
      const item = state.selected[s.id];
      const label = slotLabel(s.id);
      const head = el('div', { class: 'slot-label' },
        el('span', { class: 'num', text: s.num }),
        el('strong', { text: label }),
        el('span', { class: 'en', text: s.en }));
      const frame = el('button', {
        class: `slot-frame${item ? ' filled' : ''}${state.tab === s.id ? ' active' : ''}`,
        'aria-label': t('slot.aria', { label, name: item ? item.name : t('slot.none') }),
        onclick: () => setTab(s.id)
      }, item
        ? el('img', { src: thumbUrl(item), alt: '' })
        : el('span', { class: 'slot-empty' },
          el('span', { class: 'glyph' }, icon(s.id)),
          el('span', { text: t(`slot.pick.${s.id}`) })));
      const meta = el('div', { class: 'slot-meta' },
        el('span', { class: 'name', text: item ? item.name : t('slot.none'), title: item ? item.path : null }),
        item ? el('button', { class: 'clear', onclick: () => { state.selected[s.id] = null; renderSlots(); renderLibrary(); updatePrompt(); } }, icon('x'), t('slot.remove')) : null);
      host.replaceChildren(head, frame, meta);
    }
    updateGenerateButton();
  }

  // ---------- 場景選項 ----------
  function renderPresets() {
    const box = $('#presets');
    box.replaceChildren(...E.presets.map((g, i) => {
      const chosen = state.prefs.opts[g.id] || [];
      return el('div', { class: 'group' },
        el('h3', {}, el('span', { class: 'gi', text: String(i + 1).padStart(2, '0') }), groupName(g), g.max > 1 ? el('small', { text: t('scene.max', { n: g.max }) }) : null),
        el('div', { class: 'chips' }, ...g.options.map((o) => el('button', {
          class: 'chip', 'aria-pressed': String(chosen.includes(o.id)), title: o.en,
          onclick: () => toggleOpt(g, o.id)
        }, g.id === 'aspect' ? el('span', { class: 'ratio', style: `aspect-ratio:${o.id.replace(':', '/')}` }) : null, optionName(o)))));
    }));
  }
  function renderReadout() {
    const parts = [];
    for (const [id, tag] of READOUT) {
      const group = E.presets.find((g) => g.id === id);
      const ids = state.prefs.opts[id] || [];
      const first = group && group.options.find((o) => o.id === ids[0]);
      if (!first) continue;
      const name = optionName(first);
      parts.push(el('span', {}, el('b', { text: tag }), ids.length > 1 ? `${name} +${ids.length - 1}` : name));
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
      $('#promptNote').textContent = t('note.stale');
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

  // ---------- 生成 ----------
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
    setStatus(t('status.preparing'));

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
        state.history.unshift({ url: URL.createObjectURL(blob), blob, prompt, engine: adapter.id, time });
      }
      setStatus(t('status.done', { n: blobs.length }));
      renderResult();
    } catch (e) {
      if (e.name === 'AbortError') setStatus(t('status.cancelled'));
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
      frame.replaceChildren(el('img', { src: latest.url, alt: t('result.latest') }));
      frame.onclick = () => openViewer(latest);
      $('#resultMeta').textContent = tx(E.adapters.get(latest.engine).name);
    }
    $('#history').replaceChildren(...state.history.slice(1).map((h, i) => el('button', {
      'aria-label': t('history.item', { n: i + 1 }), onclick: () => openViewer(h)
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
      setStatus(t('status.copied'));
    } catch (e) {
      setStatus(t('status.copyFail'), true);
    }
  }

  async function enhance() {
    const btn = $('#enhance');
    const prompt = $('#prompt').value.trim();
    if (!prompt) return;
    btn.disabled = true;
    setStatus(t('status.enhancing'));
    try {
      const out = await E.enhancer.run(prompt, enhancerSettings());
      $('#prompt').value = out;
      state.promptEdited = true;
      $('#promptNote').textContent = t('note.enhanced');
      setStatus(t('status.enhanced'));
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
    const placeholder = tx(f.placeholder);
    const input = f.type === 'textarea'
      ? el('textarea', { id, rows: 6, placeholder, spellcheck: 'false' })
      : el('input', { id, type: f.type === 'password' ? 'password' : 'text', placeholder, autocomplete: 'off', spellcheck: 'false' });
    input.value = store[f.key] != null ? store[f.key] : '';
    input.addEventListener('input', () => { store[f.key] = input.value; savePrefs(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: tx(f.label) }), input);
  }

  function renderSettings() {
    const list = $('#engineList');
    list.replaceChildren(...E.adapters.all().map((a) => {
      const radio = el('input', { type: 'radio', name: 'engine', value: a.id, checked: state.prefs.engine === a.id });
      radio.addEventListener('change', () => { state.prefs.engine = a.id; savePrefs(); renderSettings(); renderEngineName(); });
      return el('label', { class: 'engine' }, radio,
        el('span', { class: 'eico' }, icon(a.kind === 'local' ? 'cpu' : 'cloud')),
        el('span', { class: 'etext' }, el('strong', { text: tx(a.name) }), el('small', { text: t(a.kind === 'local' ? 'kind.local' : 'kind.cloud') })));
    }));
    const a = E.adapters.get(state.prefs.engine);
    $('#engineHelp').textContent = tx(a.help);
    const s = engineSettings(a.id);
    $('#engineFields').replaceChildren(...a.fields.map((f) => fieldInput(f, s)));
    const es = enhancerSettings();
    $('#enhancerFields').replaceChildren(...E.enhancer.fields.map((f) => fieldInput(f, es)));
    $('#remember').checked = !!state.prefs.remember;
  }
  function renderEngineName() {
    const a = E.adapters.get(state.prefs.engine);
    $('#engineName').textContent = tx(a.name);
    $('#engineIcon').setAttribute('href', a.kind === 'local' ? '#i-cpu' : '#i-cloud');
  }

  // ---------- 啟動 ----------
  function init() {
    loadPrefs();
    I.set(state.prefs.uiLang || I.detect());
    applyStatic();
    $('#lang').value = state.prefs.lang;
    $('#keepHair').checked = !!state.prefs.keepHair;

    renderTabs();
    renderLibrary();
    renderSlots();
    renderPresets();
    renderReadout();
    renderEngineName();
    updatePrompt(true);

    document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => {
      b.addEventListener('click', () => { if (b.dataset.lang !== I.lang) setUiLang(b.dataset.lang); });
    });
    $('#folderInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#filesInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#generate').addEventListener('click', generate);
    $('#cancel').addEventListener('click', () => state.abort && state.abort.abort());
    $('#copyPrompt').addEventListener('click', () => copy($('#prompt').value));
    $('#resetPrompt').addEventListener('click', () => updatePrompt(true));
    $('#enhance').addEventListener('click', enhance);
    $('#prompt').addEventListener('input', () => { state.promptEdited = true; $('#promptNote').textContent = t('note.edited'); updateGenerateButton(); });
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
