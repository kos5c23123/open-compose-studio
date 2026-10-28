// Google Gemini 圖像模型（generateContent，多張參考圖 + 文字）
Engine.adapters.register({
  id: 'gemini',
  name: 'Google Gemini',
  kind: 'cloud',
  help: '喺 Google AI Studio 攞 API key。模型名稱如有新版本，直接改「模型」欄。',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'password' },
    { key: 'model', label: '模型', default: 'gemini-2.5-flash-image' }
  ],
  async generate({ prompt, images, aspect, settings, signal, onStatus }) {
    const U = Engine.util;
    if (!settings.apiKey) throw new Error('未填 Gemini API key，請去「設定」填寫。');
    const model = (settings.model || 'gemini-2.5-flash-image').trim();

    onStatus('準備參考圖…');
    const parts = [];
    for (const img of images) {
      parts.push({ inline_data: { mime_type: img.mime, data: await U.blobToBase64(img.blob) } });
    }
    parts.push({ text: prompt });

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }
    };

    onStatus('Gemini 生成緊…');
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
      throw U.networkHint('Gemini', '檢查網絡，或者確認 API key 正確。');
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
      throw new Error(`Gemini 冇回傳圖片。${block ? '被拒原因：' + block + '。' : ''}${note ? '模型回覆：' + note.slice(0, 300) : ''}`);
    }
    return out;
  }
});
