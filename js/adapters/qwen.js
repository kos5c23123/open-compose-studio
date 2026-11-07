// 阿里雲百煉 Qwen-Image / Qwen-Image-Edit（DashScope multimodal-generation，支援 1–3 張參考圖）
// Docs: https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
Engine.i18n.add({
  zh: {
    'qwen.help': '在阿里雲百煉取得 DashScope API key。預設用 qwen-image-2.0-pro，可改成 3.0-pro、2.1-pro、edit-plus 等；最多 3 張參考圖。北京和新加坡地域的 key 及網域不同。',
    'qwen.noKey': '尚未填寫 DashScope API key，請到「設定」填寫。',
    'qwen.working': 'Qwen 生成中…',
    'qwen.noImage': 'Qwen 沒有回傳圖片。',
    'qwen.reply': 'Qwen 回覆：{text}'
  },
  en: {
    'qwen.help': 'Get a DashScope API key from Alibaba Cloud Model Studio. The default model is qwen-image-2.0-pro; you can use 3.0-pro, 2.1-pro, edit-plus and so on. At most 3 reference images. Beijing and Singapore use different keys and domains.',
    'qwen.noKey': 'No DashScope API key yet. Add one in Settings.',
    'qwen.working': 'Qwen is generating…',
    'qwen.noImage': 'Qwen returned no image.',
    'qwen.reply': 'Qwen reply: {text}'
  }
});

Engine.adapters.register({
  id: 'qwen',
  name: 'Qwen Image',
  kind: 'cloud',
  help: 'qwen.help',
  fields: [
    { key: 'apiKey', label: 'field.apiKey', type: 'password' },
    { key: 'model', label: 'field.model', default: 'qwen-image-2.0-pro' },
    { key: 'baseUrl', label: 'field.baseUrl', default: 'https://dashscope.aliyuncs.com' }
  ],
  async generate({ prompt, images, size, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error(Engine.t('qwen.noKey'));
    const model = (settings.model || 'qwen-image-2.0-pro').trim();
    const base = (settings.baseUrl || 'https://dashscope.aliyuncs.com').trim().replace(/\/+$/, '');
    const endpoint = base.includes('/services/aigc/')
      ? base
      : `${base.replace(/\/api\/v1$/, '')}/api/v1/services/aigc/multimodal-generation/generation`;

    onStatus(Engine.t('status.prepRefs'));
    const content = [];
    // Qwen 圖像編輯最多 3 張輸入圖
    for (const img of images.slice(0, 3)) {
      content.push({ image: `data:${img.mime};base64,${await U.blobToBase64(img.blob)}` });
    }
    content.push({ text: prompt });

    const rawSize = size && size.width && size.height ? `${size.width}*${size.height}` : '1024*1536';
    const body = {
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters: {
        n: 1,
        size: rawSize,
        // 保留我們的 prompt，不讓模型自行改寫（會影響臉／服裝／姿勢約束）
        prompt_extend: false,
        watermark: false
      }
    };

    onStatus(Engine.t('qwen.working'));
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
      throw U.networkHint('Qwen / DashScope', Engine.t('hint.checkNet'));
    }
    if (!res.ok) throw await U.errorFrom(res, 'Qwen');

    const json = await res.json();
    if (json.code && !json.output) {
      throw new Error(Engine.t('qwen.reply', { text: `${json.code}: ${json.message || ''}`.slice(0, 300) }));
    }

    const urls = [];
    const parts = (json.output && json.output.choices && json.output.choices[0] && json.output.choices[0].message && json.output.choices[0].message.content) || [];
    for (const part of parts) if (part && part.image) urls.push(part.image);
    if (!urls.length && json.output && json.output.results) {
      for (const r of json.output.results) if (r && r.url) urls.push(r.url);
    }
    if (!urls.length) {
      const note = json.message || JSON.stringify(json).slice(0, 260);
      throw new Error(Engine.t('qwen.noImage') + (note ? Engine.t('qwen.reply', { text: note }) : ''));
    }

    // DashScope 回傳的是 24 小時有效的圖片網址；試下載成 Blob。
    // 如果 OSS 的 CORS 不允許，退回網址，由 app 直接顯示及讓用戶右鍵另存。
    const out = [];
    for (const url of urls) {
      try {
        const r = await fetch(url, { signal });
        if (!r.ok) throw new Error(String(r.status));
        out.push(await r.blob());
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        out.push({ url });
      }
    }
    return out;
  }
});
