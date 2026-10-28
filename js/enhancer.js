// 用本地 LLM 潤飾 prompt（可選）。
// 用 OpenAI 相容嘅 /chat/completions，Ollama（http://127.0.0.1:11434/v1）同 LM Studio（http://127.0.0.1:1234/v1）都支援。
// Ollama 要設定環境變數 OLLAMA_ORIGINS="*"（或者你個頁面嘅來源），瀏覽器先可以直接呼叫。
window.Engine = window.Engine || {};

Engine.enhancer = {
  fields: [
    { key: 'baseUrl', label: 'LLM 地址', default: 'http://127.0.0.1:11434/v1' },
    { key: 'model', label: '模型', default: 'qwen2.5:7b' },
    { key: 'apiKey', label: 'API key（本地通常留空）', type: 'password' }
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
      throw new Error(`連唔到本地 LLM（${base}）。確認佢運行緊；Ollama 要設定 OLLAMA_ORIGINS。`);
    }
    if (!res.ok) throw await Engine.util.errorFrom(res, '本地 LLM');
    const json = await res.json();
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error('本地 LLM 冇回覆內容。');
    return text.replace(/^```[a-z]*\n?|```$/g, '').trim();
  }
};
