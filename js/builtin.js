// 內置圖庫：data/library.js（由 tools/build_library.py 產生）提供人物、姿勢、服裝。
// 只在需要時載入；縮圖用 images/<類別>/w300/，送出或複製時才下載 w900。
window.Engine = window.Engine || {};

(function () {
  const SRC = 'data/library.js';
  const FOLDER = 'Open Compose Studio';
  // 資料庫的姿勢系列 -> App 原有的系列名稱
  const SERIES = { std: 'full_single', sexy: 'full_sexy', upper: 'upper80v2', duo: 'pair60' };
  let job = null;

  // 以 <script> 載入，從檔案直接開啟頁面時亦可使用
  function load() {
    if (window.COMPOSE_LIBRARY) return Promise.resolve(window.COMPOSE_LIBRARY);
    if (!job) {
      job = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.onload = () => (window.COMPOSE_LIBRARY ? resolve(window.COMPOSE_LIBRARY) : reject(new Error(Engine.t('status.libFail'))));
        s.onerror = () => reject(new Error(Engine.t('status.libFail')));
        document.head.append(s);
      });
      job.catch(() => { job = null; });
    }
    return job;
  }

  const imageUrl = (kind, tier, file) => `images/${kind}/${tier}/${encodeURIComponent(file)}`;

  const stem = (file) => file.replace(/\.[^.]+$/, '');

  // tags：瀏覽用的標籤 { types, colors }（服裝）或 { hair }（人物）
  function entry(kind, file, info, suggestive, tags) {
    const name = stem(file);
    return {
      id: `lib/${kind}/${name}`, file: null, src: imageUrl(kind, 'w900', file), thumbSrc: imageUrl(kind, 'w300', file),
      path: `${FOLDER}/${kind}/${file}`, folder: FOLDER, name, info, suggestive, tags, url: null, thumb: null
    };
  }

  // 回傳 { face, pose, outfit } 三組素材，並把名稱、分類交給 catalog
  function toItems(lib) {
    const C = Engine.catalog;
    const face = lib.face.map((r) => {
      C.addBuiltin('face', r.id, [r.hair, r.style_name || r.style]);
      return entry('face', r.file, { kind: 'face', section: r.section, id: r.id }, false, { hair: r.tags || [] });
    });
    const pose = [];
    for (const r of lib.pose) {
      const series = SERIES[r.series] || r.series;
      for (const [angle, file] of Object.entries(r.views)) {
        const id = stem(file);
        // 分類用我哋自己分的動作；名稱用 Shisei 的英文描述（只有標準系列有）
        C.addBuiltin('pose', id, [r.action ? `action.${r.action}` : '', r.desc]);
        pose.push(entry('pose', file, { kind: 'pose', series, num: r.num, angle, key: `${series}|${r.num}`, id }, r.rating === 'suggestive', {}));
      }
    }
    const outfit = lib.outfit.map((r) => {
      C.addBuiltin('outfit', r.id, r.desc);
      return entry('outfit', r.file, { kind: 'outfit', code: r.code, id: r.id }, r.rating === 'suggestive',
        { types: r.types || [], colors: r.colors || [] });
    });
    return { face, pose, outfit };
  }

  Engine.builtin = { load, toItems, FOLDER };

  Engine.i18n.add({
    zh: {
      'lib.useBuiltin': '使用內置圖庫',
      'lib.showSuggestive': '顯示性感內容',
      'status.libLoaded': '已載入內置圖庫：人物 {f}、姿勢 {p}、服裝 {o}。',
      'status.libFail': '未能載入內置圖庫（data/library.js）。',
      'status.libFetchFail': '未能讀取內置圖庫的圖片。直接由檔案開啟頁面時，瀏覽器會封鎖讀取，請改用網上版本或本機伺服器。',
      'type.dress': '連身裙', 'type.skirt': '半身裙', 'type.trousers': '長褲', 'type.shorts': '短褲',
      'type.outerwear': '外套', 'type.knitwear': '針織', 'type.set': '套裝',
      'color.black': '黑', 'color.white': '白／米白', 'color.brown': '啡／米', 'color.grey': '灰', 'color.blue': '藍',
      'color.green': '綠', 'color.red': '紅', 'color.pink': '粉紅', 'color.orange': '橙', 'color.yellow': '黃', 'color.purple': '紫',
      'hairtag.bob': '波波頭', 'hairtag.layered': '層次', 'hairtag.wavy': '曲髮／電髮', 'hairtag.straight': '直髮',
      'hairtag.wolf': '狼尾', 'hairtag.bangs': '有瀏海', 'hairtag.colored': '染色',
      'action.standing': '站立', 'action.sitting': '坐', 'action.kneeling': '跪', 'action.squatting': '蹲',
      'action.lying': '躺臥', 'action.bending': '彎腰', 'action.dynamic': '伸展動作',
      'action.sign': '手勢', 'action.face': '手近面', 'action.raised': '舉手', 'action.reach': '伸手',
      'action.crossed': '交叉／抱胸', 'action.relaxed': '自然擺手',
      'action.seated': '一齊坐', 'action.floor': '地上', 'action.lift': '抱起／托舉'
    },
    en: {
      'lib.useBuiltin': 'Use the built-in library',
      'lib.showSuggestive': 'Show suggestive',
      'status.libLoaded': 'Built-in library loaded: {f} faces, {p} poses, {o} outfits.',
      'status.libFail': 'Could not load the built-in library (data/library.js).',
      'status.libFetchFail': 'Could not read a built-in image. Browsers block this when the page is opened as a file; use the online version or a local server.',
      'type.dress': 'Dress', 'type.skirt': 'Skirt', 'type.trousers': 'Trousers', 'type.shorts': 'Shorts',
      'type.outerwear': 'Outerwear', 'type.knitwear': 'Knitwear', 'type.set': 'Set',
      'color.black': 'Black', 'color.white': 'White / cream', 'color.brown': 'Brown / beige', 'color.grey': 'Grey', 'color.blue': 'Blue',
      'color.green': 'Green', 'color.red': 'Red', 'color.pink': 'Pink', 'color.orange': 'Orange', 'color.yellow': 'Yellow', 'color.purple': 'Purple',
      'hairtag.bob': 'Bob', 'hairtag.layered': 'Layered', 'hairtag.wavy': 'Wavy / perm', 'hairtag.straight': 'Straight',
      'hairtag.wolf': 'Wolf cut', 'hairtag.bangs': 'Bangs', 'hairtag.colored': 'Colored',
      'action.standing': 'Standing', 'action.sitting': 'Sitting', 'action.kneeling': 'Kneeling', 'action.squatting': 'Squatting',
      'action.lying': 'Lying', 'action.bending': 'Bending', 'action.dynamic': 'Stretch / action',
      'action.sign': 'Hand sign', 'action.face': 'Hand near face', 'action.raised': 'Arms raised', 'action.reach': 'Reaching',
      'action.crossed': 'Arms crossed', 'action.relaxed': 'Relaxed arms',
      'action.seated': 'Seated together', 'action.floor': 'On the floor', 'action.lift': 'Lift / carry'
    }
  });
})();
