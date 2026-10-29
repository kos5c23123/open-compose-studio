// 記住已載入的資料夾。
// 重新載入頁面後，File 物件會消失；改為把資料夾的 handle（只是指向資料夾的參照，不複製圖片）
// 存在 IndexedDB，之後再經用戶允許讀取。只有支援 File System Access API 的瀏覽器（Chrome、Edge）可用。
window.Engine = window.Engine || {};

(function () {
  const DB_NAME = 'compose-studio';
  const STORE = 'folders';
  const FILE_RE = /\.(png|jpe?g|webp|html?|js|json)$/i;
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

  const keyOf = (slot, handle) => `${slot}:${handle.name}`;

  // 遞迴列出資料夾內的圖片及資料檔；path 與 <input webkitdirectory> 的 webkitRelativePath 相同，
  // 這樣由選取或還原載入的素材會有相同的 id
  async function scan(root) {
    const found = [];
    async function walk(dir, prefix) {
      const files = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
        else if (FILE_RE.test(name)) files.push({ handle, path: `${prefix}${name}` });
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
    canRemember: typeof window.showDirectoryPicker === 'function' && 'indexedDB' in window,
    pickDirectory: () => window.showDirectoryPicker({ mode: 'read' }),
    scan,
    // 讀取權限；request 為 true 時會向用戶詢問（必須在點擊等操作中呼叫）
    permission(handle, request) {
      const opts = { mode: 'read' };
      return request ? handle.requestPermission(opts) : handle.queryPermission(opts);
    },
    remember: (slot, handle) => run('readwrite', (s) => s.put({ slot, handle }, keyOf(slot, handle))),
    async recall() {
      return run('readonly', (s) => s.getAll());
    },
    async forget(slot) {
      const rows = await run('readonly', (s) => s.getAll());
      await run('readwrite', (s) => {
        for (const r of rows) if (r.slot === slot) s.delete(keyOf(slot, r.handle));
        return s.count();
      });
    }
  };
})();
