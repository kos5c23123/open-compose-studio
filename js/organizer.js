// 整理素材：為自製的姿勢或人物圖片設定分類，產生符合規律的檔名，
// 再套用到素材庫，或匯出為 ZIP（附 catalog.json）。
// 姿勢檔名：{系列代號}_P{編號}_{角度}，例如 my-standing_P001_front.png
// 人物檔名：{face|styling}_{髮型代號}_{名稱代號}，例如 face_short_001.png
// 由 app.js 呼叫 Engine.organizer.init(ctx) 傳入介面工具。
window.Engine = window.Engine || {};

(function () {
  const E = Engine;
  const C = E.catalog;
  const t = (k, v) => E.t(k, v);
  const HAIRS = Object.keys(C.HAIR_CODES);
  const $ = (sel) => document.querySelector(sel);

  let ctx = null;
  const org = { kind: 'pose', entries: [], sel: new Set(), anchor: null, seq: 0, note: '' };

  const slugify = (s, fallback) => String(s || '').toLowerCase()
    .replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback;
  const pad = (n) => String(Math.max(1, n | 0)).padStart(3, '0');
  const extOf = (name) => {
    const m = /\.(png|jpe?g|webp)$/i.exec(name);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
  };
  const slotOf = (kind) => (kind === 'face' ? 'face' : 'pose');

  function fileName(e) {
    if (org.kind === 'pose') return `${slugify(e.series, 'my-pose')}_P${pad(e.num)}_${e.angle}.${e.ext}`;
    return `${e.section}_${e.hair}_${slugify(e.code, '001')}.${e.ext}`;
  }
  const baseName = (e) => fileName(e).replace(/\.[^.]+$/, '');
  const selected = () => org.entries.filter((e) => org.sel.has(e.key));

  // 同一系列已使用的姿勢編號（包括素材庫內已有的）；skip 內的圖片不計算
  function usedNums(series, skip) {
    const s = slugify(series, 'my-pose');
    const used = new Set();
    for (const e of org.entries) if (!(skip && skip.has(e.key)) && slugify(e.series, 'my-pose') === s) used.add(e.num);
    for (const item of ctx.libraryItems('pose')) {
      if (!item.src && item.info && item.info.kind === 'pose' && item.info.series === s) used.add(parseInt(item.info.num.slice(1), 10) || 0);
    }
    return used;
  }
  // 由 start 開始第一個未使用的編號
  function freeNum(used, start = 1) {
    let n = Math.max(1, start);
    while (used.has(n)) n++;
    return n;
  }
  const nextNum = (series, skip) => freeNum(usedNums(series, skip));

  function addFiles(files, origin) {
    const list = Array.from(files).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    const series = org.entries.length ? org.entries[org.entries.length - 1].series : 'my-pose';
    for (const f of list) {
      const origId = origin ? origin.get(f) : null;
      if (origId && org.entries.some((e) => e.origId === origId)) continue;
      const stem = f.name.replace(/\.[^.]+$/, '');
      const e = {
        key: `e${++org.seq}`, file: f, origId, ext: extOf(f.name), url: null, thumb: null,
        series, seriesLabel: '', num: 0, angle: 'front', cat: '', name: '',
        section: 'face', hair: 'other', code: slugify(stem, pad(org.seq)), style: ''
      };
      org.entries.push(e);
      e.num = nextNum(series);
    }
    render();
  }

  // ---------- 衝突檢查 ----------
  function conflicts() {
    const bad = new Set();
    const seen = new Map();
    const lib = new Set();
    const origIds = new Set(org.entries.map((e) => e.origId).filter(Boolean));
    for (const item of ctx.libraryItems(slotOf(org.kind))) if (!origIds.has(item.id) && !item.src) lib.add(item.file.name.toLowerCase());
    for (const e of org.entries) {
      const n = fileName(e).toLowerCase();
      if (lib.has(n)) bad.add(e.key);
      if (seen.has(n)) { bad.add(e.key); bad.add(seen.get(n)); } else seen.set(n, e.key);
    }
    return bad;
  }

  // ---------- 介面 ----------
  function render() {
    if (!ctx) return;
    renderKind();
    renderGrid();
    renderForm();
  }

  function renderKind() {
    const box = $('#orgKind');
    box.replaceChildren(...[['pose', t('slot.pose')], ['face', t('slot.face')]].map(([k, label]) => ctx.el('button', {
      type: 'button', 'aria-pressed': String(org.kind === k),
      onclick: () => { if (org.kind !== k) { org.kind = k; render(); } }
    }, label)));
  }

  function renderGrid() {
    const grid = $('#orgGrid');
    const bad = conflicts();
    $('#orgCount').textContent = t('org.selected', { n: org.sel.size, total: org.entries.length });
    $('#orgRemove').disabled = !org.sel.size;
    if (!org.entries.length) {
      grid.replaceChildren(ctx.el('div', { class: 'org-drop' }, ctx.icon('images'), ctx.el('p', { text: t('org.drop') })));
    } else {
      grid.replaceChildren(...org.entries.map((e, i) => {
        const tag = org.kind === 'pose' ? `P${pad(e.num)} · ${t(`angle.${e.angle}`)}` : `${t(`section.${e.section}`)} · ${t(`hair.${C.HAIR_CODES[e.hair] || 'other'}`)}`;
        return ctx.el('button', {
          type: 'button', class: `org-card${bad.has(e.key) ? ' bad' : ''}`, 'aria-pressed': String(org.sel.has(e.key)),
          'aria-label': fileName(e), title: `${e.file.name}\n→ ${fileName(e)}`,
          onclick: (ev) => toggle(e, i, ev)
        }, ctx.el('span', { class: 'org-thumb' }, ctx.thumbImg(e), ctx.el('span', { class: 'tag', text: tag })),
          ctx.el('span', { class: 'org-name', text: fileName(e) }));
      }));
    }
    const warn = bad.size ? t('org.conflicts', { n: bad.size }) : org.note;
    $('#orgWarn').textContent = warn;
    $('#orgWarn').classList.toggle('error', !!bad.size);
    $('#orgApply').disabled = $('#orgExport').disabled = !org.entries.length || bad.size > 0;
  }

  function toggle(e, i, ev) {
    if (ev.shiftKey && org.anchor != null) {
      const [a, b] = [Math.min(org.anchor, i), Math.max(org.anchor, i)];
      for (let k = a; k <= b; k++) org.sel.add(org.entries[k].key);
    } else if (org.sel.has(e.key)) {
      org.sel.delete(e.key);
    } else {
      org.sel.add(e.key);
    }
    org.anchor = i;
    org.note = '';
    renderGrid();
    renderForm();
  }

  // 所選圖片的共同值；值不同時回傳 null
  function common(field) {
    const s = selected();
    if (!s.length) return '';
    const v = s[0][field];
    return s.every((e) => e[field] === v) ? v : null;
  }
  function setField(field, value, full) {
    for (const e of selected()) e[field] = value;
    if (full) render(); else renderGrid();
  }

  function input(label, field, opts = {}) {
    const id = `org-${field}`;
    const v = common(field);
    const n = ctx.el('input', {
      id, type: opts.type || 'text', min: opts.min, value: v == null ? '' : String(v),
      placeholder: v == null ? t('org.mixed') : (opts.placeholder || ''), disabled: opts.disabled, autocomplete: 'off', spellcheck: 'false'
    });
    n.addEventListener('input', () => setField(field, opts.type === 'number' ? Math.max(1, parseInt(n.value, 10) || 1) : n.value));
    return ctx.el('div', { class: 'field' }, ctx.el('label', { for: id, text: label }),
      opts.hint ? ctx.el('span', { class: 'hint', text: opts.hint }) : null, n);
  }
  function segField(label, field, values, nameOf, hint) {
    const v = common(field);
    return ctx.el('div', { class: 'field' }, ctx.el('span', { class: 'flabel', text: label }),
      hint ? ctx.el('span', { class: 'hint', text: hint }) : null,
      ctx.el('div', { class: 'seg', role: 'group', 'aria-label': label }, ...values.map((x, i) => ctx.el('button', {
        type: 'button', 'aria-pressed': String(v === x), title: field === 'angle' ? `${nameOf(x)} (${i + 1})` : nameOf(x),
        onclick: () => setField(field, x, true)
      }, nameOf(x)))));
  }

  function renderForm() {
    const box = $('#orgForm');
    const s = selected();
    if (!s.length) {
      box.replaceChildren(ctx.el('p', { class: 'help org-empty', text: t('org.none') }));
      if (org.kind === 'face') box.append(ctx.el('p', { class: 'org-rule', text: t('org.faceRule') }));
      return;
    }
    const head = ctx.el('p', { class: 'org-form-head', text: t('org.editing', { n: s.length }) });
    if (org.kind === 'pose') {
      box.replaceChildren(head,
        input(t('org.series'), 'series', { hint: t('org.seriesHint'), placeholder: 'my-pose' }),
        input(t('org.seriesLabel'), 'seriesLabel'),
        input(t('org.num'), 'num', { type: 'number', min: 1 }),
        segField(t('org.angle'), 'angle', C.ANGLES, (a) => t(`angle.${a}`), t('org.angleHint')),
        input(t('org.cat'), 'cat'),
        input(t('org.name'), 'name'),
        ctx.el('div', { class: 'org-actions' },
          ctx.el('button', { type: 'button', class: 'btn small', onclick: groupAsPose, title: t('org.groupHint') }, ctx.icon('pose'), t('org.group')),
          ctx.el('button', { type: 'button', class: 'btn small', onclick: numberEach }, ctx.icon('text'), t('org.split'))),
        ctx.el('p', { class: 'hint', text: t('org.groupHint') }));
    } else {
      box.replaceChildren(head,
        segField(t('org.section'), 'section', C.SECTIONS, (x) => t(`section.${x}`)),
        segField(t('org.hair'), 'hair', HAIRS, (x) => t(`hair.${C.HAIR_CODES[x] || 'other'}`)),
        input(t('org.code'), 'code', { hint: s.length > 1 ? t('org.codeHint') : t('org.seriesHint'), disabled: s.length > 1 }),
        input(t('org.style'), 'style'),
        ctx.el('div', { class: 'org-actions' },
          ctx.el('button', { type: 'button', class: 'btn small', onclick: autoCode }, ctx.icon('text'), t('org.autoCode'))),
        ctx.el('p', { class: 'org-rule', text: t('org.faceRule') }));
    }
  }

  // 設為同一姿勢：同一編號，按次序分配角度
  function groupAsPose() {
    const s = selected();
    if (s.length > C.ANGLES.length) { org.note = t('org.tooMany', { n: C.ANGLES.length }); renderGrid(); return; }
    const keys = new Set(s.map((e) => e.key));
    const series = s[0].series;
    const num = freeNum(usedNums(series, keys), Math.min(...s.map((e) => e.num)));
    s.forEach((e, i) => { e.series = series; e.num = num; e.angle = C.ANGLES[i]; });
    org.note = '';
    render();
  }
  // 逐張編號：每張一個新編號
  function numberEach() {
    const s = selected();
    const keys = new Set(s.map((e) => e.key));
    const used = usedNums(s[0].series, keys);
    let n = Math.min(...s.map((e) => e.num));
    for (const e of s) { n = freeNum(used, n); e.series = s[0].series; e.num = n; used.add(n); }
    render();
  }
  function autoCode() {
    selected().forEach((e, i) => { e.code = pad(i + 1); });
    render();
  }

  function onKey(ev) {
    if (!$('#orgDlg').open || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      org.entries.forEach((e) => org.sel.add(e.key));
      renderGrid(); renderForm();
      return;
    }
    const k = parseInt(ev.key, 10);
    if (org.kind === 'pose' && k >= 1 && k <= C.ANGLES.length && org.sel.size) {
      ev.preventDefault();
      setField('angle', C.ANGLES[k - 1], true);
    }
  }

  // ---------- 輸出 ----------
  function results() {
    return org.entries.map((e) => ({
      e, name: fileName(e), id: baseName(e),
      file: new File([e.file], fileName(e), { type: e.file.type || (e.ext === 'jpg' ? 'image/jpeg' : `image/${e.ext}`) })
    }));
  }
  function catalogData(rows) {
    const data = { pose: {}, face: {}, series: {} };
    for (const { e, id } of rows) {
      if (org.kind === 'pose') {
        if (e.cat || e.name) data.pose[id] = [e.cat, e.name];
        if (e.seriesLabel) data.series[slugify(e.series, 'my-pose')] = e.seriesLabel;
      } else if (e.style) {
        data.face[id] = ['', e.style];
      }
    }
    return data;
  }

  function apply() {
    const rows = results();
    const data = catalogData(rows);
    for (const { e, id } of rows) {
      if (org.kind === 'pose') C.setPose(id, e.cat, e.name);
      else C.setFace(id, e.style);
    }
    for (const [k, v] of Object.entries(data.series)) C.setSeries(k, v);
    C.save();
    ctx.apply(slotOf(org.kind), rows.map((r) => r.file), rows.map((r) => r.e.origId).filter(Boolean));
    ctx.setStatus(t('org.applied', { n: rows.length }));
    reset();
    $('#orgDlg').close();
  }

  async function exportZip() {
    const rows = results();
    const btn = $('#orgExport');
    btn.disabled = true;
    try {
      const files = rows.map((r) => ({ name: r.name, blob: r.file }));
      files.push({ name: 'catalog.json', blob: new Blob([C.buildCatalog(catalogData(rows))], { type: 'application/json' }) });
      const blob = await E.zip(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `compose-studio-${org.kind === 'pose' ? 'poses' : 'faces'}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      org.note = t('org.exported', { n: rows.length });
    } finally {
      renderGrid();
    }
  }

  function removeSelected() {
    org.entries = org.entries.filter((e) => {
      if (!org.sel.has(e.key)) return true;
      if (e.thumb) URL.revokeObjectURL(e.thumb);
      return false;
    });
    org.sel.clear();
    org.anchor = null;
    render();
  }
  function reset() {
    for (const e of org.entries) if (e.thumb) URL.revokeObjectURL(e.thumb);
    org.entries = [];
    org.sel.clear();
    org.anchor = null;
    org.note = '';
  }

  E.organizer = {
    init(c) {
      ctx = c;
      $('#orgAdd').addEventListener('click', () => { $('#orgInput').value = ''; $('#orgInput').click(); });
      $('#orgInput').addEventListener('change', (ev) => addFiles(ev.target.files));
      $('#orgAll').addEventListener('click', () => { org.entries.forEach((e) => org.sel.add(e.key)); renderGrid(); renderForm(); });
      $('#orgNone').addEventListener('click', () => { org.sel.clear(); renderGrid(); renderForm(); });
      $('#orgRemove').addEventListener('click', removeSelected);
      $('#orgApply').addEventListener('click', apply);
      $('#orgExport').addEventListener('click', exportZip);
      const drop = $('#orgDlg');
      drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('dragging'); });
      drop.addEventListener('dragleave', (ev) => { if (ev.target === drop) drop.classList.remove('dragging'); });
      drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('dragging'); addFiles(ev.dataTransfer.files); });
      document.addEventListener('keydown', onKey);
    },
    // kind：'pose' 或 'face'；items：要整理的素材庫圖片（可選）
    open(kind, items) {
      org.kind = kind === 'face' ? 'face' : 'pose';
      if (items && items.length) {
        const origin = new Map(items.map((i) => [i.file, i.id]));
        addFiles(items.map((i) => i.file), origin);
      }
      org.note = '';
      render();
      if (!$('#orgDlg').open) $('#orgDlg').showModal();
    },
    refresh() { if ($('#orgDlg').open) render(); }
  };
})();
