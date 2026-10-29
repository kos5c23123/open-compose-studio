// 記住已載入的資料夾。
// 重新載入頁面後，File 物件會消失；改為把資料夾的 handle（只是指向資料夾的參照，不複製圖片）
// 存在 IndexedDB，之後再經用戶允許讀取。只有支援 File System Access API 的瀏覽器（Chrome、Edge）可用。
window.Engine = window.Engine || {};

(function () {
  const DB_NAME = 'compose-studio';
  const STORE = 'folders';
  // 素材圖片，以及資料夾內可能附帶、從原站儲存的分類資料檔
  const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
  const META_RE = /\.(html?|js|json)$/i;
  const META_MAX_BYTES = 8 * 1024 * 1024;
  const BATCH = 32;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // 在單一 transaction 內執行 fn(store)，完成後回傳其結果
  async function run(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  // 所有紀錄連同其鍵：[{ key, slot, handle }]
  async function rows() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const found = [];
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { resolve(found); return; }
          found.push({ key: cur.key, ...cur.value });
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }
  const removeKeys = (keys) => run('readwrite', (s) => {
    for (const k of keys) s.delete(k);
    return s.count();
  });

  // 遞迴列出資料夾內的圖片及資料檔；path 與 <input webkitdirectory> 的 webkitRelativePath 相同，
  // 這樣由選取或還原載入的素材會有相同的 id
  async function scan(root) {
    const found = [];
    async function walk(dir, prefix) {
      const files = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
        else if (IMAGE_RE.test(name) || META_RE.test(name)) files.push({ handle, path: `${prefix}${name}` });
      }
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const got = await Promise.all(batch.map((f) => f.handle.getFile()));
        got.forEach((file, n) => found.push({ file, path: batch[n].path }));
      }
    }
    await walk(root, `${root.name}/`);
    return found;
  }

  Engine.library = {
    IMAGE_RE, META_RE, META_MAX_BYTES,
    canRemember: typeof window.showDirectoryPicker === 'function' && 'indexedDB' in window,
    pickDirectory: () => window.showDirectoryPicker({ mode: 'read' }),
    scan,
    // 讀取權限；request 為 true 時會向用戶詢問（必須在點擊等操作中呼叫）
    permission(handle, request) {
      const opts = { mode: 'read' };
      return request ? handle.requestPermission(opts) : handle.queryPermission(opts);
    },
    // 同一個資料夾再選一次時沿用原本的紀錄；同名但不同的資料夾另存一筆
    async remember(slot, handle) {
      let key = `${slot}:${handle.name}:${Date.now()}`;
      for (const r of await rows()) {
        if (r.slot === slot && await r.handle.isSameEntry(handle)) key = r.key;
      }
      await run('readwrite', (s) => s.put({ slot, handle }, key));
    },
    recall: rows,
    async forget(slot) {
      await removeKeys((await rows()).filter((r) => r.slot === slot).map((r) => r.key));
    },
    forgetFolder: (row) => removeKeys([row.key])
  };
})();
