// 字節火山方舟 Doubao Seedream / SeedEdit（/api/v3/images/generations，支援多張參考圖）
// Docs: https://www.volcengine.com/docs/82379/1541523
Engine.i18n.add({
  zh: {
    'doubao.help': '在火山方舟控制台取得 API key，並開通 Seedream / SeedEdit 模型。Seedream 4.0 以上支援多張參考圖；尺寸可用 1K、2K、4K。',
    'doubao.noKey': '尚未填寫火山方舟 API key，請到「設定」填寫。',
    'doubao.working': 'Doubao 生成中…',
    'doubao.noImage': 'Doubao 沒有回傳圖片。',
    'doubao.reply': 'Doubao 回覆：{text}'
  },
  en: {
    'doubao.help': 'Get an API key from the Volcengine Ark console and enable a Seedream / SeedEdit model. Seedream 4.0 and later accept several reference images; size can be 1K, 2K or 4K.',
    'doubao.noKey': 'No Volcengine Ark API key yet. Add one in Settings.',
    'doubao.working': 'Doubao is generating…',
    'doubao.noImage': 'Doubao returned no image.',
    'doubao.reply': 'Doubao reply: {text}'
  }
});

Engine.adapters.register({
  id: 'doubao',
  name: 'Doubao (Ark)',
  kind: 'cloud',
  help: 'doubao.help',
  fields: [
    { key: 'apiKey', label: 'field.apiKey', type: 'password' },
    { key: 'model', label: 'field.model', default: 'doubao-seedream-5-0' },
    { key: 'size', label: 'field.size', default: '2K' },
    { key: 'baseUrl', label: 'field.baseUrl', default: 'https://ark.cn-beijing.volces.com' }
  ],
  async generate({ prompt, images, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error(Engine.t('doubao.noKey'));
    const model = (settings.model || 'doubao-seedream-5-0').trim();
    const base = (settings.baseUrl || 'https://ark.cn-beijing.volces.com').trim().replace(/\/+$/, '');
    let endpoint = base;
    if (!endpoint.endsWith('/images/generations')) {
      endpoint = endpoint.endsWith('/api/v3') || endpoint.endsWith('/v1')
        ? `${endpoint}/images/generations`
        : `${endpoint}/api/v3/images/generations`;
    }

    onStatus(Engine.t('status.prepRefs'));
    const refs = [];
    for (const img of images) refs.push(`data:${img.mime};base64,${await U.blobToBase64(img.blob)}`);

    const body = {
      model,
      prompt,
      size: settings.size || '2K',
      sequential_image_generation: 'disabled',
      watermark: false,
      response_format: 'b64_json'
    };
    // Seedream 4.0+ / SeedEdit 支援 image 陣列（多張參考圖）
    if (refs.length) body.image = refs;

    onStatus(Engine.t('doubao.working'));
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw U.networkHint('Doubao / Volcengine Ark', Engine.t('hint.checkNet'));
    }
    if (!res.ok) throw await U.errorFrom(res, 'Doubao');

    const json = await res.json();
    const item = (json.data || [])[0];
    if (item && item.b64_json) return [U.base64ToBlob(item.b64_json, item.mime_type || 'image/png')];
    if (item && item.url) return [{ url: item.url }];
    const note = (json.error && (json.error.message || json.error.code)) || json.message || JSON.stringify(json).slice(0, 260);
    throw new Error(Engine.t('doubao.noImage') + (note ? Engine.t('doubao.reply', { text: note }) : ''));
  }
});
