// 素材分類。
// 1. 由檔名分析分類（不需要任何額外資料）：
//    姿勢：{系統}_P{編號}_{角度}，例如 full_single_P001_front
//    人物：ai-face-{id} 或 ai-styling-{id}（原站）；{face|styling}_{髮型}_{名稱}（自製，例如 face_short_001）
//    服裝：{季節或類別代號}-{編號}，例如 SPR-0001（原站下載的檔名）
// 2. 可選：由用戶自行從原站儲存的檔案讀取分類資料（姿勢分類、姿勢名稱、髮型），
//    只在瀏覽器內處理。本 repo 不附帶任何原站資料。服裝只需要關鍵字，類別已在檔名內。
// 3. 自製素材的分類資料可匯出為 catalog.json（格式見 buildCatalog），再次載入時自動讀取。
window.Engine = window.Engine || {};

(function () {
  const ANGLES = ['front', 'high', 'low', 'side', 'diag', 'back'];
  const SERIES = ['full_single', 'full_sexy', 'upper80v2', 'pair60'];
  const SECTIONS = ['face', 'styling'];
  const HAIRS = ['ショート', 'ミディアム', 'セミロング', 'ロング'];
  // 自製人物檔名中的髮型代號，對應原站的髮型分類
  // 服裝檔名前綴，次序與原站的分類按鈕一致
  const OUTFIT_CODES = ['SPR', 'SUM', 'AUT', 'WIN', 'LNG', 'PTY', 'SWM', 'SXY'];
  const HAIR_CODES = { short: 'ショート', medium: 'ミディアム', semilong: 'セミロング', long: 'ロング', other: '' };
  const CATALOG_FORMAT = 'compose-studio-catalog';
  const META_KEY = 'compose-studio:meta:v1';

  const POSE_RE = /^(.+?)_(P\d{2,4})_(front|high|low|side|diag|back)$/i;
  const FACE_RE = /^ai-(face|styling)-([0-9a-z]+)$/i;
  const OUTFIT_RE = new RegExp(`^(${OUTFIT_CODES.join('|')})-(\\d{3,4})$`, 'i');
  const OWN_FACE_RE = /^(face|styling)_(short|medium|semilong|long|other)_(.+)$/i;

  // meta：{ pose: { id: [分類, 名稱] }, face: { id: [髮型, 髮型細項] }, outfit: { id: 關鍵字 }, series: { 前綴: 原站系統名 } }
  let meta = { pose: {}, face: {}, outfit: {}, series: {} };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) meta = Object.assign(meta, JSON.parse(raw));
  } catch (e) { /* 無法使用 storage 時只保留在記憶體 */ }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
  }

  const C = Engine.catalog = {
    ANGLES, SERIES, SECTIONS, HAIRS, HAIR_CODES, OUTFIT_CODES,

    // 由檔名（不含副檔名）取得結構化資料
    parse(name) {
      let m = POSE_RE.exec(name);
      if (m) {
        const series = m[1].toLowerCase();
        const num = m[2].toUpperCase();
        return { kind: 'pose', series, num, angle: m[3].toLowerCase(), key: `${series}|${num}`, id: name };
      }
      m = OUTFIT_RE.exec(name);
      if (m) {
        const code = m[1].toUpperCase();
        return { kind: 'outfit', code, id: `${code}-${m[2]}` };
      }
      m = FACE_RE.exec(name);
      if (m) return { kind: 'face', section: m[1].toLowerCase(), id: m[2].toLowerCase() };
      m = OWN_FACE_RE.exec(name);
      if (m) return { kind: 'face', section: m[1].toLowerCase(), hairCode: m[2].toLowerCase(), id: name };
      return null;
    },

    // 取得分類資料（檔名分析 + 已載入的原站資料）
    poseMeta(info) {
      const row = info && meta.pose[info.id];
      return { cat: row ? row[0] : '', name: row ? row[1] : '' };
    },
    faceMeta(info) {
      const row = info && meta.face[info.id];
      const hair = info && info.hairCode ? HAIR_CODES[info.hairCode] : (row ? row[0] : '');
      return { hair, style: row ? row[1] : '' };
    },
    outfitMeta(info) {
      return { keywords: (info && meta.outfit[info.id]) || '' };
    },
    outfitName(code) {
      return Engine.t(`outfit.${code}`);
    },
    // 寫入自製素材的分類資料
    setPose(id, cat, name) {
      if (cat || name) meta.pose[id] = [cat || '', name || ''];
      else delete meta.pose[id];
    },
    setFace(id, style) {
      if (style) meta.face[id] = ['', style];
      else delete meta.face[id];
    },
    setSeries(prefix, label) {
      if (label) meta.series[prefix] = label;
    },
    save() { saveMeta(); },
    // catalog.json：{ format, version, pose: { id: [分類, 名稱] }, face: { id: [髮型, 細項] }, series: { 前綴: 名稱 } }
    buildCatalog(data) {
      return JSON.stringify(Object.assign({ format: CATALOG_FORMAT, version: 1, pose: {}, face: {}, series: {} }, data), null, 2);
    },
    seriesName(prefix) {
      const key = `series.${prefix}`;
      return Engine.i18n.has(key) ? Engine.t(key) : (meta.series[prefix] || prefix);
    },
    hairName(hair) {
      const key = `hair.${hair}`;
      return Engine.i18n.has(key) ? Engine.t(key) : hair;
    },
    counts() {
      return { pose: Object.keys(meta.pose).length, face: Object.keys(meta.face).length, outfit: Object.keys(meta.outfit).length };
    },
    clear() {
      meta = { pose: {}, face: {}, outfit: {}, series: {} };
      saveMeta();
    },

    // 由文字讀取分類資料。成功時回傳 { kind: 'pose' | 'face', n }，否則回傳 null。
    // 姿勢、服裝：原站網頁另存的 HTML（內含 const D=[...]，服裝的資料列有「カテゴリ」欄）
    // 人物：原站的 data/images.js（內含 window.GALLERY_IMAGES = [...]）
    importText(text) {
      if (/^\s*\{/.test(text)) {
        let d;
        try { d = JSON.parse(text); } catch (e) { d = null; }
        if (d && d.format === CATALOG_FORMAT) {
          let n = 0;
          for (const [id, row] of Object.entries(d.pose || {})) { meta.pose[id] = [String(row[0] || ''), String(row[1] || '')]; n++; }
          for (const [id, row] of Object.entries(d.face || {})) { meta.face[id] = [String(row[0] || ''), String(row[1] || '')]; n++; }
          for (const [k, v] of Object.entries(d.series || {})) meta.series[k] = String(v);
          saveMeta();
          return { kind: 'own', n };
        }
      }
      const pose = /const\s+D\s*=\s*(\[[\s\S]*?\])\s*;\s*\n/.exec(text);
      if (pose) {
        let rows;
        try { rows = JSON.parse(pose[1]); } catch (e) { rows = null; }
        if (Array.isArray(rows) && rows.length && rows.some((d) => d && OUTFIT_RE.test(String(d.id)))) {
          let n = 0;
          for (const d of rows) {
            const info = d && d.id ? C.parse(String(d.id)) : null;
            if (!info || info.kind !== 'outfit') continue;
            meta.outfit[info.id] = String(d['キーワード'] || '').trim();
            n++;
          }
          if (n) { saveMeta(); return { kind: 'outfit', n }; }
        } else if (Array.isArray(rows) && rows.length) {
          let n = 0;
          for (const d of rows) {
            if (!d || !d.id) continue;
            meta.pose[d.id] = [String(d['分類'] || '').trim(), String(d['ポーズ名'] || '').trim()];
            const info = C.parse(d.id);
            if (info && d['系統']) meta.series[info.series] = d['系統'];
            n++;
          }
          if (n) { saveMeta(); return { kind: 'pose', n }; }
        }
      }
      const at = text.indexOf('GALLERY_IMAGES');
      if (at >= 0) {
        const start = text.indexOf('[', at);
        const end = text.lastIndexOf(']');
        let rows;
        try { rows = JSON.parse(text.slice(start, end + 1)); } catch (e) { rows = null; }
        if (Array.isArray(rows) && rows.length) {
          let n = 0;
          for (const d of rows) {
            if (!d || !d.id) continue;
            meta.face[String(d.id).toLowerCase()] = [String(d.hair || '').trim(), String(d.style || '').trim()];
            n++;
          }
          if (n) { saveMeta(); return { kind: 'face', n }; }
        }
      }
      return null;
    }
  };

  Engine.i18n.add({
    zh: {
      'series.full_single': '全身・標準',
      'series.full_sexy': '全身・性感',
      'series.upper80v2': '上半身',
      'series.pair60': '雙人',
      'angle.front': '正面',
      'angle.high': '俯視',
      'angle.low': '仰視',
      'angle.side': '側面',
      'angle.diag': '斜側',
      'angle.back': '背面',
      'outfit.SPR': '春',
      'outfit.SUM': '夏',
      'outfit.AUT': '秋',
      'outfit.WIN': '冬',
      'outfit.LNG': '內衣',
      'outfit.PTY': '派對',
      'outfit.SWM': '泳裝',
      'outfit.SXY': '性感',
      'section.face': '臉部',
      'section.styling': '造型',
      'hair.ショート': '短髮',
      'hair.ミディアム': '中長髮',
      'hair.セミロング': '半長髮',
      'hair.ロング': '長髮'
    },
    en: {
      'series.full_single': 'Full body · Standard',
      'series.full_sexy': 'Full body · Glamour',
      'series.upper80v2': 'Upper body',
      'series.pair60': 'Two people',
      'angle.front': 'Front',
      'angle.high': 'High',
      'angle.low': 'Low',
      'angle.side': 'Side',
      'angle.diag': '3/4',
      'angle.back': 'Back',
      'outfit.SPR': 'Spring',
      'outfit.SUM': 'Summer',
      'outfit.AUT': 'Autumn',
      'outfit.WIN': 'Winter',
      'outfit.LNG': 'Lingerie',
      'outfit.PTY': 'Party',
      'outfit.SWM': 'Swimwear',
      'outfit.SXY': 'Sexy',
      'section.face': 'Face',
      'section.styling': 'Styling',
      'hair.ショート': 'Short',
      'hair.ミディアム': 'Medium',
      'hair.セミロング': 'Semi-long',
      'hair.ロング': 'Long'
    }
  });
})();
