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
    { id: 'outfit', num: '02', en: 'OUTFIT', source: 'https://ai-costume-gallery.pages.dev/', sourceName: '衣装集 COSTUME-DB-01' },
    { id: 'pose', num: '03', en: 'POSE', source: 'https://ai-pose-gallery.pages.dev/', sourceName: 'ポーズ集 POSE-DB-01' }
  ];
  const slotLabel = (id) => t(`slot.${id}`);
  // 舞台頂部的鏡頭讀數
  const READOUT = [['aspect', 'AR'], ['shot', 'SHOT'], ['lens', 'LENS'], ['aperture', 'F'], ['light', 'LIGHT'], ['style', 'STYLE']];
  const PAGE = 120;
  // 姿勢分類多於此數時改用下拉選單
  const MAX_CAT_TABS = 20;
  const STORE_KEY = 'compose-studio:v1';
  const L = E.library;

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
    pendingFolders: [],
    // 每按一次「清除」加一；還原中的資料夾讀完後如發現已被清除，就不再加入
    libVersion: { face: 0, outfit: 0, pose: 0 },
    abort: null,
    prefs: {
      engine: 'gemini',
      uiLang: null,
      sceneTab: 'framing',
      lang: 'en',
      keepHair: true,
      remember: false,
      showSuggestive: false,
      // 目前的分頁：library（素材庫）或 prompt
      page: 'library',
      // 按「清除」後不再自動載入該類內置圖庫，直至再按「使用內置圖庫」
      builtinOff: {},
      opts: {},
      selected: {},
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
    // 內置姿勢的分類名稱會跟語言轉換，舊的篩選值不再適用
    state.filter.pose.cat = '';
    savePrefs();
    applyStatic();
    renderTabs();
    renderLibrary();
    renderSlots();
    renderScene();
    renderReadout();
    renderEngineName();
    renderResult();
    renderPeek();
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
    renderDock();
  }

  // ---------- 還原上次的資料夾 ----------
  function renderRestoreBar() {
    const n = state.pendingFolders.length;
    $('#restoreBar').hidden = !n;
    if (n) $('#restoreText').textContent = t('restore.text', { n });
  }

  async function loadSavedFolder(row) {
    const version = state.libVersion[row.slot];
    let entries;
    try {
      entries = await L.scan(row.handle);
    } catch (e) {
      setStatus(t('restore.fail', { name: row.handle.name }), true);
      // 資料夾已被移動或刪除：不再記住，以免每次載入都出現同一個錯誤
      if (e.name === 'NotFoundError') L.forgetFolder(row).catch((err) => setStatus(err.message || String(err), true));
      return;
    }
    if (state.libVersion[row.slot] !== version) return;
    await addFiles(row.slot, entries);
  }

  // 重新選回上次已選的人物、服裝、姿勢
  function reselect() {
    for (const s of SLOTS) {
      const id = state.prefs.selected[s.id];
      if (!id || state.selected[s.id]) continue;
      state.selected[s.id] = state.libs[s.id].find((i) => i.id === id) || null;
    }
    renderSlots();
    renderLibrary();
    updatePrompt();
  }

  // 已有讀取權限的資料夾直接載入，其餘等用戶按「還原資料夾」
  async function restoreFolders() {
    const ready = [];
    try {
      const pending = [];
      for (const row of await L.recall()) {
        (await L.permission(row.handle, false) === 'granted' ? ready : pending).push(row);
      }
      state.pendingFolders = pending;
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
    renderRestoreBar();
    for (const row of ready) await loadSavedFolder(row);
    reselect();
  }

  // 詢問讀取權限必須由點擊觸發，而且點擊的效力很短，所以先逐一詢問，全部問完才讀取。
  // 未獲允許的資料夾會留在列表，可再按一次
  async function grantFolders() {
    const granted = [];
    const left = [];
    for (const row of state.pendingFolders) {
      try {
        (await L.permission(row.handle, true) === 'granted' ? granted : left).push(row);
      } catch (e) {
        left.push(row);
        setStatus(e.message || String(e), true);
      }
    }
    state.pendingFolders = left;
    renderRestoreBar();
    for (const row of granted) await loadSavedFolder(row);
    reselect();
  }

  // ---------- 素材庫 ----------
  function emptyFilter() {
    return { folder: '', q: '', series: '', cat: '', angle: '', section: '', hair: '', view: 'pose', type: '', color: '', tag: '' };
  }

  // 素材以 { file, path } 表示；由 <input> 取得的 File 以 webkitRelativePath（或檔名）作為 path
  const toEntry = (f) => (f instanceof File ? { file: f, path: f.webkitRelativePath || f.name } : f);

  // 回傳新加入的圖片數量
  async function addFiles(slot, fileList) {
    const all = Array.from(fileList).map(toEntry);
    const files = all.filter((e) => L.IMAGE_RE.test(e.file.name));
    // 資料夾內如有從原站儲存的分類資料檔，一併讀取
    const metaFiles = all.filter((e) => L.META_RE.test(e.file.name) && e.file.size < L.META_MAX_BYTES);
    const metaMsgs = [];
    for (const e of metaFiles) {
      const res = await importMetaFile(e.file);
      if (res) metaMsgs.push(metaStatus(res));
    }
    if (!files.length) {
      if (metaMsgs.length) { setStatus(metaMsgs.join(' ')); renderLibrary(); }
      else setStatus(t('status.noImages'), true);
      return 0;
    }
    const added = addItems(slot, files);
    setStatus([t('status.loaded', { n: added, label: slotLabel(slot) }), ...metaMsgs].join(' '));
    renderTabs();
    renderLibrary();
    return added;
  }

  function addItems(slot, files) {
    const lib = state.libs[slot];
    const seen = new Set(lib.map((i) => i.id));
    let added = 0;
    for (const entry of files.map(toEntry)) {
      const { file: f, path } = entry;
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
      releaseUrls(item);
      return false;
    });
    if (state.selected[slot] && drop.has(state.selected[slot].id)) setSelected(slot, null);
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
    return t({ pose: 'status.metaPose', face: 'status.metaFace', outfit: 'status.metaOutfit', own: 'status.metaOwn' }[res.kind], { n: res.n });
  }

  // 記低已選素材的 id，重新載入頁面並還原資料夾後可以再選回
  function setSelected(slot, item) {
    state.selected[slot] = item;
    state.prefs.selected = { ...state.prefs.selected, [slot]: item ? item.id : null };
    savePrefs();
  }

  // 歷史紀錄仍會引用已移除的素材，所以清除已失效的網址，之後需要時再重新建立
  function releaseUrls(item) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.thumb && item.thumb !== item.url) URL.revokeObjectURL(item.thumb);
    item.url = null;
    item.thumb = null;
  }

  function clearLibrary(slot) {
    for (const item of state.libs[slot]) releaseUrls(item);
    state.libs[slot] = [];
    state.libVersion[slot]++;
    if (state.selected[slot] || state.prefs.selected[slot]) { setSelected(slot, null); renderSlots(); updatePrompt(); }
    state.filter[slot] = emptyFilter();
    state.pendingFolders = state.pendingFolders.filter((p) => p.slot !== slot);
    renderRestoreBar();
    if (L.canRemember) L.forget(slot).catch((e) => setStatus(e.message || String(e), true));
    state.prefs.builtinOff = { ...state.prefs.builtinOff, [slot]: true };
    savePrefs();
    renderTabs();
    renderLibrary();
  }

  const isBuiltin = (item) => !!item.src;

  // 加入內置圖庫的素材（已有的不重複加入）
  function addBuiltinItems(slot, items) {
    const seen = new Set(state.libs[slot].map((i) => i.id));
    const fresh = items.filter((i) => !seen.has(i.id));
    state.libs[slot] = [...state.libs[slot], ...fresh]
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    state.page[slot] = 1;
    return fresh.length;
  }

  // slots：要載入的類別；由按鈕觸發時同時取消「不自動載入」
  async function loadBuiltin(slots, fromClick) {
    let lib;
    try {
      lib = await E.builtin.load();
    } catch (e) {
      setStatus(e.message || String(e), true);
      return;
    }
    const items = E.builtin.toItems(lib);
    // 自動載入期間按了「清除」的類別不再加入
    const wanted = fromClick ? slots : slots.filter((slot) => !state.prefs.builtinOff[slot]);
    for (const slot of wanted) {
      addBuiltinItems(slot, items[slot]);
      if (fromClick) state.prefs.builtinOff = { ...state.prefs.builtinOff, [slot]: false };
    }
    if (fromClick) savePrefs();
    setStatus(t('status.libLoaded', { f: lib.face.length, p: lib.pose.length, o: lib.outfit.length }));
    renderTabs();
    reselect();
  }

  function fullUrl(item) {
    if (isBuiltin(item)) return item.src;
    if (!item.url) item.url = URL.createObjectURL(item.file);
    return item.url;
  }

  // 內置圖庫的圖片在需要時才下載，之後重用
  function itemFile(item) {
    if (item.file) return Promise.resolve(item.file);
    if (!item.fileJob) {
      item.fileJob = fetch(item.src)
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
        .then((b) => { item.file = new File([b], `${item.name}.webp`, { type: b.type || 'image/webp' }); return item.file; })
        .catch((e) => { item.fileJob = null; throw new Error(t('status.libFetchFail'), { cause: e }); });
    }
    return item.fileJob;
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
    if (item.thumbSrc) { img.loading = 'lazy'; img.src = item.thumbSrc; return; }
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
  const codeOf = (item) => (item.info && item.info.kind === 'outfit' ? item.info.code : '');
  function searchText(item) {
    const i = item.info;
    const parts = [item.path];
    if (i && i.kind === 'pose') {
      const m = C.poseMeta(i);
      parts.push(m.cat, m.name, C.seriesName(i.series), t(`angle.${i.angle}`));
    } else if (i && i.kind === 'face') {
      const m = C.faceMeta(i);
      parts.push(m.hair, m.style, C.hairName(m.hair), t(`section.${i.section}`));
    } else if (i && i.kind === 'outfit') {
      parts.push(C.outfitMeta(i).keywords, C.outfitName(i.code));
    }
    const tags = item.tags || {};
    for (const [prefix, list] of [['type', tags.types], ['color', tags.colors], ['hairtag', tags.hair]]) {
      for (const v of list || []) parts.push(t(`${prefix}.${v}`));
    }
    return parts.join(' ').toLowerCase();
  }
  // skip：計算某個篩選項目的數量時，忽略該項目本身
  function matches(slot, item, f, skip) {
    if (item.suggestive && !state.prefs.showSuggestive) return false;
    if (skip !== 'folder' && f.folder && item.folder !== f.folder) return false;
    if (slot === 'pose') {
      if (skip !== 'series' && f.series && seriesOf(item) !== f.series) return false;
      if (skip !== 'cat' && f.cat && C.poseMeta(item.info).cat !== f.cat) return false;
      if (skip !== 'angle' && f.angle && !(item.info && item.info.angle === f.angle)) return false;
    }
    if (slot === 'outfit') {
      if (skip !== 'cat' && f.cat && codeOf(item) !== f.cat) return false;
      if (skip !== 'type' && f.type && !tagsOf(item, 'types').includes(f.type)) return false;
      if (skip !== 'color' && f.color && !tagsOf(item, 'colors').includes(f.color)) return false;
    }
    if (slot === 'face') {
      if (skip !== 'section' && f.section && sectionOf(item) !== f.section) return false;
      if (skip !== 'hair' && f.hair && C.faceMeta(item.info).hair !== f.hair) return false;
      if (skip !== 'tag' && f.tag && !tagsOf(item, 'hair').includes(f.tag)) return false;
    }
    const needle = f.q.trim().toLowerCase();
    return !needle || searchText(item).includes(needle);
  }
  function filtered(slot, skip) {
    const f = state.filter[slot];
    return state.libs[slot].filter((i) => matches(slot, i, f, skip));
  }
  // 內置圖庫的標籤（款式、顏色、髮型）；其他圖片沒有標籤
  const tagsOf = (item, key) => (item.tags && item.tags[key]) || [];
  function countTags(list, key) {
    const m = new Map();
    for (const i of list) for (const k of tagsOf(i, key)) m.set(k, (m.get(k) || 0) + 1);
    return m;
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

  // 支援的瀏覽器直接選取資料夾並記住它；其餘使用 <input webkitdirectory>
  async function pickFolder(slot) {
    state.pendingSlot = slot;
    if (!L.canRemember) {
      $('#folderInput').value = '';
      $('#folderInput').click();
      return;
    }
    try {
      const dir = await L.pickDirectory();
      setStatus(t('status.reading'));
      if (await addFiles(slot, await L.scan(dir))) await L.remember(slot, dir);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setStatus(e.message || String(e), true);
    }
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

  // ---------- 分頁：素材庫 / Prompt ----------
  function setPage(page) {
    state.prefs.page = page === 'prompt' ? 'prompt' : 'library';
    savePrefs();
    renderPage();
    window.scrollTo({ top: 0 });
  }
  function renderPage() {
    const page = state.prefs.page;
    $('#pageLibrary').hidden = page !== 'library';
    $('#pagePrompt').hidden = page !== 'prompt';
    document.querySelectorAll('.page-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === page)));
    if (page === 'library') $('#dock').hidden = true;
    else requestAnimationFrame(updateDock);
  }
  // 由 Prompt 分頁的格子或浮動列跳去素材庫的某一類
  function openLibrary(slot) {
    setTab(slot);
    setPage('library');
  }

  // 素材庫頂部的「已揀」：三格縮圖，撳縮圖切換類別，撳 x 取消
  function renderPicked() {
    const picks = SLOTS.map((s) => {
      const item = state.selected[s.id];
      return el('div', { class: `pick${state.tab === s.id ? ' on' : ''}` },
        el('button', { class: 'thumb', type: 'button', 'aria-label': slotLabel(s.id), onclick: () => setTab(s.id) },
          item ? el('img', { src: item.thumbSrc || fullUrl(item), alt: '' }) : icon(s.id)),
        el('div', { class: 'txt' }, el('strong', { text: slotLabel(s.id) }),
          el('span', { text: item ? displayName(item) : t('slot.none'), title: item ? displayName(item) : '' })),
        item ? el('button', {
          class: 'x', type: 'button', 'aria-label': t('slot.remove'), title: t('slot.remove'),
          onclick: () => { setSelected(s.id, null); renderSlots(); if (redrawGrid && state.tab === s.id) redrawGrid(); updatePrompt(); }
        }, icon('x')) : null);
    });
    $('#picked').replaceChildren(el('span', { class: 'kicker', text: t('picked.title') }), ...picks,
      el('button', { class: 'btn primary pick-go', type: 'button', disabled: !SLOTS.some((s) => state.selected[s.id]), onclick: () => setPage('prompt') },
        icon('sparkle'), t('picked.go')));
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

  // 內置圖庫的性感內容預設隱藏
  function suggestiveToggle() {
    const box = el('input', { type: 'checkbox', checked: !!state.prefs.showSuggestive });
    box.addEventListener('change', () => {
      state.prefs.showSuggestive = box.checked;
      savePrefs();
      state.page[state.tab] = 1;
      renderLibrary();
    });
    return el('label', { class: 'check small' }, box, t('lib.showSuggestive'));
  }

  // ---------- 素材庫左欄的篩選 ----------
  const fgroup = (label, ...kids) => el('div', { class: 'fgroup' }, el('h4', { text: label }), ...kids);
  // 多值標籤（款式、顏色、髮型）的篩選按鈕；swatch 為顏色圓點
  function tagFacet(slot, key, prefix, field, f, rerender, swatch) {
    const counts = countTags(filtered(slot, field), key);
    // 沒有圖片帶這類標籤（例如只剩自己載入的圖片）時，清除舊的篩選，以免全部被篩走
    if (!counts.size) { f[field] = ''; return null; }
    const keys = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    return fgroup(t(`lib.${field}`), el('div', { class: 'ftabs', role: 'group', 'aria-label': t(`lib.${field}`) },
      ...[['', t('lib.all'), null], ...keys.map((k) => [k, t(`${prefix}.${k}`), counts.get(k)])].map(([v, text, n]) => el('button', {
        class: 'ftab', 'aria-pressed': String(f[field] === v), onclick: () => { f[field] = v; rerender(); }
      }, swatch && v ? el('span', { class: 'swatch', style: `background:${COLOR_SWATCH[v] || 'transparent'}` }) : null,
        text, n != null ? el('span', { class: 'n', text: String(n) }) : null))));
  }
  const COLOR_SWATCH = {
    black: '#1d1d1f', white: '#f6f3ea', brown: '#8a5a3b', grey: '#9a9a9a', blue: '#3c64b4', green: '#4f8a4f',
    red: '#b8343a', pink: '#e79bb5', orange: '#e0813a', yellow: '#e8c547', purple: '#8a62b5'
  };

  function poseFacets(slot, lib, f, rerender) {
    if (!lib.some((i) => seriesOf(i))) return [];
    const rows = [];
    const bySeries = countBy(filtered(slot, 'series'), seriesOf);
    const present = [...new Set(lib.map(seriesOf).filter(Boolean))]
      .sort((a, b) => ((C.SERIES.indexOf(a) + 1 || 99) - (C.SERIES.indexOf(b) + 1 || 99)));
    rows.push(fgroup(t('lib.series'), facetTabs(t('lib.series'), [['', t('lib.all'), filtered(slot, 'series').length],
      ...present.map((s) => [s, C.seriesName(s), bySeries.get(s) || 0])], f.series, (v) => { f.series = v; f.cat = ''; rerender(); })));
    const cats = [...countBy(filtered(slot, 'cat'), (i) => C.poseMeta(i.info).cat)].filter(([c]) => c)
      .sort((a, b) => b[1] - a[1]);
    if (cats.length > MAX_CAT_TABS) {
      const sel = el('select', { class: 'pill-select', 'aria-label': t('lib.cat') },
        el('option', { value: '', text: t('lib.allCats') }),
        ...cats.map(([c, n]) => el('option', { value: c, text: `${c}（${n}）`, selected: f.cat === c })));
      sel.addEventListener('change', () => { f.cat = sel.value; rerender(); });
      rows.push(fgroup(t('lib.cat'), sel));
    } else if (cats.length) {
      rows.push(fgroup(t('lib.cat'), facetTabs(t('lib.cat'), [['', t('lib.allCats'), null], ...cats.map(([c, n]) => [c, c, n])],
        f.cat, (v) => { f.cat = v; rerender(); })));
    }
    rows.push(fgroup(t('lib.angle'), segmented(t('lib.angle'), [['', t('lib.allAngles')], ...C.ANGLES.map((a) => [a, t(`angle.${a}`)])], f.angle, (v) => { f.angle = v; rerender(); })),
      fgroup(t('lib.view'), segmented(t('lib.view'), [['pose', t('lib.view.pose')], ['card', t('lib.view.card')]], f.view, (v) => { f.view = v; rerender(); })));
    return rows;
  }

  function outfitFacets(slot, lib, f, rerender) {
    if (!lib.some(codeOf)) return [];
    const byCode = countBy(filtered(slot, 'cat'), codeOf);
    const present = C.OUTFIT_CODES.filter((c) => byCode.has(c));
    return [
      fgroup(t('lib.cat'), facetTabs(t('lib.cat'), [['', t('lib.all'), filtered(slot, 'cat').length],
        ...present.map((c) => [c, C.outfitName(c), byCode.get(c) || 0])], f.cat, (v) => { f.cat = v; rerender(); })),
      tagFacet(slot, 'types', 'type', 'type', f, rerender, false),
      tagFacet(slot, 'colors', 'color', 'color', f, rerender, true)
    ].filter(Boolean);
  }

  function faceFacets(slot, lib, f, rerender) {
    const rows = [];
    if (lib.some((i) => i.info && i.info.kind === 'face')) {
      const bySec = countBy(filtered(slot, 'section'), sectionOf);
      const secs = [...C.SECTIONS, 'other'].filter((s) => lib.some((i) => sectionOf(i) === s));
      rows.push(fgroup(t('lib.section'), facetTabs(t('lib.section'), [['', t('lib.all'), filtered(slot, 'section').length],
        ...secs.map((s) => [s, t(`section.${s}`), bySec.get(s) || 0])], f.section, (v) => { f.section = v; rerender(); })));
    }
    const byHair = countBy(filtered(slot, 'hair'), (i) => C.faceMeta(i.info).hair);
    const hairs = [...byHair.keys()].filter(Boolean)
      .sort((a, b) => ((C.HAIRS.indexOf(a) + 1 || 99) - (C.HAIRS.indexOf(b) + 1 || 99)));
    if (hairs.length) {
      rows.push(fgroup(t('lib.hair'), facetTabs(t('lib.hair'), [['', t('lib.allHair'), null], ...hairs.map((h) => [h, C.hairName(h), byHair.get(h)])],
        f.hair, (v) => { f.hair = v; rerender(); })));
    }
    const tags = tagFacet(slot, 'hair', 'hairtag', 'tag', f, rerender, false);
    return tags ? [...rows, tags] : rows;
  }

  function buildFacets(slot, lib, f, rerender) {
    const rows = slot === 'pose' ? poseFacets(slot, lib, f, rerender)
      : slot === 'outfit' ? outfitFacets(slot, lib, f, rerender) : faceFacets(slot, lib, f, rerender);
    const folders = [...new Set(lib.map((i) => i.folder).filter(Boolean))];
    if (folders.length > 1) {
      const sel = el('select', { class: 'pill-select', 'aria-label': t('lib.folder') },
        el('option', { value: '', text: t('lib.allFolders') }),
        ...folders.map((name) => el('option', { value: name, text: name, selected: f.folder === name })));
      sel.addEventListener('change', () => { f.folder = sel.value; rerender(); });
      rows.push(fgroup(t('lib.folder'), sel));
    }
    return rows;
  }

  // 素材庫未有圖片時的說明及按鈕
  function emptyLibrary(slot) {
    const meta = SLOTS.find((s) => s.id === slot);
    const desc = el('p', {}, t('lib.dl.before'), el('a', { href: meta.source, target: '_blank', rel: 'noopener', text: meta.sourceName }), t('lib.dl.after'),
      slot === 'outfit' ? ` ${t('lib.outfitText')}` : '');
    return el('div', { class: 'empty' },
      el('div', { class: 'glyph-lg' }, icon(slot)),
      el('h3', { text: t(`lib.empty.${slot}`) }),
      desc,
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', onclick: () => loadBuiltin([slot], true) }, icon('images'), t('lib.useBuiltin')),
        el('button', { class: 'btn', onclick: () => pickFolder(slot) }, icon('folder'), t('lib.loadFolder')),
        el('button', { class: 'btn', onclick: () => pickFiles(slot) }, icon('images'), t('lib.pickFiles')),
        slot !== 'outfit' ? el('button', { class: 'btn', onclick: () => E.organizer.open(slot) }, icon('edit'), t('org.openOwn')) : null));
  }

  function libToolbar(slot, lib, search) {
    return el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search'), search),
      el('button', { class: 'btn small', onclick: () => pickFolder(slot) }, icon('folder-plus'), t('lib.addFolder')),
      // 已清除內置圖庫，或者只剩由歷史紀錄加回的個別圖片時，都可以再載入
      state.prefs.builtinOff[slot] || !lib.some(isBuiltin)
        ? el('button', { class: 'btn small', onclick: () => loadBuiltin([slot], true) }, icon('images'), t('lib.useBuiltin')) : null,
      slot !== 'outfit' ? el('button', { class: 'btn small', onclick: () => E.organizer.open(slot) }, icon('edit'), t('org.open')) : null,
      el('button', { class: 'btn small', onclick: openMeta }, icon('tag'), t('lib.meta')),
      el('button', { class: 'btn small ghost', onclick: () => clearLibrary(slot) }, icon('trash'), t('lib.clear')),
      lib.some((i) => i.suggestive) ? suggestiveToggle() : null);
  }

  function renderLibrary() {
    const slot = state.tab;
    const box = $('#library');
    const lib = state.libs[slot];
    redrawGrid = null;

    if (!lib.length) {
      box.replaceChildren(emptyLibrary(slot));
      $('#libFacets').replaceChildren();
      return;
    }

    const f = state.filter[slot];
    const rerender = () => { state.page[slot] = 1; renderLibrary(); };
    const search = el('input', { type: 'search', placeholder: t(`lib.searchPh.${slot}`), value: f.q, 'aria-label': t('lib.search') });
    search.addEventListener('input', () => { f.q = search.value; state.page[slot] = 1; renderGrid(); });
    const toolbar = libToolbar(slot, lib, search);

    const rows = buildFacets(slot, lib, f, rerender);

    const countLine = el('div', { class: 'shown', id: 'shownCount' });
    const grid = el('div', { class: 'grid', id: 'grid' });
    const more = el('div', { class: 'more', id: 'more' });
    const loose = slot !== 'outfit' ? unsorted(slot) : [];
    const banner = loose.length ? el('div', { class: 'banner' }, icon('tag'),
      el('span', { text: t('org.unrecognized', { n: loose.length }) }),
      el('button', { class: 'btn small', onclick: () => E.organizer.open(slot, unsorted(slot)) }, t('org.fix'))) : null;
    $('#libFacets').replaceChildren(...rows);
    box.replaceChildren(el('div', { class: 'lib-head' }, toolbar, banner, countLine), grid, more);
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
    if (i && i.kind === 'outfit') return C.outfitMeta(i).keywords || item.name;
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
    } else if (i && i.kind === 'outfit') {
      tag = C.outfitName(i.code);
      label = C.outfitMeta(i).keywords || item.name;
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
    setSelected(slot, cur && cur.id === item.id ? null : item);
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
    const any = c.pose || c.face || c.outfit;
    $('#metaInfo').textContent = any ? t('meta.info', { p: c.pose, f: c.face, o: c.outfit }) : t('meta.none');
    $('#metaClear').disabled = !any;
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
        onclick: () => openLibrary(s.id)
      }, item
        ? el('img', { src: fullUrl(item), alt: '' })
        : el('span', { class: 'slot-empty' },
          el('span', { class: 'glyph' }, icon(s.id)),
          el('span', { text: t(`slot.pick.${s.id}`) })));
      const meta = el('div', { class: 'slot-meta' },
        el('span', { class: 'name', text: item ? displayName(item) : t('slot.none'), title: item ? item.path : null }),
        item ? el('button', { class: 'clear icon-only', type: 'button', 'aria-label': t('slot.copy'), title: t('slot.copy'), onclick: () => copyImage(item) }, icon('copy')) : null,
        item ? el('button', { class: 'clear', onclick: () => { setSelected(s.id, null); renderSlots(); renderLibrary(); updatePrompt(); } }, icon('x'), t('slot.remove')) : null);
      host.replaceChildren(head, frame, meta);
    }
    renderPicked();
    updateGenerateButton();
  }

  // ---------- 場景選項 ----------
  const tabName = (tab) => (I.lang === 'en' ? tab.en : tab.zh);
  const tabOf = (groupId) => E.sceneTabs.find((tab) => tab.groups.includes(groupId)) || E.sceneTabs[0];
  const currentTab = () => E.sceneTabs.find((tab) => tab.id === state.prefs.sceneTab) || E.sceneTabs[0];

  function renderScene(animate) {
    renderLooks();
    renderSceneTabs();
    renderPresets();
    if (animate) {
      const body = $('#sceneBody');
      body.classList.remove('enter');
      void body.offsetWidth;
      body.classList.add('enter');
    }
  }
  function renderSceneTabs() {
    const cur = currentTab();
    $('#sceneTabs').replaceChildren(...E.sceneTabs.map((tab) => {
      const n = tab.groups.reduce((sum, id) => sum + (state.prefs.opts[id] || []).length, 0)
        + (tab.fields ? ['#outfitText', '#hairText', '#extraText'].filter((id) => $(id).value.trim()).length : 0);
      return el('button', {
        type: 'button', class: 'stab', role: 'tab', 'aria-selected': String(tab === cur),
        onclick: () => { if (state.prefs.sceneTab !== tab.id) { state.prefs.sceneTab = tab.id; savePrefs(); renderScene(true); } }
      }, icon(tab.icon), tabName(tab), el('span', { class: 'dot', text: n || '' }));
    }));
  }
  function renderPresets() {
    const tab = currentTab();
    const box = $('#presets');
    box.replaceChildren(...tab.groups.map((id) => E.presets.find((g) => g.id === id)).filter(Boolean).map((g) => {
      const chosen = state.prefs.opts[g.id] || [];
      return el('div', { class: 'group', 'data-group': g.id },
        el('h3', {}, groupName(g), g.max > 1 ? el('small', { text: t('scene.max', { n: g.max }) }) : null),
        el('div', { class: 'chips' }, ...g.options.map((o) => el('button', {
          class: 'chip', 'aria-pressed': String(chosen.includes(o.id)), title: o.en,
          onclick: () => toggleOpt(g, o.id)
        }, g.id === 'aspect' ? el('span', { class: 'ratio', style: `aspect-ratio:${o.id.replace(':', '/')}` }) : null, optionName(o)))));
    }));
    $('#subjectFields').hidden = !tab.fields;
  }

  // 快速風格
  const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const lookMatches = (look) => E.presets.every((g) => sameList(state.prefs.opts[g.id] || [], look.opts[g.id] || []));
  function lookSummary(look) {
    return ['aspect', 'lens', 'aperture'].map((id) => {
      const g = E.presets.find((x) => x.id === id);
      const o = g && g.options.find((x) => x.id === (look.opts[id] || [])[0]);
      return o ? o.zh.split(' ')[0] : '';
    }).filter(Boolean).join(' · ');
  }
  function renderLooks() {
    $('#looks').replaceChildren(...E.looks.map((look) => {
      const [a, b, c] = look.g;
      return el('button', {
        type: 'button', class: 'look', 'aria-pressed': String(lookMatches(look)),
        style: `--sw: radial-gradient(120% 90% at 15% 0%, ${a}, transparent 62%), linear-gradient(135deg, ${a}, ${b} 55%, ${c})`,
        onclick: () => applyLook(look)
      }, el('strong', { text: I.lang === 'en' ? look.en : look.zh }), el('small', { text: lookSummary(look) }));
    }));
  }
  function applyLook(look) {
    const opts = {};
    for (const g of E.presets) opts[g.id] = (look.opts[g.id] || (g.required ? g.default : []) || []).slice();
    state.prefs.opts = opts;
    savePrefs();
    renderScene();
    renderReadout();
    updatePrompt();
  }
  function resetScene() {
    const opts = {};
    for (const g of E.presets) opts[g.id] = g.default ? g.default.slice() : [];
    state.prefs.opts = opts;
    savePrefs();
    renderScene();
    renderReadout();
    updatePrompt();
  }

  // 點擊舞台上的讀數，跳到對應的設定
  function jumpToGroup(id) {
    state.prefs.sceneTab = tabOf(id).id;
    savePrefs();
    renderScene(true);
    const node = document.querySelector(`#presets [data-group="${id}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  function renderReadout() {
    const parts = [];
    for (const [id, tag] of READOUT) {
      const group = E.presets.find((g) => g.id === id);
      const ids = state.prefs.opts[id] || [];
      const first = group && group.options.find((o) => o.id === ids[0]);
      if (!first) continue;
      const name = optionName(first);
      parts.push(el('button', { type: 'button', title: groupName(group), onclick: () => jumpToGroup(id) },
        el('b', { text: tag }), ids.length > 1 ? `${name} +${ids.length - 1}` : name));
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
    renderScene();
    renderReadout();
    updatePrompt();
  }

  // ---------- 浮動生成列 ----------
  // 合成區捲出畫面時，在底部顯示已選素材及「生成」按鈕
  function renderDock() {
    const dock = $('#dock');
    if (!dock) return;
    $('#dockSlots').replaceChildren(...SLOTS.map((s) => {
      const item = state.selected[s.id];
      return el('button', {
        type: 'button', class: 'dock-slot', title: slotLabel(s.id),
        'aria-label': t('slot.aria', { label: slotLabel(s.id), name: item ? displayName(item) : t('slot.none') }),
        onclick: () => openLibrary(s.id)
      }, item ? el('img', { src: fullUrl(item), alt: '' }) : icon(s.id));
    }));
    $('#dockStatus').textContent = $('#status').textContent;
    $('#dockGo').disabled = $('#generate').disabled;
    dock.classList.toggle('busy', !!state.abort);
  }
  // 生成列大部分不在畫面內時顯示浮動列；切換到 Prompt 分頁時 IntersectionObserver 未必觸發，所以亦會直接計算
  const DOCK_SHOW_BELOW = 0.6;
  function updateDock() {
    const r = $('.actionbar').getBoundingClientRect();
    const seen = r.height ? Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height : 0;
    $('#dock').hidden = state.prefs.page !== 'prompt' || seen > DOCK_SHOW_BELOW;
    if (!$('#dock').hidden) renderDock();
  }
  function watchDock() {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(updateDock, { threshold: [0, DOCK_SHOW_BELOW, 1] }).observe($('.actionbar'));
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
    renderPeek();
    renderDock();
  }
  // Prompt 收起時顯示的摘要
  function renderPeek() {
    const lines = $('#prompt').value.split('\n').filter((x) => x.trim()).length;
    const lang = { en: 'EN', ja: 'JA', zh: 'ZH' }[state.prefs.lang] || '';
    const summary = `${lang} · ${t('prompt.lines', { n: lines })}`;
    $('#promptPeek').replaceChildren(
      state.promptEdited ? el('span', { class: 'edited', text: t('prompt.editedTag') }) : '',
      summary);
    // 合成區的指令格：等式的結果，顯示指令內容
    const text = $('#prompt').value.trim();
    $('#promptFrame').replaceChildren(text
      ? el('span', { class: 'prompt-text', text })
      : el('span', { class: 'slot-empty' }, el('span', { class: 'glyph' }, icon('text')), el('span', { text: t('prompt.empty') })));
    $('#promptMeta').textContent = state.promptEdited ? `${t('prompt.editedTag')} · ${summary}` : summary;
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
    // 指令是由這組選擇組成；先記低，生成期間改動選項也不會影響這張圖的紀錄
    const composition = snapshotComposition();

    const ctrl = new AbortController();
    state.abort = ctrl;
    $('#cancel').hidden = false;
    $('#resultFrame').classList.add('busy');
    updateGenerateButton();
    setStatus(t('status.preparing'));

    try {
      const images = [];
      for (const r of refs) images.push({ role: r.role, ...(await prepareImage(await itemFile(r.item))) });
      const blobs = await adapter.generate({
        prompt, images, aspect,
        size: E.sizeFor(aspect),
        settings: engineSettings(adapter.id),
        signal: ctrl.signal,
        onStatus: (m) => setStatus(m)
      });
      const time = new Date();
      for (const blob of blobs) {
        state.history.unshift({ url: URL.createObjectURL(blob), blob, prompt, composition, engine: adapter.id, time });
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

  // 人物、服裝、姿勢加上場景設定，即是組成指令的全部來源
  function snapshotComposition() {
    return {
      refs: { ...state.selected },
      opts: JSON.parse(JSON.stringify(state.prefs.opts)),
      text: currentText(),
      keepHair: state.prefs.keepHair,
      lang: state.prefs.lang,
      promptEdited: state.promptEdited
    };
  }

  // 還原歷史紀錄中的組合；素材庫已清空的話，先把用過的圖加回去
  function restoreComposition(h) {
    const c = h.composition;
    for (const s of SLOTS) {
      const used = c.refs[s.id];
      if (used && !state.libs[s.id].some((i) => i.id === used.id)) {
        if (isBuiltin(used)) addBuiltinItems(s.id, [used]);
        else addItems(s.id, [{ file: used.file, path: used.path }]);
      }
      setSelected(s.id, used ? state.libs[s.id].find((i) => i.id === used.id) || null : null);
    }
    state.prefs.opts = JSON.parse(JSON.stringify(c.opts));
    state.prefs.keepHair = c.keepHair;
    state.prefs.lang = c.lang;
    $('#outfitText').value = c.text.outfit;
    $('#hairText').value = c.text.hair;
    $('#extraText').value = c.text.extra;
    $('#keepHair').checked = c.keepHair;
    $('#lang').value = c.lang;
    savePrefs();
    renderTabs();
    renderLibrary();
    renderSlots();
    renderScene();
    renderReadout();
    // 送出時的指令可能經過手動修改或潤飾，所以直接採用當時的文字
    updatePrompt(true);
    $('#prompt').value = h.prompt;
    state.promptEdited = c.promptEdited;
    $('#promptNote').textContent = c.promptEdited ? t('note.edited') : '';
    updateGenerateButton();
    $('#viewerDlg').close();
    setStatus(t('status.restored'));
  }

  function openViewer(h) {
    $('#viewerImg').src = h.url;
    $('#viewerPrompt').textContent = h.prompt;
    $('#viewerRefs').replaceChildren(...SLOTS.filter((s) => h.composition.refs[s.id]).map((s) => el('figure', {},
      el('img', { src: fullUrl(h.composition.refs[s.id]), alt: '' }),
      el('figcaption', { text: slotLabel(s.id) }))));
    $('#viewerRestore').onclick = () => restoreComposition(h);
    const a = $('#viewerDownload');
    a.href = h.url;
    const stamp = h.time.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `compose-${stamp}.${h.blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;
    $('#viewerCopy').onclick = () => copy(h.prompt);
    $('#viewerDlg').showModal();
  }

  // 剪貼簿普遍只接受 PNG，其他格式先轉換
  // fileOrJob：File 或會得到 File 的 Promise
  async function toPng(fileOrJob) {
    const file = await fileOrJob;
    if (file.type === 'image/png') return file;
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(t('status.copyImageFail')))), 'image/png'));
  }
  // 把 Promise 直接交給 ClipboardItem，讓 write 在點擊當下呼叫（Safari 需要）
  async function copyImage(item) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(itemFile(item)) })]);
      setStatus(t('status.imageCopied'));
    } catch (e) {
      setStatus(t('status.copyImageFail'), true);
    }
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

    renderPage();
    renderTabs();
    renderLibrary();
    renderSlots();
    renderScene();
    renderReadout();
    renderEngineName();
    updatePrompt(true);
    watchDock();
    document.querySelectorAll('.page-tab').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

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
    $('#restoreBtn').addEventListener('click', grantFolders);
    $('#folderInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#filesInput').addEventListener('change', (e) => addFiles(state.pendingSlot, e.target.files));
    $('#generate').addEventListener('click', generate);
    $('#cancel').addEventListener('click', () => state.abort && state.abort.abort());
    $('#promptFrame').addEventListener('click', () => copy($('#prompt').value));
    $('#copyPrompt').addEventListener('click', () => copy($('#prompt').value));
    $('#resetPrompt').addEventListener('click', () => updatePrompt(true));
    $('#enhance').addEventListener('click', enhance);
    $('#prompt').addEventListener('input', () => { state.promptEdited = true; $('#promptNote').textContent = t('note.edited'); updateGenerateButton(); });
    for (const id of ['#outfitText', '#hairText', '#extraText']) $(id).addEventListener('input', () => { updatePrompt(); renderSceneTabs(); });
    $('#resetScene').addEventListener('click', resetScene);
    $('#dockGo').addEventListener('click', generate);
    $('#keepHair').addEventListener('change', (e) => { state.prefs.keepHair = e.target.checked; savePrefs(); updatePrompt(); });
    $('#lang').addEventListener('change', (e) => { state.prefs.lang = e.target.value; savePrefs(); updatePrompt(true); });
    $('#remember').addEventListener('change', (e) => { state.prefs.remember = e.target.checked; savePrefs(); });

    const openSettings = () => { renderSettings(); $('#settingsDlg').showModal(); };
    $('#openSettings').addEventListener('click', openSettings);
    $('#engineBtn').addEventListener('click', openSettings);
    $('#openSources').addEventListener('click', () => $('#sourcesDlg').showModal());
    document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    if (L.canRemember) restoreFolders();
    const auto = SLOTS.map((s) => s.id).filter((slot) => !state.prefs.builtinOff[slot]);
    if (auto.length) loadBuiltin(auto, false);
  }

  init();
})();
