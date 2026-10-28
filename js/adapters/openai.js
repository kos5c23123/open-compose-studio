// OpenAI 圖像編輯（/v1/images/edits，可送多張參考圖）
Engine.adapters.register({
  id: 'openai',
  name: 'OpenAI',
  kind: 'cloud',
  help: '喺 OpenAI Platform 攞 API key。尺寸會按畫面比例自動揀直、橫或正方形。',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'password' },
    { key: 'model', label: '模型', default: 'gpt-image-1' }
  ],
  async generate({ prompt, images, aspect, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error('未填 OpenAI API key，請去「設定」填寫。');

    const [a, b] = String(aspect).split(':').map(Number);
    const size = a === b ? '1024x1024' : a < b ? '1024x1536' : '1536x1024';

    const fd = new FormData();
    fd.append('model', (settings.model || 'gpt-image-1').trim());
    fd.append('prompt', prompt);
    fd.append('size', size);
    images.forEach((img, i) => fd.append('image[]', img.blob, img.name || `ref-${i + 1}.png`));

    onStatus('OpenAI 生成緊…');
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: fd,
        signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw U.networkHint('OpenAI', '檢查網絡，或者確認 API key 正確。');
    }
    if (!res.ok) throw await U.errorFrom(res, 'OpenAI');

    const json = await res.json();
    const out = (json.data || []).filter((d) => d.b64_json).map((d) => U.base64ToBlob(d.b64_json, 'image/png'));
    if (!out.length) throw new Error('OpenAI 冇回傳圖片。');
    return out;
  }
});
