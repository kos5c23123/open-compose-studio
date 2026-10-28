// 模型連接器（adapter）登記處。
// 每個 adapter 係一個 object：
// {
//   id, name, kind: 'cloud' | 'local', help,
//   fields: [{ key, label, type?: 'text'|'password'|'textarea', default?, placeholder? }],
//   async generate({ prompt, images, aspect, size, settings, signal, onStatus }) => Blob[]
// }
// images：[{ role: 'face'|'outfit'|'pose', blob, mime, name }]，次序同 prompt 入面嘅「第 n 張」一致。
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
        r.onerror = () => reject(new Error('讀取圖片失敗'));
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
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('已取消', 'AbortError')); }, { once: true });
      });
    },
    // 將 fetch 錯誤轉成用戶睇得明嘅訊息
    async errorFrom(res, service) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j);
      } catch (e) {
        try { detail = await res.text(); } catch (e2) { /* ignore */ }
      }
      return new Error(`${service} 回覆 ${res.status}：${String(detail).slice(0, 300)}`);
    },
    networkHint(service, hint) {
      return new Error(`連唔到 ${service}。${hint}`);
    }
  };
})();
