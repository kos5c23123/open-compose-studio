// OpenAI 圖像編輯（/v1/images/edits，可傳送多張參考圖）
Engine.i18n.add({
  zh: {
    'openai.help': '請在 OpenAI Platform 取得 API key。尺寸會按畫面比例自動選擇直幅、橫幅或正方形。',
    'openai.noKey': '尚未填寫 OpenAI API key，請到「設定」填寫。',
    'openai.working': 'OpenAI 生成中…',
    'openai.noImage': 'OpenAI 沒有回傳圖片。'
  },
  en: {
    'openai.help': 'Get an API key from the OpenAI Platform. The size (portrait, landscape or square) is picked from the aspect ratio.',
    'openai.noKey': 'No OpenAI API key yet. Add one in Settings.',
    'openai.working': 'OpenAI is generating…',
    'openai.noImage': 'OpenAI returned no image.'
  }
});

Engine.adapters.register({
  id: 'openai',
  name: 'OpenAI',
  kind: 'cloud',
  help: 'openai.help',
  fields: [
    { key: 'apiKey', label: 'field.apiKey', type: 'password' },
    { key: 'model', label: 'field.model', default: 'gpt-image-1' }
  ],
  async generate({ prompt, images, aspect, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error(Engine.t('openai.noKey'));

    const [a, b] = String(aspect).split(':').map(Number);
    const size = a === b ? '1024x1024' : a < b ? '1024x1536' : '1536x1024';

    const fd = new FormData();
    fd.append('model', (settings.model || 'gpt-image-1').trim());
    fd.append('prompt', prompt);
    fd.append('size', size);
    images.forEach((img, i) => fd.append('image[]', img.blob, img.name || `ref-${i + 1}.png`));

    onStatus(Engine.t('openai.working'));
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
      throw U.networkHint('OpenAI', Engine.t('hint.checkNet'));
    }
    if (!res.ok) throw await U.errorFrom(res, 'OpenAI');

    const json = await res.json();
    const out = (json.data || []).filter((d) => d.b64_json).map((d) => U.base64ToBlob(d.b64_json, 'image/png'));
    if (!out.length) throw new Error(Engine.t('openai.noImage'));
    return out;
  }
});
