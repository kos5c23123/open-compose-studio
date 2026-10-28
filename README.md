# 合成棚 Compose Studio

揀一張人物圖、一張服裝圖、一張姿勢圖，加埋畫面比例、景別、視角、光線等設定，一鍵送去 AI 合成新圖。

合成棚係一個**引擎**，唔包含任何素材。所有參考圖由用戶自己喺原站下載，喺本機載入，只會直接送去用戶自己揀嘅模型（雲端 API 或者本地 ComfyUI），唔會經過任何第三方伺服器。

## 點樣用

1. 下載或 clone 呢個 repo。
2. 用 Chrome、Edge 或 Firefox 直接打開 `index.html`（唔使 server）。
3. 去下面嘅原站下載素材，每類放一個資料夾，喺介面撳「載入資料夾」。
4. 喺「設定」揀出圖引擎，填 API key 或本地地址。
5. 喺算式上揀好人物、服裝、姿勢，揀場景選項，撳「出圖」。

冇服裝圖都得，可以用文字描述服裝。唔想接 API 嘅話，撳「複製 prompt」，再連同參考圖貼去 ChatGPT 或 Gemini 網頁版用都得。

## 素材來源同規則

合成棚唔會轉載任何素材，請到原站下載並遵守各自嘅規則：

| 類別 | 來源 | 作者 | 規則重點 |
|---|---|---|---|
| 姿勢 | [ポーズ集 POSE-DB-01](https://ai-pose-gallery.pages.dev/) | ギア [@giaaibusi](https://x.com/giaaibusi) | 作品創作可商用、可編輯；**圖片數據本身（包括加工後）禁止再分發、轉載、轉售**；唔可以用嚟表現真人或未成年人 |
| 人物 | [AIモデル顔データベース](https://ai-portrait-gallery.pages.dev/) | あぎ [@agi_aibusi](https://x.com/agi_aibusi) | CC0，可商用、可編輯；虛構人物，唔可以冒充真人；作者請求唔好再分發圖片本身 |
| 服裝 | ギア 製作中嘅服裝資料庫 | ギア | 未公開，公開後以原站規則為準 |

以上整理自原站，以原站最新版本為準。

**唔好將素材 commit 入 repo。** `.gitignore` 已經排除咗 `faces/`、`poses/`、`outfits/`、`materials/` 呢幾個資料夾，建議素材就放喺度。

## 出圖引擎

| 引擎 | 需要 | 備註 |
|---|---|---|
| Google Gemini | API key（Google AI Studio） | 預設模型 `gemini-2.5-flash-image`，有新版可以喺設定改 |
| OpenAI | API key | 用 `/v1/images/edits`，預設 `gpt-image-1` |
| ComfyUI（本地） | 本機 ComfyUI | 啟動時要加 `--enable-cors-header` |

### ComfyUI workflow

用支援多張參考圖嘅圖像編輯模型砌好 workflow（例如 Qwen-Image-Edit 或 FLUX Kontext 一類），喺 ComfyUI 用 **Export (API)** 匯出 JSON，將對應欄位改成以下佔位符，再貼入「設定」：

| 佔位符 | 會換成 |
|---|---|
| `"{{IMAGE_FACE}}"` `"{{IMAGE_OUTFIT}}"` `"{{IMAGE_POSE}}"` | 對應角色嘅參考圖（已自動上載到 ComfyUI） |
| `"{{IMAGE_1}}"` `"{{IMAGE_2}}"` `"{{IMAGE_3}}"` | 按 prompt 次序嘅參考圖 |
| `"{{PROMPT}}"` | 合成好嘅 prompt |
| `"{{SEED}}"` | 隨機種子（數字） |
| `"{{WIDTH}}"` `"{{HEIGHT}}"` | 按畫面比例計出嚟約 1MP 嘅闊高（數字） |

例如 LoadImage 節點：

```json
"12": { "class_type": "LoadImage", "inputs": { "image": "{{IMAGE_POSE}}" } }
```

成個值等於佔位符時會換成正確類型（例如數字）；佔位符喺字串中間就做文字替換。Workflow 最後要有 SaveImage 節點。

### 本地 LLM 潤飾 prompt（可選）

用 OpenAI 相容介面，Ollama（`http://127.0.0.1:11434/v1`）同 LM Studio（`http://127.0.0.1:1234/v1`）都得。Ollama 要設定環境變數 `OLLAMA_ORIGINS`，瀏覽器先可以直接呼叫。

## 結構

```
index.html              介面同樣式
js/presets.js           場景選項（想加選項改呢度）
js/prompt.js            Prompt 組合（英文、日文、中文）
js/adapters/registry.js 引擎登記同共用工具
js/adapters/*.js        各個出圖引擎
js/enhancer.js          本地 LLM 潤飾
js/app.js               素材庫、選擇、出圖流程
```

### 加新引擎

喺 `js/adapters/` 開一個新檔，再喺 `index.html` 加 `<script>`：

```js
Engine.adapters.register({
  id: 'my-engine',
  name: '我嘅引擎',
  kind: 'cloud',            // 或 'local'
  help: '顯示喺設定嘅說明',
  fields: [{ key: 'apiKey', label: 'API key', type: 'password' }],
  async generate({ prompt, images, aspect, size, settings, signal, onStatus }) {
    // images: [{ role: 'face' | 'outfit' | 'pose', blob, mime, name }]，次序同 prompt 一致
    // 回傳 Blob 陣列
  }
});
```

## 私隱

設定預設唔會儲存 API key；喺「設定」剔「記住設定」先會存喺瀏覽器 localStorage。參考圖只會由你部機直接送去你揀嘅引擎。

## 使用守則

請只用虛構人物素材。唔好用嚟生成真人、冒充真人，或者任何未成年人嘅圖像。生成內容要遵守你所用模型服務嘅使用政策。

## License

程式碼以 MIT 授權（見 `LICENSE`）。MIT 只覆蓋本 repo 嘅程式碼，唔覆蓋任何第三方素材。
