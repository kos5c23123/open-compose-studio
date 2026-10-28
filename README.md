# Compose Studio (合成棚)

Pick a face, an outfit and a pose, add scene options such as aspect ratio, shot size, camera angle and lighting, and send everything to an image model in one click. Compose Studio writes the prompt for you.

Compose Studio is an **engine only**. It ships no images. You download reference materials from their original sites yourself and load them from your own disk. Images go straight from your device to the model you choose (a cloud API or your local ComfyUI) and never pass through any third-party server.

The interface is available in Traditional Chinese and English. Use the 中 / EN switch in the top-right corner. Prompts can be written in English, Japanese or Chinese, chosen separately in the Prompt panel.

## Getting started

1. Download or clone this repository.
2. Open `index.html` directly in Chrome, Edge or Firefox. No server or build step is needed.
3. Download materials from the sites listed below and put each type in its own folder. In the app, choose **Load folder**.
4. Open **Settings**, pick an image engine and enter your API key or local address.
5. Choose a face, an outfit and a pose, set the scene options, then press **Generate**.

An outfit image is optional; you can describe the outfit in text instead. If you would rather not connect an API, press **Copy prompt** and paste it, together with the reference images, into the ChatGPT or Gemini web app.

On iOS Safari, folder selection is not supported. Use **Choose images** to pick individual files.

## Browsing by category

The library reads the categories that are already in the downloaded file names, so no extra data is needed:

- **Poses** (`full_single_P001_front.png`): filter by series (full body standard, full body glamour, upper body, two people) and by angle (front, high, low, side, three-quarter). The **By pose** view groups the five angles of each pose into one card; hover an angle to preview it and click to choose it. **Each image** shows every file separately.
- **Faces** (`ai-face-….png`, `ai-styling-….png`): filter by face or styling images.

To also filter by the original sites' pose categories, pose names and hairstyles, load their catalog data with the **Catalog** button:

