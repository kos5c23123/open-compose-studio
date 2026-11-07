// 由一張參考圖反推服裝或姿勢 prompt。
// 支援 Google Gemini、OpenAI（Chat Completions）及任何 OpenAI 相容的本地視覺模型
// （Ollama、LM Studio 等）。只會把圖片傳送到你選擇的服務。
window.Engine = window.Engine || {};

(function () {
  const DEFAULTS = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', grok: 'grok-4.7', local: 'qwen2.5vl:7b' };
  const MAX_SIDE = 1024;

  const SYSTEM =
    'You are a precise prompt engineer for AI image models. You describe reference images factually. ' +
    'Never guess a real person\'s identity, age or name, and never mention real people. ' +
    'Return only one JSON object, with no markdown fence and no commentary.';

  const INSTRUCTIONS = {
    outfit:
      'Look only at the clothing in the image. List every visible garment and accessory with its colour, ' +
      'material, fit, length and notable details. Ignore the face, body shape, pose, background and lighting. ' +
      'Return JSON with these keys:\n' +
      '- "prompt_en": one comma-separated English phrase beginning with "wearing", suitable for appending to an image prompt (no full sentence, no camera or pose words);\n' +
      '- "prompt_zh": the same description in natural Traditional Chinese;\n' +
      '- "tags": 6 to 12 short English keywords for each garment type, colour and material.',
    pose:
      'Describe only the body pose in the image: stance, torso, hips, arms, hands, legs, feet, head direction, ' +
      'and the camera angle and framing (front, side, three-quarter, high, low; full body or upper body). ' +
      'Do not describe clothing, identity, background, lighting or image style. ' +
      'Ignore any text or watermark in the image. ' +
      'Return JSON with these keys:\n' +
      '- "prompt_en": one natural English sentence describing the pose, in the style of a pose reference caption;\n' +
      '- "prompt_zh": the same description in natural Traditional Chinese;\n' +
      '- "tags": 6 to 12 short English keywords for body position, limb placement and camera angle.'
  };

  function parseJson(text) {
    const clean = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const tryParse = (s) => {
      try { return JSON.parse(s); } catch (e) { return null; }
    };
    let out = tryParse(clean);
    if (!out) {
      const a = clean.indexOf('{');
      const b = clean.lastIndexOf('}');
      if (a >= 0 && b > a) out = tryParse(clean.slice(a, b + 1));
    }
    return out && typeof out === 'object' ? out : null;
  }

  // 縮到 1024px 以內再送出，減少上傳大小及費用
  async function prepare(file) {
    const bmp = await createImageBitmap(file);
    const long = Math.max(bmp.width, bmp.height);
    const k = long > MAX_SIDE ? MAX_SIDE / long : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error(Engine.t('err.readImage')))), 'image/jpeg', 0.9);
    });
    return { blob, mime: 'image/jpeg' };
  }

  async function readReply(res, service) {
    if (!res.ok) throw await Engine.util.errorFrom(res, service);
    return res.json();
  }

  async function gemini({ system, user, mime, b64, settings, signal }) {
    const key = settings.apiKey;
    if (!key) throw new Error(Engine.t('an.needKey', { service: 'Gemini' }));
    const model = (settings.model || DEFAULTS.gemini).replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }, { inline_data: { mime_type: mime, data: b64 } }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw Engine.util.networkHint('Gemini', Engine.t('hint.checkNet'));
    }
    const json = await readReply(res, 'Gemini');
    const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('');
    if (!text) throw new Error(Engine.t('an.empty'));
    return text;
  }

  async function openaiLike({ system, user, mime, b64, settings, signal, service }) {
    const base = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const body = {
      model: settings.model || DEFAULTS.openai,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
          ]
        }
      ]
    };
    // 部分本地模型不支援 response_format，只在雲端要求 JSON
    if (settings.provider === 'openai') body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal,
        headers,
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw Engine.util.networkHint(service, Engine.t('llm.net', { base }));
    }
    const json = await readReply(res, service);
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error(Engine.t('an.empty'));
    return text;
  }

  // settings: { provider, model, baseUrl, apiKey }
  async function analyse({ file, mode, settings, signal }) {
    const { blob, mime } = await prepare(file);
    const b64 = await Engine.util.blobToBase64(blob);
    const system = SYSTEM;
    const user = `${INSTRUCTIONS[mode] || INSTRUCTIONS.outfit}\n\nReturn the JSON object now.`;
    const common = { system, user, mime, b64, settings, signal };
    let text;
    if (settings.provider === 'gemini') text = await gemini(common);
    else if (settings.provider === 'openai') text = await openaiLike({ ...common, settings: { ...settings, baseUrl: 'https://api.openai.com/v1' }, service: 'OpenAI' });
    else if (settings.provider === 'grok') text = await openaiLike({ ...common, settings: { ...settings, baseUrl: 'https://api.x.ai/v1' }, service: 'Grok' });
    else text = await openaiLike({ ...common, service: Engine.t('an.localService') });
    const data = parseJson(text) || { prompt_en: text.trim(), prompt_zh: '', tags: [] };
    return {
      en: String(data.prompt_en || '').trim(),
      zh: String(data.prompt_zh || '').trim(),
      tags: Array.isArray(data.tags) ? data.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 16) : [],
      raw: text
    };
  }

  Engine.vision = { analyse, parseJson, DEFAULTS };

  Engine.i18n.add({
    zh: {
      'an.needKey': '請先在「設定」輸入 {service} 的 API key。',
      'an.empty': '模型沒有回覆內容。',
      'an.localService': '本地視覺模型'
    },
    en: {
      'an.needKey': 'Add a {service} API key in Settings first.',
      'an.empty': 'The model returned nothing.',
      'an.localService': 'local vision model'
    }
  });
})();
