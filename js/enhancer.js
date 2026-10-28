// 以本地 LLM 潤飾 prompt（可選）。
// 使用 OpenAI 相容的 /chat/completions，Ollama（http://127.0.0.1:11434/v1）及 LM Studio（http://127.0.0.1:1234/v1）均支援。
// Ollama 須設定環境變數 OLLAMA_ORIGINS="*"（或本頁面的來源），瀏覽器才可直接呼叫。
window.Engine = window.Engine || {};

Engine.i18n.add({
  zh: {
    'llm.url': 'LLM 地址',
    'llm.key': 'API key（本地通常留空）',
    'llm.service': '本地 LLM',
    'llm.net': '無法連接本地 LLM（{base}）。請確認它正在運行；Ollama 須設定 OLLAMA_ORIGINS。',
    'llm.empty': '本地 LLM 沒有回覆內容。'
  },
  en: {
    'llm.url': 'LLM URL',
    'llm.key': 'API key (usually empty for local)',
    'llm.service': 'Local LLM',
    'llm.net': 'Could not reach the local LLM at {base}. Make sure it is running; Ollama needs OLLAMA_ORIGINS set.',
    'llm.empty': 'The local LLM returned nothing.'
  }
});

Engine.enhancer = {
  fields: [
    { key: 'baseUrl', label: 'llm.url', default: 'http://127.0.0.1:11434/v1' },
    { key: 'model', label: 'field.model', default: 'qwen2.5:7b' },
    { key: 'apiKey', label: 'llm.key', type: 'password' }
  ],
  system:
    'You rewrite image-editing instructions for a multi-image AI model. ' +
    'Keep every reference to the numbered images (Image 1, Image 2, ...) and keep every constraint. ' +
    'Make the description of the scene, camera and lighting more vivid and specific, in the same language as the input. ' +
    'Do not add nudity, real people, or anyone under 18. Output only the rewritten instruction, with no preamble.',
  async run(prompt, settings, signal) {
    const base = (settings.baseUrl || this.fields[0].default).replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: settings.model || this.fields[1].default,
          temperature: 0.4,
          messages: [
            { role: 'system', content: this.system },
            { role: 'user', content: prompt }
          ]
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(Engine.t('llm.net', { base }));
    }
    if (!res.ok) throw await Engine.util.errorFrom(res, Engine.t('llm.service'));
    const json = await res.json();
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error(Engine.t('llm.empty'));
    return text.replace(/^```[a-z]*\n?|```$/g, '').trim();
  }
};
