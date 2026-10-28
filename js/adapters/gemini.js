// Google Gemini 圖像模型（generateContent，多張參考圖 + 文字）
Engine.i18n.add({
  zh: {
    'gemini.help': '請在 Google AI Studio 取得 API key。如模型推出新版本，可直接修改「模型」欄。',
    'gemini.noKey': '尚未填寫 Gemini API key，請到「設定」填寫。',
    'gemini.working': 'Gemini 生成中…',
    'gemini.noImage': 'Gemini 沒有回傳圖片。',
    'gemini.blocked': '拒絕原因：{reason}。',
    'gemini.reply': '模型回覆：{text}'
  },
  en: {
    'gemini.help': 'Get an API key from Google AI Studio. If a newer model is released, change the Model field.',
    'gemini.noKey': 'No Gemini API key yet. Add one in Settings.',
    'gemini.working': 'Gemini is generating…',
    'gemini.noImage': 'Gemini returned no image. ',
    'gemini.blocked': 'Blocked: {reason}. ',
    'gemini.reply': 'Model reply: {text}'
  }
});

Engine.adapters.register({
  id: 'gemini',
  name: 'Google Gemini',
  kind: 'cloud',
  help: 'gemini.help',
  fields: [
    { key: 'apiKey', label: 'field.apiKey', type: 'password' },
    { key: 'model', label: 'field.model', default: 'gemini-2.5-flash-image' }
  ],
  async generate({ prompt, images, aspect, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error(Engine.t('gemini.noKey'));
    const model = (settings.model || 'gemini-2.5-flash-image').trim();

    onStatus(Engine.t('status.prepRefs'));
    const parts = [];
    for (const img of images) {
      parts.push({ inline_data: { mime_type: img.mime, data: await U.blobToBase64(img.blob) } });
    }
    parts.push({ text: prompt });

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }
    };

    onStatus(Engine.t('gemini.working'));
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw U.networkHint('Gemini', Engine.t('hint.checkNet'));
    }
    if (!res.ok) throw await U.errorFrom(res, 'Gemini');

    const json = await res.json();
    const out = [];
    let note = '';
    for (const c of json.candidates || []) {
      for (const p of (c.content && c.content.parts) || []) {
        const d = p.inlineData || p.inline_data;
        if (d && d.data) out.push(U.base64ToBlob(d.data, d.mimeType || d.mime_type || 'image/png'));
        else if (p.text) note += p.text;
      }
      if (!out.length && c.finishReason && c.finishReason !== 'STOP') note += ` (${c.finishReason})`;
    }
    if (!out.length) {
      const block = json.promptFeedback && json.promptFeedback.blockReason;
      throw new Error(Engine.t('gemini.noImage') + (block ? Engine.t('gemini.blocked', { reason: block }) : '') + (note ? Engine.t('gemini.reply', { text: note.slice(0, 300) }) : ''));
    }
    return out;
  }
});
