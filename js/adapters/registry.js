// 模型連接器（adapter）登記處。
// 每個 adapter 是一個物件：
// {
//   id, name, kind: 'cloud' | 'local', help,
//   fields: [{ key, label, type?: 'text'|'password'|'textarea', default?, placeholder? }],
//   async generate({ prompt, images, aspect, size, settings, signal, onStatus }) => Blob[]
// }
// name、help、label、placeholder 可以是 i18n 字典鍵、普通字串，或 { zh, en } 物件。
// images：[{ role: 'face'|'outfit'|'pose', blob, mime, name }]，次序與 prompt 中的「第 n 張」一致。
window.Engine = window.Engine || {};

(function () {
  const list = [];
  Engine.adapters = {
    register(a) { list.push(a); },
    all() { return list.slice(); },
    get(id) { return list.find((a) => a.id === id) || list[0]; }
  };

  Engine.util = {
    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error(Engine.t('err.readImage')));
        r.readAsDataURL(blob);
      });
    },
    base64ToBlob(b64, mime = 'image/png') {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    },
    sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException(Engine.t('err.cancelled'), 'AbortError')); }, { once: true });
      });
    },
    // 將 fetch 錯誤轉為用戶看得懂的訊息
    async errorFrom(res, service) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j);
      } catch (e) {
        try { detail = await res.text(); } catch (e2) { /* ignore */ }
      }
      return new Error(Engine.t('err.reply', { service, status: res.status, detail: String(detail).slice(0, 300) }));
    },
    networkHint(service, hint) {
      return new Error(Engine.t('err.network', { service, hint }));
    }
  };
})();
