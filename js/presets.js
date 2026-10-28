// 場景選項。
// 每組有 zh、en 兩個介面名稱。
// 每個選項有 zh（中文介面及中文 prompt 用）、en（英文、日文 prompt 用），
// 以及可選的 ui（英文介面的短名稱；未提供時沿用 en）。
// 如需新增選項，在對應的 options 陣列加一行即可。
window.Engine = window.Engine || {};

Engine.presets = [
  {
    id: 'aspect', zh: '畫面比例', en: 'Aspect ratio', max: 1, required: true, default: ['3:4'],
    options: [
      { id: '1:1', zh: '1:1', en: '1:1' },
      { id: '2:3', zh: '2:3', en: '2:3' },
      { id: '3:2', zh: '3:2', en: '3:2' },
      { id: '3:4', zh: '3:4', en: '3:4' },
      { id: '4:3', zh: '4:3', en: '4:3' },
      { id: '9:16', zh: '9:16', en: '9:16' },
      { id: '16:9', zh: '16:9', en: '16:9' }
    ]
  },
  {
    id: 'shot', zh: '景別', en: 'Shot size', max: 1,
    options: [
      { id: 'xls', zh: '極遠景', en: 'extreme long shot' },
      { id: 'ls', zh: '遠景', en: 'long shot' },
      { id: 'full', zh: '全身', en: 'full body shot', ui: 'Full body' },
      { id: 'mws', zh: '中遠景', en: 'medium wide shot' },
      { id: 'cowboy', zh: '七分身', en: 'cowboy shot, framed from mid-thigh up', ui: 'Cowboy shot' },
      { id: 'ms', zh: '半身', en: 'medium shot, framed from the waist up', ui: 'Medium shot' },
      { id: 'mcu', zh: '胸上', en: 'medium close-up' },
      { id: 'cu', zh: '特寫', en: 'close-up' },
      { id: 'ecu', zh: '大特寫', en: 'extreme close-up' }
    ]
  },
  {
    id: 'angle', zh: '視角', en: 'Camera angle', max: 1,
    options: [
      { id: 'eye', zh: '平視', en: 'eye-level angle', ui: 'Eye level' },
      { id: 'high', zh: '俯拍', en: 'high angle' },
      { id: 'low', zh: '仰拍', en: 'low angle' },
      { id: 'bird', zh: '鳥瞰', en: "bird's-eye view" },
      { id: 'worm', zh: '蟲視', en: "worm's-eye view" },
      { id: 'tq', zh: '四分三側', en: 'three-quarter view' },
      { id: 'profile', zh: '側面', en: 'profile view', ui: 'Profile' },
      { id: 'back', zh: '背面', en: 'back view' },
      { id: 'dutch', zh: '傾斜鏡頭', en: 'Dutch angle' },
      { id: 'ots', zh: '過肩', en: 'over-the-shoulder shot', ui: 'Over the shoulder' },
      { id: 'selfie', zh: '自拍角度', en: 'selfie angle, arm-length', ui: 'Selfie' },
      { id: 'pov', zh: '主觀視角', en: 'first-person POV', ui: 'POV' }
    ]
  },
  {
    id: 'lens', zh: '焦段', en: 'Lens', max: 1,
    options: [
      { id: '14', zh: '14mm 超廣角', en: '14mm ultra-wide lens', ui: '14mm ultra-wide' },
      { id: '24', zh: '24mm 廣角', en: '24mm wide-angle lens', ui: '24mm wide' },
      { id: '35', zh: '35mm', en: '35mm lens', ui: '35mm' },
      { id: '50', zh: '50mm 標準', en: '50mm standard lens', ui: '50mm standard' },
      { id: '85', zh: '85mm 人像', en: '85mm portrait lens', ui: '85mm portrait' },
      { id: '135', zh: '135mm 望遠', en: '135mm telephoto lens', ui: '135mm telephoto' },
      { id: '200', zh: '200mm 壓縮感', en: '200mm telephoto lens with background compression', ui: '200mm compression' }
    ]
  },
  {
    id: 'aperture', zh: '光圈', en: 'Aperture', max: 1,
    options: [
      { id: 'f14', zh: 'f/1.4 淺景深', en: 'f/1.4, shallow depth of field, creamy bokeh', ui: 'f/1.4 shallow focus' },
      { id: 'f28', zh: 'f/2.8 背景柔化', en: 'f/2.8, softly blurred background', ui: 'f/2.8 soft background' },
      { id: 'f56', zh: 'f/5.6', en: 'f/5.6, moderate depth of field', ui: 'f/5.6' },
      { id: 'f11', zh: 'f/11 全景深', en: 'f/11, deep focus, everything sharp', ui: 'f/11 deep focus' }
    ]
  },
  {
    id: 'light', zh: '光線', en: 'Lighting', max: 3,
    options: [
      { id: 'soft', zh: '柔光', en: 'soft diffused light', ui: 'Soft light' },
      { id: 'window', zh: '窗光', en: 'natural window light', ui: 'Window light' },
      { id: 'golden', zh: '黃金時刻', en: 'golden hour sunlight', ui: 'Golden hour' },
      { id: 'blue', zh: '藍色時刻', en: 'blue hour light', ui: 'Blue hour' },
      { id: 'rim', zh: '逆光輪廓', en: 'backlight with rim light', ui: 'Rim light' },
      { id: 'rembrandt', zh: '林布蘭光', en: 'Rembrandt lighting', ui: 'Rembrandt' },
      { id: 'butterfly', zh: '蝴蝶光', en: 'butterfly lighting', ui: 'Butterfly' },
      { id: 'split', zh: '分割光', en: 'split lighting', ui: 'Split' },
      { id: 'studio', zh: '影棚柔光箱', en: 'studio softbox lighting', ui: 'Softbox' },
      { id: 'cine', zh: '電影感', en: 'cinematic lighting', ui: 'Cinematic' },
      { id: 'neon', zh: '霓虹', en: 'neon lights', ui: 'Neon' },
      { id: 'candle', zh: '燭光', en: 'warm candlelight', ui: 'Candlelight' },
      { id: 'volume', zh: '體積光', en: 'volumetric light rays', ui: 'Volumetric' }
    ]
  },
  {
    id: 'weather', zh: '天氣', en: 'Weather', max: 1,
    options: [
      { id: 'sunny', zh: '晴天', en: 'sunny' },
      { id: 'cloudy', zh: '多雲', en: 'partly cloudy' },
      { id: 'overcast', zh: '陰天', en: 'overcast' },
      { id: 'drizzle', zh: '小雨', en: 'light rain' },
      { id: 'rain', zh: '大雨', en: 'heavy rain' },
      { id: 'fog', zh: '霧', en: 'fog' },
      { id: 'snow', zh: '下雪', en: 'snowfall' }
    ]
  },
  {
    id: 'place', zh: '場景', en: 'Setting', max: 1,
    options: [
      { id: 'studio', zh: '純色影棚', en: 'seamless studio backdrop', ui: 'Studio backdrop' },
      { id: 'street', zh: '城市街道', en: 'city street' },
      { id: 'cafe', zh: '咖啡店', en: 'cozy café', ui: 'Café' },
      { id: 'beach', zh: '海灘', en: 'beach' },
      { id: 'forest', zh: '森林', en: 'forest' },
      { id: 'rooftop', zh: '夜間屋頂', en: 'rooftop at night with city lights', ui: 'Rooftop at night' },
      { id: 'library', zh: '圖書館', en: 'library' },
      { id: 'station', zh: '月台', en: 'train platform' },
      { id: 'oldtown', zh: '日式老街', en: 'old Japanese shopping street', ui: 'Old Japanese street' }
    ]
  },
  {
    id: 'expression', zh: '表情', en: 'Expression', max: 1,
    options: [
      { id: 'neutral', zh: '平靜', en: 'calm, neutral expression', ui: 'Calm' },
      { id: 'smile', zh: '微笑', en: 'soft smile', ui: 'Smile' },
      { id: 'laugh', zh: '大笑', en: 'laughing' },
      { id: 'serious', zh: '認真', en: 'serious expression', ui: 'Serious' },
      { id: 'shy', zh: '害羞', en: 'shy expression', ui: 'Shy' },
      { id: 'confident', zh: '自信', en: 'confident expression', ui: 'Confident' }
    ]
  },
  {
    id: 'style', zh: '風格', en: 'Style', max: 1,
    options: [
      { id: 'photo', zh: '寫實攝影', en: 'photorealistic photograph', ui: 'Photorealistic' },
      { id: 'film', zh: '底片質感', en: '35mm film photo with natural grain', ui: 'Film' },
      { id: 'editorial', zh: '時裝雜誌', en: 'fashion editorial photograph', ui: 'Fashion editorial' },
      { id: 'anime', zh: '動漫插畫', en: 'anime illustration', ui: 'Anime' },
      { id: 'render', zh: '3D 渲染', en: '3D render' },
      { id: 'watercolor', zh: '水彩', en: 'watercolor painting', ui: 'Watercolor' },
      { id: 'oil', zh: '油畫', en: 'oil painting' },
      { id: 'pencil', zh: '鉛筆素描', en: 'pencil sketch' },
      { id: 'cyber', zh: '賽博朋克', en: 'cyberpunk' }
    ]
  }
];

