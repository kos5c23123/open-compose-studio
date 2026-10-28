// 本地 ComfyUI。使用你自己的 workflow（以 API 格式匯出），引擎會替換以下佔位符：
//   "{{IMAGE_FACE}}"  "{{IMAGE_OUTFIT}}"  "{{IMAGE_POSE}}"   對應角色的參考圖
//   "{{IMAGE_1}}" "{{IMAGE_2}}" "{{IMAGE_3}}"              按 prompt 次序排列的參考圖
//   "{{PROMPT}}"  "{{SEED}}"  "{{WIDTH}}"  "{{HEIGHT}}"
// 整個值等於佔位符（例如 "{{WIDTH}}"）時會換成正確類型（數字）；字串中間的佔位符則做文字替換。
Engine.i18n.add({
  zh: {
    'comfy.name': 'ComfyUI（本地）',
    'comfy.help': '啟動 ComfyUI 時須加上 --enable-cors-header，否則瀏覽器會阻擋連線。請以 ComfyUI 的「Export (API)」匯出 workflow，再將 LoadImage、prompt 等欄位改為佔位符。',
    'comfy.url': 'ComfyUI 地址',
    'comfy.workflow': 'Workflow（API 格式 JSON）',
    'comfy.badJson': 'ComfyUI workflow 不是有效的 JSON。請在 ComfyUI 以「Export (API)」匯出，再貼到「設定」。',
    'comfy.up.face': '上傳人物圖…',
    'comfy.up.outfit': '上傳服裝圖…',
    'comfy.up.pose': '上傳姿勢圖…',
    'comfy.netHint': '請確認 ComfyUI 正在 {base} 運行，並以 --enable-cors-header 啟動。',
    'comfy.queued': 'ComfyUI 排隊中…',
    'comfy.timeout': 'ComfyUI 超過 15 分鐘仍未完成，已停止等待。可到 ComfyUI 介面查看佇列。',
    'comfy.working': 'ComfyUI 生成中…（{s} 秒）',
    'comfy.failed': 'ComfyUI 執行出錯：{msg}',
    'comfy.noOutput': 'ComfyUI 已完成，但沒有輸出圖片。請檢查 workflow 是否有 SaveImage 節點。'
  },
  en: {
    'comfy.name': 'ComfyUI (local)',
    'comfy.help': 'Start ComfyUI with --enable-cors-header, or the browser will block it. Export the workflow with "Export (API)", then replace the LoadImage, prompt and similar fields with placeholders.',
    'comfy.url': 'ComfyUI URL',
    'comfy.workflow': 'Workflow (API-format JSON)',
    'comfy.badJson': 'The ComfyUI workflow is not valid JSON. Export it with "Export (API)" in ComfyUI and paste it into Settings.',
    'comfy.up.face': 'Uploading face image…',
    'comfy.up.outfit': 'Uploading outfit image…',
    'comfy.up.pose': 'Uploading pose image…',
    'comfy.netHint': 'Make sure ComfyUI is running at {base} and was started with --enable-cors-header.',
    'comfy.queued': 'Queued in ComfyUI…',
    'comfy.timeout': 'ComfyUI did not finish within 15 minutes, so we stopped waiting. Check the queue in ComfyUI.',
    'comfy.working': 'ComfyUI is generating… ({s}s)',
    'comfy.failed': 'ComfyUI error: {msg}',
    'comfy.noOutput': 'ComfyUI finished without any output images. Check that the workflow has a SaveImage node.'
  }
});

Engine.adapters.register({
  id: 'comfyui',
  name: 'comfy.name',
  kind: 'local',
  help: 'comfy.help',
  fields: [
    { key: 'baseUrl', label: 'comfy.url', default: 'http://127.0.0.1:8188' },
    { key: 'workflow', label: 'comfy.workflow', type: 'textarea', placeholder: '{ "3": { "class_type": "KSampler", "inputs": { "seed": "{{SEED}}", ... } } }' }
  ],
  async generate({ prompt, images, size, settings, signal, onStatus }) {
    const U = Engine.util;
    const base = (settings.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    let workflow;
    try {
      workflow = JSON.parse(settings.workflow || '');
    } catch (e) {
      throw new Error(Engine.t('comfy.badJson'));
    }

    // 1. 上傳參考圖
    const names = {};
    const ordered = [];
    for (const img of images) {
      onStatus(Engine.t(`comfy.up.${img.role}`));
      const fd = new FormData();
      fd.append('image', img.blob, `compose-${img.role}-${Date.now()}.${img.mime === 'image/jpeg' ? 'jpg' : 'png'}`);
      fd.append('overwrite', 'true');
      let res;
      try {
        res = await fetch(`${base}/upload/image`, { method: 'POST', body: fd, signal });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw U.networkHint('ComfyUI', Engine.t('comfy.netHint', { base }));
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
    onStatus(Engine.t('comfy.queued'));
    const clientId = 'compose-' + Math.random().toString(36).slice(2);
    const qres = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: filled, client_id: clientId }),
      signal
    });
    if (!qres.ok) throw await U.errorFrom(qres, 'ComfyUI');
    const { prompt_id: promptId } = await qres.json();

    // 4. 等待結果
    const started = Date.now();
    while (true) {
      await U.sleep(1500, signal);
      const secs = Math.round((Date.now() - started) / 1000);
      if (secs > 900) throw new Error(Engine.t('comfy.timeout'));
      onStatus(Engine.t('comfy.working', { s: secs }));
      const hres = await fetch(`${base}/history/${promptId}`, { signal });
      if (!hres.ok) continue;
      const hist = await hres.json();
      const entry = hist[promptId];
      if (!entry) continue;
      if (entry.status && entry.status.status_str === 'error') {
        const msg = (entry.status.messages || []).map((m) => JSON.stringify(m[1]).slice(0, 200)).join(' ');
        throw new Error(Engine.t('comfy.failed', { msg }));
      }
      const outputs = entry.outputs || {};
      const files = [];
      for (const nodeId of Object.keys(outputs)) {
        for (const im of outputs[nodeId].images || []) {
          if (im.type === 'output') files.push(im);
        }
      }
      if (!files.length) {
        if (entry.status && entry.status.completed) throw new Error(Engine.t('comfy.noOutput'));
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