- Poses: open [ai-pose-gallery.pages.dev](https://ai-pose-gallery.pages.dev/), save the page with Ctrl+S (⌘S on Mac) and choose the saved HTML file.
- Faces: open [ai-portrait-gallery.pages.dev/data/images.js](https://ai-portrait-gallery.pages.dev/data/images.js), save it and choose the file.

You can also drop those files into your materials folder; they are picked up automatically when you load the folder. The catalog is parsed in your browser and kept in its localStorage. This repository does not include any data from the original sites.

## Material sources and rules

Compose Studio does not rehost any materials. Download them from the original sites and follow each site's rules:

| Type | Source | Author | Key rules |
|---|---|---|---|
| Poses | [ポーズ集 POSE-DB-01](https://ai-pose-gallery.pages.dev/) | ギア ([@giaaibusi](https://x.com/giaaibusi)) | Free; works you create may be used commercially, and the images may be edited. **The image data itself, including processed versions, may not be redistributed, reposted or resold.** Must not be used to depict real people or minors. |
| Faces | [AIモデル顔データベース](https://ai-portrait-gallery.pages.dev/) | あぎ ([@agi_aibusi](https://x.com/agi_aibusi)) | CC0; commercial use and editing allowed. All faces are AI-generated fictional people; do not impersonate real people. The author asks that the images themselves not be redistributed. |
| Outfits | Outfit database in progress by ギア | ギア | Not released yet. Follow its rules once it is published. |

This summary is taken from the original sites. The latest version on each site prevails.

**Do not commit materials to this repository.** `.gitignore` already excludes the `faces/`, `poses/`, `outfits/` and `materials/` folders and all image files, so those folders are a safe place to keep your downloads.

## Organizing your own materials

If you make your own pose or face images, **Organize** gives them file names that follow the same scheme, so they get the same categories, filters and pose cards as the downloaded materials.

1. Open **Organize** from the Face or Pose library (or press **Organize them** on the notice that lists images with unrecognised names). Add images with the button or by dragging them in.
2. Select one or more images (hold Shift to select a range) and set their details:
   - Poses: series code, pose number and angle (front, high, low, side, three-quarter, back; keys 1–6 also work), plus an optional series name, category and pose name. **Make one pose** gives the selected images one number and assigns the angles in order.
   - Faces: face or styling, hairstyle length, and a name code.
3. The new file name appears under each image. Clashing names are highlighted and must be fixed first.
4. Press **Add to library** to use them now, or **Export ZIP** to download the renamed images with a `catalog.json`. Loading that folder later restores the categories and names.

| Type | File name | Example |
|---|---|---|
| Pose | `{series}_P{number}_{angle}` | `my-standing_P001_front.png` |
| Face | `{face or styling}_{short, medium, semilong, long or other}_{code}` | `face_short_001.png` |

Use your own series codes rather than the original site's (`full_single` and so on) so your images never clash with downloaded ones. Only file names and catalog data change; the image content is not modified. Use only AI-generated images of fictional adults.

## Image engines

| Engine | Requires | Notes |
|---|---|---|
| Google Gemini | API key from Google AI Studio | Default model `gemini-2.5-flash-image`; change it in Settings if a newer one is available |
| OpenAI | API key | Uses `/v1/images/edits`, default model `gpt-image-1` |
| ComfyUI (local) | ComfyUI running on your machine | Start it with `--enable-cors-header` |

The Gemini, OpenAI and ComfyUI adapters have not yet been tested end to end against the live services. Please report any request or response problems.

### ComfyUI workflow

Build a workflow around an image-editing model that accepts multiple reference images (for example Qwen-Image-Edit or FLUX Kontext). Export it from ComfyUI with **Export (API)**, replace the relevant values with the placeholders below, and paste the JSON into Settings.

| Placeholder | Replaced with |
|---|---|
| `"{{IMAGE_FACE}}"` `"{{IMAGE_OUTFIT}}"` `"{{IMAGE_POSE}}"` | The reference image for that role (uploaded to ComfyUI automatically) |
| `"{{IMAGE_1}}"` `"{{IMAGE_2}}"` `"{{IMAGE_3}}"` | Reference images in prompt order |
| `"{{PROMPT}}"` | The generated prompt |
| `"{{SEED}}"` | A random seed (number) |
| `"{{WIDTH}}"` `"{{HEIGHT}}"` | Width and height of about 1 megapixel for the chosen aspect ratio (numbers) |

For example, a LoadImage node:

```json
"12": { "class_type": "LoadImage", "inputs": { "image": "{{IMAGE_POSE}}" } }
```

When a value is exactly a placeholder, it is replaced with a value of the correct type (for example a number). A placeholder inside a longer string is replaced as text. The workflow must end with a SaveImage node.

### Local LLM prompt polish (optional)

Any OpenAI-compatible endpoint works, including Ollama (`http://127.0.0.1:11434/v1`) and LM Studio (`http://127.0.0.1:1234/v1`). For Ollama, set the `OLLAMA_ORIGINS` environment variable so the browser is allowed to call it.

## Project structure

```
index.html              Markup, styles and the SVG icon sprite
js/i18n.js              Interface strings (Traditional Chinese, English) and translation helpers
js/catalog.js           File-name parsing and optional catalog import for categories
js/organizer.js         Organize dialog for naming your own materials
js/zip.js               Minimal ZIP writer used by the export
js/presets.js           Scene options (edit this file to add options)
js/prompt.js            Prompt builder (English, Japanese, Chinese)
js/adapters/registry.js Engine registry and shared helpers
js/adapters/*.js        Image engines
js/enhancer.js          Local LLM prompt polish
js/app.js               Library, selection and generation flow
```

Scripts are plain `<script>` tags sharing a global `window.Engine` namespace, so the page works when opened from `file://`.

### Adding an interface language

Add a dictionary for the new language with `Engine.i18n.add({ xx: { ... } })`, using the same keys as `js/i18n.js`, then add an entry to `Engine.i18n.langs` and a button to the `.lang-switch` group in `index.html`. Missing keys fall back to English.

### Adding an engine

Create a new file in `js/adapters/` and add a `<script>` tag for it in `index.html`:

```js
Engine.i18n.add({
  zh: { 'my.help': '顯示在設定中的說明' },
  en: { 'my.help': 'Help text shown in Settings' }
});

Engine.adapters.register({
  id: 'my-engine',
  name: { zh: '我的引擎', en: 'My engine' }, // a string, an i18n key, or { zh, en }
  kind: 'cloud',                             // or 'local'
  help: 'my.help',
  fields: [{ key: 'apiKey', label: 'field.apiKey', type: 'password' }],
  async generate({ prompt, images, aspect, size, settings, signal, onStatus }) {
    // images: [{ role: 'face' | 'outfit' | 'pose', blob, mime, name }], in the same order as the prompt
    // Return an array of Blobs
  }
});
```

## Privacy

By default, API keys are not saved. Catalog data you import is kept in this browser's localStorage until you clear it in the Catalog dialog. They are stored in the browser's localStorage only if you tick **Remember settings on this device** in Settings. Reference images are sent only from your device to the engine you choose. Generated images are kept in memory and are lost when you reload the page.

## Acceptable use

Use only fictional people as materials. Do not use this tool to depict or impersonate real people, or to create images of anyone under 18. Generated content must follow the usage policies of the model service you use.

## License

The code is released under the MIT License (see `LICENSE`). The license covers only the code in this repository, not any third-party materials.