// 場景設定的分頁：每頁顯示哪些選項組。'fields' 代表服裝、髮型等文字欄位。
Engine.sceneTabs = [
  { id: 'framing', icon: 'frame', zh: '構圖', en: 'Framing', groups: ['aspect', 'shot', 'angle'] },
  { id: 'lens', icon: 'aperture', zh: '鏡頭', en: 'Lens', groups: ['lens', 'aperture'] },
  { id: 'light', icon: 'sun', zh: '光線', en: 'Light', groups: ['light', 'weather'] },
  { id: 'setting', icon: 'mountain', zh: '場景', en: 'Setting', groups: ['place', 'style'] },
  { id: 'subject', icon: 'face', zh: '人物', en: 'Subject', groups: ['expression'], fields: true }
];

// 快速風格：一鍵套用整組場景選項。未列出的選項組會清空。
// g 是預覽色塊的漸層顏色。
Engine.looks = [
  {
    id: 'studio', zh: '棚拍人像', en: 'Studio portrait', g: ['#f1ece4', '#b9c0cf', '#7c8496'],
    opts: { aspect: ['3:4'], shot: ['ms'], angle: ['eye'], lens: ['85'], aperture: ['f28'], light: ['studio', 'soft'], place: ['studio'], expression: ['smile'], style: ['photo'] }
  },
  {
    id: 'street', zh: '街頭時裝', en: 'Street fashion', g: ['#ffd39a', '#e0865a', '#3a3f5c'],
    opts: { aspect: ['2:3'], shot: ['full'], angle: ['low'], lens: ['35'], aperture: ['f28'], light: ['golden'], weather: ['sunny'], place: ['street'], expression: ['confident'], style: ['editorial'] }
  },
  {
    id: 'night', zh: '電影夜景', en: 'Cinematic night', g: ['#ff4fa3', '#5b3cff', '#0c1030'],
    opts: { aspect: ['16:9'], shot: ['cowboy'], angle: ['eye'], lens: ['50'], aperture: ['f14'], light: ['neon', 'cine'], weather: ['drizzle'], place: ['rooftop'], expression: ['serious'], style: ['film'] }
  },
  {
    id: 'cafe', zh: '午後咖啡店', en: 'Afternoon café', g: ['#f6e3c4', '#c79a6b', '#5d4433'],
    opts: { aspect: ['4:3'], shot: ['ms'], angle: ['tq'], lens: ['50'], aperture: ['f14'], light: ['window', 'soft'], place: ['cafe'], expression: ['smile'], style: ['film'] }
  },
  {
    id: 'beach', zh: '海邊黃昏', en: 'Beach sunset', g: ['#ffc37a', '#ff7a6b', '#4a5fa8'],
    opts: { aspect: ['9:16'], shot: ['full'], angle: ['eye'], lens: ['85'], aperture: ['f28'], light: ['golden', 'rim'], weather: ['sunny'], place: ['beach'], expression: ['laugh'], style: ['photo'] }
  },
  {
    id: 'anime', zh: '動漫插畫', en: 'Anime', g: ['#ffd1e8', '#a9c7ff', '#7b6cff'],
    opts: { aspect: ['3:4'], shot: ['cowboy'], angle: ['eye'], light: ['soft'], weather: ['sunny'], place: ['oldtown'], expression: ['smile'], style: ['anime'] }
  }
];
