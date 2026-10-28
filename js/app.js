(function () {
  const E = window.Engine;
  const I = E.i18n;
  const C = E.catalog;
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
    filter: {},
    poseAngle: {},
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

  for (const s of SLOTS) state.filter[s.id] = emptyFilter();

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
    E.organizer.refresh();
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
  function emptyFilter() {
    return { folder: '', q: '', series: '', cat: '', angle: '', section: '', hair: '', view: 'pose' };
  }

  async function addFiles(slot, fileList) {
    const all = Array.from(fileList);
    const files = all.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    // 資料夾內如有從原站儲存的分類資料檔，一併讀取
    const metaFiles = all.filter((f) => /\.(html?|js|json)$/i.test(f.name) && f.size < 8 * 1024 * 1024);
    const metaMsgs = [];
    for (const f of metaFiles) {
      const res = await importMetaFile(f);
      if (res) metaMsgs.push(metaStatus(res));
    }
    if (!files.length) {
      if (metaMsgs.length) { setStatus(metaMsgs.join(' ')); renderLibrary(); }
      else setStatus(t('status.noImages'), true);
      return;
    }
    const added = addItems(slot, files);
    setStatus([t('status.loaded', { n: added, label: slotLabel(slot) }), ...metaMsgs].join(' '));
    renderTabs();
    renderLibrary();
  }

  function addItems(slot, files) {
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
      const name = f.name.replace(/\.[^.]+$/, '');
      lib.push({ id, file: f, path, folder, name, info: C.parse(name), url: null, thumb: null });
      added++;
    }
    lib.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    state.page[slot] = 1;
    return added;
  }

  // 由「整理素材」套用：移除原本的圖片，加入改名後的圖片
  function applyOrganized(slot, files, replaceIds) {
    const drop = new Set(replaceIds);
    state.libs[slot] = state.libs[slot].filter((item) => {
      if (!drop.has(item.id)) return true;
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.thumb && item.thumb !== item.url) URL.revokeObjectURL(item.thumb);
      return false;
    });
    if (state.selected[slot] && drop.has(state.selected[slot].id)) state.selected[slot] = null;
    addItems(slot, files);
    state.tab = slot;
    renderTabs();
    renderLibrary();
    renderSlots();
    updatePrompt();
  }
  // 檔名不符合規律、未能分類的圖片
  const unsorted = (slot) => state.libs[slot].filter((i) => !(i.info && i.info.kind === slot));

  async function importMetaFile(file) {
    try { return C.importText(await file.text()); } catch (e) { return null; }
  }
  function metaStatus(res) {
    return t({ pose: 'status.metaPose', face: 'status.metaFace', own: 'status.metaOwn' }[res.kind], { n: res.n });
  }

  function clearLibrary(slot) {
    for (const item of state.libs[slot]) {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.thumb && item.thumb !== item.url) URL.revokeObjectURL(item.thumb);
    }
    state.libs[slot] = [];
    if (state.selected[slot]) { state.selected[slot] = null; renderSlots(); updatePrompt(); }
    state.filter[slot] = emptyFilter();
    renderTabs();
    renderLibrary();
  }

  function fullUrl(item) {
    if (!item.url) item.url = URL.createObjectURL(item.file);
    return item.url;
  }

  // 縮圖：只在圖片接近可見範圍時才製作，約 320px 闊的 JPEG，製作後快取
  const THUMB_W = 320;
  const thumbQueue = [];
  let thumbBusy = 0;
  const thumbObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          thumbObserver.unobserve(e.target);
          thumbQueue.push(e.target);
        }
        pumpThumbs();
      }, { rootMargin: '400px' })
    : null;
  function setThumb(img, item) {
    img.thumbItem = item;
    if (item.thumb) { img.src = item.thumb; return; }
    img.removeAttribute('src');
    if (thumbObserver) thumbObserver.observe(img);
    else { thumbQueue.push(img); pumpThumbs(); }
  }
  function pumpThumbs() {
    while (thumbBusy < 4 && thumbQueue.length) {
      const img = thumbQueue.shift();
      const item = img.thumbItem;
      if (!item || !img.isConnected) continue;
      thumbBusy++;
      makeThumb(item)
        .then((url) => { if (img.thumbItem === item) img.src = url; })
        .finally(() => { thumbBusy--; pumpThumbs(); });
    }
  }
  function makeThumb(item) {
    if (item.thumb) return Promise.resolve(item.thumb);
    if (!item.thumbJob) {
      item.thumbJob = (async () => {
        try {
          const bmp = await createImageBitmap(item.file, { resizeWidth: THUMB_W, resizeQuality: 'medium' });
          const k = Math.min(1, THUMB_W / bmp.width);
          const c = document.createElement('canvas');
          c.width = Math.round(bmp.width * k);
          c.height = Math.round(bmp.height * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          bmp.close();
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
          item.thumb = URL.createObjectURL(blob);
        } catch (e) {
          item.thumb = fullUrl(item);
        }
        return item.thumb;
      })();
    }
    return item.thumbJob;
  }
  const thumbImg = (item, cls) => {
    const img = el('img', { class: cls || null, alt: '', decoding: 'async' });
    setThumb(img, item);
    return img;
  };

  // 篩選
  const sectionOf = (item) => (item.info && item.info.kind === 'face' ? item.info.section : 'other');
  const seriesOf = (item) => (item.info && item.info.kind === 'pose' ? item.info.series : '');
  function searchText(item) {
    const i = item.info;
    const parts = [item.path];
    if (i && i.kind === 'pose') {
      const m = C.poseMeta(i);
      parts.push(m.cat, m.name, C.seriesName(i.series), t(`angle.${i.angle}`));
    } else if (i && i.kind === 'face') {
      const m = C.faceMeta(i);
      parts.push(m.hair, m.style, C.hairName(m.hair), t(`section.${i.section}`));
    }
    return parts.join(' ').toLowerCase();
  }
  // skip：計算某個篩選項目的數量時，忽略該項目本身
  function matches(slot, item, f, skip) {
    if (skip !== 'folder' && f.folder && item.folder !== f.folder) return false;
    if (slot === 'pose') {
      if (skip !== 'series' && f.series && seriesOf(item) !== f.series) return false;
      if (skip !== 'cat' && f.cat && C.poseMeta(item.info).cat !== f.cat) return false;
      if (skip !== 'angle' && f.angle && !(item.info && item.info.angle === f.angle)) return false;
    }
    if (slot === 'face') {
      if (skip !== 'section' && f.section && sectionOf(item) !== f.section) return false;
      if (skip !== 'hair' && f.hair && C.faceMeta(item.info).hair !== f.hair) return false;
    }
    const needle = f.q.trim().toLowerCase();
    return !needle || searchText(item).includes(needle);
  }
  function filtered(slot, skip) {
    const f = state.filter[slot];
    return state.libs[slot].filter((i) => matches(slot, i, f, skip));
  }
  function countBy(list, keyOf) {
    const m = new Map();
    for (const i of list) { const k = keyOf(i); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }
  // 把同一姿勢的各角度合併為一組
  function groupPoses(list) {
    const groups = [];
    const byKey = new Map();
    for (const item of list) {
      const i = item.info;
      const key = i && i.kind === 'pose' ? i.key : `item|${item.id}`;
      let g = byKey.get(key);
      if (!g) {
        g = { key, info: i && i.kind === 'pose' ? i : null, items: {}, list: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.list.push(item);
      if (g.info && !g.items[i.angle]) g.items[i.angle] = item;
    }
    const order = (s) => { const n = C.SERIES.indexOf(s); return n < 0 ? C.SERIES.length : n; };
    groups.sort((a, b) => (a.info && b.info ? order(a.info.series) - order(b.info.series) : 0));
    for (const g of groups) {
      g.order = C.ANGLES.map((a) => g.items[a]).filter(Boolean);
      for (const item of g.list) if (!g.order.includes(item)) g.order.push(item);
    }
    return groups;
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

  // 篩選列的元件
  function facetTabs(label, entries, value, onPick) {
    return el('div', { class: 'ftabs', role: 'group', 'aria-label': label }, ...entries.map(([v, text, n]) => el('button', {
      class: 'ftab', 'aria-pressed': String(value === v), onclick: () => onPick(v)
    }, text, n != null ? el('span', { class: 'n', text: String(n) }) : null)));
  }
  function segmented(label, entries, value, onPick) {
    return el('div', { class: 'seg', role: 'group', 'aria-label': label }, ...entries.map(([v, text]) => el('button', {
      type: 'button', 'aria-pressed': String(value === v), onclick: () => onPick(v)
    }, text)));
  }

  let redrawGrid = null;

  function renderLibrary() {
    const slot = state.tab;
    const meta = SLOTS.find((s) => s.id === slot);
    const box = $('#library');
    const lib = state.libs[slot];
    redrawGrid = null;

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
          el('button', { class: 'btn', onclick: () => pickFiles(slot) }, icon('images'), t('lib.pickFiles')),
          slot !== 'outfit' ? el('button', { class: 'btn', onclick: () => E.organizer.open(slot) }, icon('edit'), t('org.openOwn')) : null)));
      return;
    }

    const f = state.filter[slot];
    const rerender = () => { state.page[slot] = 1; renderLibrary(); };
    const search = el('input', { type: 'search', placeholder: t(`lib.searchPh.${slot}`), value: f.q, 'aria-label': t('lib.search') });
    search.addEventListener('input', () => { f.q = search.value; state.page[slot] = 1; renderGrid(); });

    const toolbar = el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search'), search),
      el('button', { class: 'btn small', onclick: () => pickFolder(slot) }, icon('folder-plus'), t('lib.addFolder')),
      slot !== 'outfit' ? el('button', { class: 'btn small', onclick: () => E.organizer.open(slot) }, icon('edit'), t('org.open')) : null,
      slot !== 'outfit' ? el('button', { class: 'btn small', onclick: openMeta }, icon('tag'), t('lib.meta')) : null,
      el('button', { class: 'btn small ghost', onclick: () => clearLibrary(slot) }, icon('trash'), t('lib.clear')));

    // 依素材類型建立篩選列
    const rows = [];
    if (slot === 'pose') {
      const parsed = lib.some((i) => seriesOf(i));
      if (parsed) {
        const bySeries = countBy(filtered(slot, 'series'), seriesOf);
        const present = [...new Set(lib.map(seriesOf).filter(Boolean))]
          .sort((a, b) => ((C.SERIES.indexOf(a) + 1 || 99) - (C.SERIES.indexOf(b) + 1 || 99)));
        rows.push(facetTabs(t('lib.series'), [['', t('lib.all'), filtered(slot, 'series').length],
          ...present.map((s) => [s, C.seriesName(s), bySeries.get(s) || 0])], f.series, (v) => { f.series = v; f.cat = ''; rerender(); }));

        const line = el('div', { class: 'frow' });
        const cats = [...countBy(filtered(slot, 'cat'), (i) => C.poseMeta(i.info).cat)].filter(([c]) => c)
          .sort((a, b) => a[0].localeCompare(b[0], 'ja'));
        if (cats.length) {
          const sel = el('select', { class: 'pill-select', 'aria-label': t('lib.cat') },
            el('option', { value: '', text: t('lib.allCats') }),
            ...cats.map(([c, n]) => el('option', { value: c, text: `${c}（${n}）`, selected: f.cat === c })));
          sel.addEventListener('change', () => { f.cat = sel.value; rerender(); });
          line.append(sel);
        }
        line.append(
          segmented(t('lib.angle'), [['', t('lib.allAngles')], ...C.ANGLES.map((a) => [a, t(`angle.${a}`)])], f.angle, (v) => { f.angle = v; rerender(); }),
          segmented(t('lib.view'), [['pose', t('lib.view.pose')], ['card', t('lib.view.card')]], f.view, (v) => { f.view = v; rerender(); }));
        rows.push(line);
      }
    }
    if (slot === 'face' && lib.some((i) => i.info && i.info.kind === 'face')) {
      const bySec = countBy(filtered(slot, 'section'), sectionOf);
      const secs = [...C.SECTIONS, 'other'].filter((s) => lib.some((i) => sectionOf(i) === s));
      rows.push(facetTabs(t('lib.section'), [['', t('lib.all'), filtered(slot, 'section').length],
        ...secs.map((s) => [s, t(`section.${s}`), bySec.get(s) || 0])], f.section, (v) => { f.section = v; rerender(); }));
    }
    if (slot === 'face') {
      const byHair = countBy(filtered(slot, 'hair'), (i) => C.faceMeta(i.info).hair);
      const hairs = [...byHair.keys()].filter(Boolean)
        .sort((a, b) => ((C.HAIRS.indexOf(a) + 1 || 99) - (C.HAIRS.indexOf(b) + 1 || 99)));
      if (hairs.length) {
        rows.push(facetTabs(t('lib.hair'), [['', t('lib.allHair'), null], ...hairs.map((h) => [h, C.hairName(h), byHair.get(h)])],
          f.hair, (v) => { f.hair = v; rerender(); }));
      }
    }
    const folders = [...new Set(lib.map((i) => i.folder).filter(Boolean))];
    if (folders.length > 1) {
      const sel = el('select', { class: 'pill-select', 'aria-label': t('lib.folder') },
        el('option', { value: '', text: t('lib.allFolders') }),
        ...folders.map((name) => el('option', { value: name, text: name, selected: f.folder === name })));
      sel.addEventListener('change', () => { f.folder = sel.value; rerender(); });
      rows.push(el('div', { class: 'frow' }, sel));
    }

    const facets = el('div', { class: 'facets' }, ...rows);
    const countLine = el('div', { class: 'shown', id: 'shownCount' });
    const grid = el('div', { class: 'grid', id: 'grid' });
    const more = el('div', { class: 'more', id: 'more' });
    const loose = slot !== 'outfit' ? unsorted(slot) : [];
    const banner = loose.length ? el('div', { class: 'banner' }, icon('tag'),
      el('span', { text: t('org.unrecognized', { n: loose.length }) }),
      el('button', { class: 'btn small', onclick: () => E.organizer.open(slot, unsorted(slot)) }, t('org.fix'))) : null;
    box.replaceChildren(el('div', { class: 'lib-head' }, toolbar, banner, rows.length ? facets : null, countLine), grid, more);
    redrawGrid = renderGrid;
    renderGrid();

    function renderGrid() {
      const list = filtered(slot);
      const sel = state.selected[slot];
      const byPose = slot === 'pose' && f.view === 'pose' && list.some((i) => seriesOf(i));
      if (byPose) {
        const groups = groupPoses(list);
        const page = groups.slice(0, state.page[slot] * PAGE);
        grid.className = 'grid poses';
        grid.replaceChildren(...page.map((g) => poseCard(slot, g, sel)));
        $('#shownCount').textContent = t('lib.posesCount', { p: groups.length, n: list.length });
        setMore(groups.length - page.length);
      } else {
        const page = list.slice(0, state.page[slot] * PAGE);
        grid.className = 'grid';
        grid.replaceChildren(...page.map((item) => itemTile(slot, item, sel)));
        $('#shownCount').textContent = t('lib.count', { n: list.length });
        setMore(list.length - page.length);
      }
      if (!list.length) grid.replaceChildren(el('p', { class: 'nomatch', text: t('lib.noMatch') }));
    }
    function setMore(rest) {
      more.replaceChildren(rest > 0
        ? el('button', { class: 'btn', onclick: () => { state.page[slot]++; renderGrid(); } }, icon('chevron'), t('lib.more', { n: Math.min(PAGE, rest) }))
        : '');
    }
  }

  // 合成區顯示的名稱：有分類資料時用姿勢名稱或髮型
  function displayName(item) {
    const i = item.info;
    if (i && i.kind === 'pose') {
      const m = C.poseMeta(i);
      return `${m.name || i.num} · ${t(`angle.${i.angle}`)}`;
    }
    if (i && i.kind === 'face') {
      const m = C.faceMeta(i);
      return [m.hair && C.hairName(m.hair), m.style].filter(Boolean).join(' · ') || item.name;
    }
    return item.name;
  }

  // 單張圖片
  function itemTile(slot, item, sel) {
    const i = item.info;
    let tag = '';
    let label = item.name;
    if (i && i.kind === 'pose') {
      const m = C.poseMeta(i);
      tag = `${i.num} · ${t(`angle.${i.angle}`)}`;
      if (m.name) label = m.name;
    } else if (i && i.kind === 'face') {
      const m = C.faceMeta(i);
      tag = m.hair ? C.hairName(m.hair) : '';
      if (m.style) label = m.style;
    }
    return el('button', {
      class: 'item', 'data-id': item.id, 'aria-pressed': String(!!sel && sel.id === item.id),
      'aria-label': label, title: label === item.name ? item.path : `${label}\n${item.path}`,
      onclick: () => select(slot, item)
    }, thumbImg(item), tag ? el('span', { class: 'tag', 'aria-hidden': 'true', text: tag }) : null,
      el('span', { class: 'item-name', 'aria-hidden': 'true', text: label }));
  }

  // 姿勢卡：主圖 + 各角度縮圖
  function poseCard(slot, g, sel) {
    const f = state.filter[slot];
    const has = (item) => !!sel && sel.id === item.id;
    let cur = (f.angle && g.items[f.angle]) || g.items[state.poseAngle[g.key]] || g.list.find(has) || g.order[0];
    const i = g.info;
    const m = C.poseMeta(i);
    const name = m.name || (i ? i.num : cur.name);
    const sub = i ? [C.seriesName(i.series), m.cat].filter(Boolean).join(' · ') : cur.name;
    const angleName = (item) => (item.info && item.info.angle ? t(`angle.${item.info.angle}`) : item.name);

    const mainImg = thumbImg(cur);
    const main = el('button', {
      class: 'pmain', 'data-id': cur.id, 'aria-pressed': String(has(cur)),
      'aria-label': `${name} · ${angleName(cur)}`, title: cur.path,
      onclick: () => select(slot, cur)
    }, mainImg, i ? el('span', { class: 'pnum', 'aria-hidden': 'true', text: i.num }) : null);

    const strip = g.order.length > 1 ? el('div', { class: 'pstrip' }, ...g.order.map((item) => {
      const b = el('button', {
        type: 'button', 'data-id': item.id, class: item === cur ? 'on' : null, 'aria-pressed': String(has(item)),
        'aria-label': `${name} · ${angleName(item)}`, title: angleName(item),
        onclick: () => select(slot, item)
      }, thumbImg(item), el('span', { 'aria-hidden': 'true', text: angleName(item) }));
      const show = () => {
        cur = item;
        if (item.info && item.info.angle) state.poseAngle[g.key] = item.info.angle;
        setThumb(mainImg, item);
        main.dataset.id = item.id;
        main.title = item.path;
        main.setAttribute('aria-label', `${name} · ${angleName(item)}`);
        main.setAttribute('aria-pressed', String(has(item)));
        strip.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      };
      b.addEventListener('mouseenter', show);
      b.addEventListener('focus', show);
      return b;
    })) : null;

    return el('article', { class: `pcard${g.list.some(has) ? ' picked' : ''}` },
      main,
      el('div', { class: 'pmeta' }, el('strong', { text: name, title: name }), el('span', { text: sub, title: sub })),
      strip);
  }

  function select(slot, item) {
    const cur = state.selected[slot];
    state.selected[slot] = cur && cur.id === item.id ? null : item;
    renderSlots();
    if (redrawGrid && state.tab === slot) redrawGrid();
    updatePrompt();
  }

  // ---------- 分類資料 ----------
  function openMeta() {
    renderMetaInfo();
    $('#metaDlg').showModal();
  }
  function renderMetaInfo() {
    const c = C.counts();
    $('#metaInfo').textContent = c.pose || c.face ? t('meta.info', { p: c.pose, f: c.face }) : t('meta.none');
    $('#metaClear').disabled = !(c.pose || c.face);
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
        'aria-label': t('slot.aria', { label, name: item ? displayName(item) : t('slot.none') }),
        onclick: () => setTab(s.id)
      }, item
        ? el('img', { src: fullUrl(item), alt: '' })
        : el('span', { class: 'slot-empty' },
          el('span', { class: 'glyph' }, icon(s.id)),
          el('span', { text: t(`slot.pick.${s.id}`) })));
      const meta = el('div', { class: 'slot-meta' },
        el('span', { class: 'name', text: item ? displayName(item) : t('slot.none'), title: item ? item.path : null }),
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
    E.organizer.init({ el, icon, t, thumbImg, setStatus, libraryItems: (slot) => state.libs[slot], apply: applyOrganized });
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
    $('#metaPick').addEventListener('click', () => { $('#metaInput').value = ''; $('#metaInput').click(); });
    $('#metaInput').addEventListener('change', async (e) => {
      const msgs = [];
      for (const file of e.target.files) {
        const res = await importMetaFile(file);
        if (res) msgs.push(metaStatus(res));
      }
      setStatus(msgs.length ? msgs.join(' ') : t('status.metaFail'), !msgs.length);
      $('#metaNote').textContent = msgs.length ? msgs.join(' ') : t('status.metaFail');
      renderMetaInfo();
      renderLibrary();
    });
    $('#metaClear').addEventListener('click', () => {
      C.clear();
      for (const slot of ['face', 'pose']) Object.assign(state.filter[slot], { cat: '', hair: '' });
      $('#metaNote').textContent = '';
      renderMetaInfo();
      renderLibrary();
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
