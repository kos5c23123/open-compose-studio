// 將已選的參考圖及場景選項組合成一段指令。
// refs：按傳送給模型的次序排列，例如 [{role:'face'}, {role:'outfit'}, {role:'pose'}]
window.Engine = window.Engine || {};

(function () {
  const T = {
    en: {
      intro: 'Create one new image by combining the reference images below.',
      face: (n, hair) => `Image ${n} (person): keep this person's identity, with the same face, facial features and skin tone${hair ? ', and the same hairstyle' : ''}.`,
      outfit: (n) => `Image ${n} (outfit): dress the person in exactly this outfit, matching the garments, colors, materials and accessories. Use only the clothing from this image.`,
      pose: (n) => `Image ${n} (pose): a faceless grey mannequin line drawing. Match its body pose, limb positions and orientation exactly, but do not copy its line-art style or grey color.`,
      outfitText: (t) => `Outfit: ${t}.`,
      hair: (t) => `Hairstyle: ${t}.`,
      expression: (t) => `Expression: ${t}.`,
      place: (t) => `Setting: ${t}.`,
      weather: (t) => `Weather: ${t}.`,
      camera: (t) => `Camera: ${t}.`,
      light: (t) => `Lighting: ${t}.`,
      style: (t) => `Style: ${t}.`,
      aspect: (t) => `Aspect ratio ${t}.`,
      outro: 'The person is a fictional adult. Output a single coherent image.',
      join: ', '
    },
    ja: {
      intro: '以下の参考画像を組み合わせて、新しい画像を1枚生成してください。',
      face: (n, hair) => `${n}枚目（人物）：この人物の顔立ちと肌の色をそのまま保ってください${hair ? '。髪型も同じにしてください' : ''}。`,
      outfit: (n) => `${n}枚目（服装）：この服装（アイテム・色・素材・小物）をそのまま着せてください。この画像からは服装だけを使ってください。`,
      pose: (n) => `${n}枚目（ポーズ）：顔のないグレーのマネキンの線画です。体のポーズ、手足の位置、向きを正確に合わせてください。線画のタッチやグレーの色は真似しないでください。`,
      outfitText: (t) => `服装：${t}。`,
      hair: (t) => `髪型：${t}。`,
      expression: (t) => `表情：${t}。`,
      place: (t) => `場所：${t}。`,
      weather: (t) => `天気：${t}。`,
      camera: (t) => `カメラ：${t}。`,
      light: (t) => `ライティング：${t}。`,
      style: (t) => `スタイル：${t}。`,
      aspect: (t) => `アスペクト比 ${t}。`,
      outro: '人物は架空の成人です。1枚の自然な画像として出力してください。',
      join: '、'
    },
    zh: {
      intro: '將以下參考圖合成為一張新圖片。',
      face: (n, hair) => `第 ${n} 張（人物）：保持此人的臉部特徵與膚色不變${hair ? '，髮型亦保持一致' : ''}。`,
      outfit: (n) => `第 ${n} 張（服裝）：讓人物穿上這套服裝，款式、顏色、材質與配飾都要一致。只採用此圖中的服裝。`,
      pose: (n) => `第 ${n} 張（姿勢）：一張無臉灰色人偶線稿。準確跟隨其身體姿勢、四肢位置與朝向，但不要模仿線稿畫風或灰色。`,
      outfitText: (t) => `服裝：${t}。`,
      hair: (t) => `髮型：${t}。`,
      expression: (t) => `表情：${t}。`,
      place: (t) => `場景：${t}。`,
      weather: (t) => `天氣：${t}。`,
      camera: (t) => `鏡頭：${t}。`,
      light: (t) => `光線：${t}。`,
      style: (t) => `風格：${t}。`,
      aspect: (t) => `畫面比例 ${t}。`,
      outro: '人物為虛構成年人。輸出一張完整自然的圖片。',
      join: '、'
    }
  };

  // 由 opts（{groupId: [optionId]}）取得對應語言的字詞
  function terms(groupId, opts, lang) {
    const group = Engine.presets.find((g) => g.id === groupId);
    if (!group) return [];
    const ids = opts[groupId] || [];
    return ids
      .map((id) => group.options.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => (lang === 'zh' ? o.zh : o.en));
  }

  Engine.buildPrompt = function ({ refs, opts, text, keepHair, lang }) {
    const t = T[lang] || T.en;
    const lines = [];
    const roles = refs.map((r) => r.role);
    const hairText = (text.hair || '').trim();
    const outfitText = (text.outfit || '').trim();
    const extra = (text.extra || '').trim();

    if (refs.length) lines.push(t.intro);
    refs.forEach((r, i) => {
      const n = i + 1;
      if (r.role === 'face') lines.push(t.face(n, keepHair && !hairText));
      if (r.role === 'outfit') lines.push(t.outfit(n));
      if (r.role === 'pose') lines.push(t.pose(n));
    });

    if (!roles.includes('outfit') && outfitText) lines.push(t.outfitText(outfitText));
    if (hairText) lines.push(t.hair(hairText));

    const expression = terms('expression', opts, lang);
    if (expression.length) lines.push(t.expression(expression[0]));
    const place = terms('place', opts, lang);
    if (place.length) lines.push(t.place(place[0]));
    const weather = terms('weather', opts, lang);
    if (weather.length) lines.push(t.weather(weather[0]));

    const camera = [...terms('shot', opts, lang), ...terms('angle', opts, lang), ...terms('lens', opts, lang), ...terms('aperture', opts, lang)];
    if (camera.length) lines.push(t.camera(camera.join(t.join)));

    const light = terms('light', opts, lang);
    if (light.length) lines.push(t.light(light.join(t.join)));
    const style = terms('style', opts, lang);
    if (style.length) lines.push(t.style(style[0]));

    const aspect = (opts.aspect || [])[0];
    if (aspect) lines.push(t.aspect(aspect));
    if (extra) lines.push(extra);
    if (lines.length) lines.push(t.outro);
    return lines.join('\n');
  };

  // 由畫面比例計算約 1MP、64 倍數的寬高，供本地模型使用
  Engine.sizeFor = function (aspect, area = 1024 * 1024) {
    const [a, b] = String(aspect || '1:1').split(':').map(Number);
    const ratio = a && b ? a / b : 1;
    const w = Math.round(Math.sqrt(area * ratio) / 64) * 64;
    const h = Math.round(Math.sqrt(area / ratio) / 64) * 64;
    return { width: w, height: h };
  };
})();
