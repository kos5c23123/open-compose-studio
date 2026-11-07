// xAI Grok Imagine（/v1/images/edits 支援最多 5 張參考圖，或 /v1/images/generations）
// Docs: https://docs.x.ai/developers/model-capabilities/images/generation
Engine.i18n.add({
  zh: {
    'grok.help': '在 xAI Console 取得 API key。Grok Imagine 支援最多 5 張參考圖；多圖時 prompt 會用 <IMAGE_0>、<IMAGE_1>… 對應。',
    'grok.noKey': '尚未填寫 xAI API key，請到「設定」填寫。',
    'grok.working': 'Grok Imagine 生成中…',
    'grok.noImage': 'Grok 沒有回傳圖片。',
    'grok.reply': 'Grok 回覆：{text}'
  },
  en: {
    'grok.help': 'Get an API key from the xAI Console. Grok Imagine accepts up to 5 reference images; with several images the prompt uses <IMAGE_0>, <IMAGE_1>… placeholders.',
    'grok.noKey': 'No xAI API key yet. Add one in Settings.',
    'grok.working': 'Grok Imagine is generating…',
    'grok.noImage': 'Grok returned no image.',
    'grok.reply': 'Grok reply: {text}'
  }
});

Engine.adapters.register({
  id: 'grok',
  name: 'xAI Grok',
  kind: 'cloud',
  help: 'grok.help',
  fields: [
    { key: 'apiKey', label: 'field.apiKey', type: 'password' },
    { key: 'model', label: 'field.model', default: 'grok-imagine-image-2.0' },
    { key: 'resolution', label: 'field.resolution', default: '1k' }
  ],
  async generate({ prompt, images, aspect, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error(Engine.t('grok.noKey'));
    const model = (settings.model || 'grok-imagine-image-2.0').trim();

    onStatus(Engine.t('status.prepRefs'));
    const refs = [];
    for (const img of images) refs.push(`data:${img.mime};base64,${await U.blobToBase64(img.blob)}`);

    let text = prompt;
    if (refs.length === 1) {
      // 單圖用 image 物件，唔需要 <IMAGE_n>；把「Image 1」改成「the input image」
      text = prompt.replace(/\bImage 1\b/g, 'the input image');
    } else if (refs.length > 1) {
      // 多圖編輯：官方要求用 <IMAGE_0>、<IMAGE_1>…
      text = prompt.replace(/\bImage (\d+)\b/g, (m, n) => `<IMAGE_${Number(n) - 1}>`);
    }

    const body = {
      model,
      prompt: text,
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: aspect || 'auto',
      resolution: settings.resolution || '1k'
    };
    if (refs.length === 1) body.image = { url: refs[0], type: 'image_url' };
    else if (refs.length > 1) body.images = refs.map((url) => ({ url }));

    // 有參考圖就用 edits，否則用 generations
    const endpoint = refs.length ? 'https://api.x.ai/v1/images/edits' : 'https://api.x.ai/v1/images/generations';

    onStatus(Engine.t('grok.working'));
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
      throw U.networkHint('xAI', Engine.t('hint.checkNet'));
    }
    if (!res.ok) throw await U.errorFrom(res, 'xAI');

    const json = await res.json();
    const item = (json.data || [])[0];
    if (item && item.b64_json) return [U.base64ToBlob(item.b64_json, item.mime_type || 'image/png')];
    if (item && item.url) return [{ url: item.url }];
    const note = (json.error && json.error.message) || JSON.stringify(json).slice(0, 260);
    throw new Error(Engine.t('grok.noImage') + (note ? Engine.t('grok.reply', { text: note }) : ''));
  }
});
