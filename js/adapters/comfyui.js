// 本地 ComfyUI。用你自己嘅 workflow（API 格式匯出），引擎會替換以下佔位符：
//   "{{IMAGE_FACE}}"  "{{IMAGE_OUTFIT}}"  "{{IMAGE_POSE}}"   對應角色嘅參考圖
//   "{{IMAGE_1}}" "{{IMAGE_2}}" "{{IMAGE_3}}"              按 prompt 次序嘅參考圖
//   "{{PROMPT}}"  "{{SEED}}"  "{{WIDTH}}"  "{{HEIGHT}}"
// 成個值等於佔位符（例如 "{{WIDTH}}"）會換成正確類型（數字）；字串中間嘅佔位符就做文字替換。
Engine.adapters.register({
  id: 'comfyui',
  name: 'ComfyUI（本地）',
  kind: 'local',
  help: '啟動 ComfyUI 時加 --enable-cors-header，否則瀏覽器會擋。Workflow 用 ComfyUI 嘅「Export (API)」匯出，再將 LoadImage、prompt 等欄位改成佔位符。',
  fields: [
    { key: 'baseUrl', label: 'ComfyUI 地址', default: 'http://127.0.0.1:8188' },
    { key: 'workflow', label: 'Workflow（API 格式 JSON）', type: 'textarea', placeholder: '{ "3": { "class_type": "KSampler", "inputs": { "seed": "{{SEED}}", ... } } }' }
  ],
  async generate({ prompt, images, size, settings, signal, onStatus }) {
    const U = Engine.util;
    const base = (settings.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    let workflow;
    try {
      workflow = JSON.parse(settings.workflow || '');
    } catch (e) {
      throw new Error('ComfyUI workflow 唔係有效 JSON。請喺 ComfyUI 用「Export (API)」匯出，再貼入「設定」。');
    }

    // 1. 上載參考圖
    const names = {};
    const ordered = [];
    for (const img of images) {
      onStatus(`上載${img.role === 'face' ? '人物' : img.role === 'outfit' ? '服裝' : '姿勢'}圖…`);
      const fd = new FormData();
      fd.append('image', img.blob, `compose-${img.role}-${Date.now()}.${img.mime === 'image/jpeg' ? 'jpg' : 'png'}`);
      fd.append('overwrite', 'true');
      let res;
      try {
        res = await fetch(`${base}/upload/image`, { method: 'POST', body: fd, signal });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw U.networkHint('ComfyUI', `確認 ComfyUI 喺 ${base} 運行緊，並用 --enable-cors-header 啟動。`);
      }
      if (!res.ok) throw await U.errorFrom(res, 'ComfyUI');
      const j = await res.json();
      const ref = j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
      names[img.role] = ref;
      ordered.push(ref);
    }

    // 2. 替換佔位符
    const values = {
      '{{PROMPT}}': prompt,
      '{{SEED}}': Math.floor(Math.random() * 2 ** 31),
      '{{WIDTH}}': size.width,
      '{{HEIGHT}}': size.height,
      '{{IMAGE_FACE}}': names.face || '',
      '{{IMAGE_OUTFIT}}': names.outfit || '',
      '{{IMAGE_POSE}}': names.pose || ''
    };
    ordered.forEach((n, i) => { values[`{{IMAGE_${i + 1}}}`] = n; });

    const fill = (node) => {
      if (Array.isArray(node)) return node.map(fill);
      if (node && typeof node === 'object') {
        const o = {};
        for (const k of Object.keys(node)) o[k] = fill(node[k]);
        return o;
      }
      if (typeof node === 'string') {
        if (Object.prototype.hasOwnProperty.call(values, node)) return values[node];
        return node.replace(/\{\{[A-Z_0-9]+\}\}/g, (m) => (m in values ? String(values[m]) : m));
      }
      return node;
    };
    const filled = fill(workflow);

    // 3. 排隊
    onStatus('ComfyUI 排隊中…');
    const clientId = 'compose-' + Math.random().toString(36).slice(2);
    const qres = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: filled, client_id: clientId }),
      signal
    });
    if (!qres.ok) throw await U.errorFrom(qres, 'ComfyUI');
    const { prompt_id: promptId } = await qres.json();

    // 4. 等結果
    const started = Date.now();
    while (true) {
      await U.sleep(1500, signal);
      const secs = Math.round((Date.now() - started) / 1000);
      if (secs > 900) throw new Error('ComfyUI 超過 15 分鐘未完成，已停止等待。可以去 ComfyUI 介面睇下佇列。');
      onStatus(`ComfyUI 生成緊…（${secs} 秒）`);
      const hres = await fetch(`${base}/history/${promptId}`, { signal });
      if (!hres.ok) continue;
      const hist = await hres.json();
      const entry = hist[promptId];
      if (!entry) continue;
      if (entry.status && entry.status.status_str === 'error') {
        const msg = (entry.status.messages || []).map((m) => JSON.stringify(m[1]).slice(0, 200)).join(' ');
        throw new Error('ComfyUI 執行出錯：' + msg);
      }
      const outputs = entry.outputs || {};
      const files = [];
      for (const nodeId of Object.keys(outputs)) {
        for (const im of outputs[nodeId].images || []) {
          if (im.type === 'output') files.push(im);
        }
      }
      if (!files.length) {
        if (entry.status && entry.status.completed) throw new Error('ComfyUI 完成咗但冇輸出圖片。檢查 workflow 有冇 SaveImage 節點。');
        continue;
      }
      const blobs = [];
      for (const f of files) {
        const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type });
        const r = await fetch(`${base}/view?${q}`, { signal });
        if (r.ok) blobs.push(await r.blob());
      }
      return blobs;
    }
  }
});
