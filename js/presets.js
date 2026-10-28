// 場景選項。每個選項有 zh（介面同中文 prompt 用）同 en（英文 / 日文 prompt 用）。
// 想加選項，直接喺對應 options 陣列加一行就得。
window.Engine = window.Engine || {};

Engine.presets = [
  {
    id: 'aspect', label: '畫面比例', max: 1, required: true, default: ['3:4'],
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
    id: 'shot', label: '景別', max: 1,
    options: [
      { id: 'xls', zh: '極遠景', en: 'extreme long shot' },
      { id: 'ls', zh: '遠景', en: 'long shot' },
      { id: 'full', zh: '全身', en: 'full body shot' },
      { id: 'mws', zh: '中遠景', en: 'medium wide shot' },
      { id: 'cowboy', zh: '七分身', en: 'cowboy shot, framed from mid-thigh up' },
      { id: 'ms', zh: '半身', en: 'medium shot, framed from the waist up' },
      { id: 'mcu', zh: '胸上', en: 'medium close-up' },
      { id: 'cu', zh: '特寫', en: 'close-up' },
      { id: 'ecu', zh: '大特寫', en: 'extreme close-up' }
    ]
  },
  {
    id: 'angle', label: '視角', max: 1,
    options: [
      { id: 'eye', zh: '平視', en: 'eye-level angle' },
      { id: 'high', zh: '俯拍', en: 'high angle' },
      { id: 'low', zh: '仰拍', en: 'low angle' },
      { id: 'bird', zh: '鳥瞰', en: "bird's-eye view" },
      { id: 'worm', zh: '蟲視', en: "worm's-eye view" },
      { id: 'tq', zh: '四分三側', en: 'three-quarter view' },
      { id: 'profile', zh: '側面', en: 'profile view' },
      { id: 'back', zh: '背面', en: 'back view' },
      { id: 'dutch', zh: '傾斜鏡頭', en: 'Dutch angle' },
      { id: 'ots', zh: '過肩', en: 'over-the-shoulder shot' },
      { id: 'selfie', zh: '自拍角度', en: 'selfie angle, arm-length' },
      { id: 'pov', zh: '主觀視角', en: 'first-person POV' }
    ]
  },
  {
    id: 'lens', label: '焦段', max: 1,
    options: [
      { id: '14', zh: '14mm 超廣角', en: '14mm ultra-wide lens' },
      { id: '24', zh: '24mm 廣角', en: '24mm wide-angle lens' },
      { id: '35', zh: '35mm', en: '35mm lens' },
      { id: '50', zh: '50mm 標準', en: '50mm standard lens' },
      { id: '85', zh: '85mm 人像', en: '85mm portrait lens' },
      { id: '135', zh: '135mm 望遠', en: '135mm telephoto lens' },
      { id: '200', zh: '200mm 壓縮感', en: '200mm telephoto lens with background compression' }
    ]
  },
  {
    id: 'aperture', label: '光圈', max: 1,
    options: [
      { id: 'f14', zh: 'f/1.4 淺景深', en: 'f/1.4, shallow depth of field, creamy bokeh' },
      { id: 'f28', zh: 'f/2.8 背景柔化', en: 'f/2.8, softly blurred background' },
      { id: 'f56', zh: 'f/5.6', en: 'f/5.6, moderate depth of field' },
      { id: 'f11', zh: 'f/11 全清', en: 'f/11, deep focus, everything sharp' }
    ]
  },
  {
    id: 'light', label: '光線', max: 3,
    options: [
      { id: 'soft', zh: '柔光', en: 'soft diffused light' },
      { id: 'window', zh: '窗光', en: 'natural window light' },
      { id: 'golden', zh: '黃金時刻', en: 'golden hour sunlight' },
      { id: 'blue', zh: '藍色時刻', en: 'blue hour light' },
      { id: 'rim', zh: '逆光輪廓', en: 'backlight with rim light' },
      { id: 'rembrandt', zh: '林布蘭光', en: 'Rembrandt lighting' },
      { id: 'butterfly', zh: '蝴蝶光', en: 'butterfly lighting' },
      { id: 'split', zh: '分割光', en: 'split lighting' },
      { id: 'studio', zh: '棚拍柔光箱', en: 'studio softbox lighting' },
      { id: 'cine', zh: '電影感', en: 'cinematic lighting' },
      { id: 'neon', zh: '霓虹', en: 'neon lights' },
      { id: 'candle', zh: '燭光', en: 'warm candlelight' },
      { id: 'volume', zh: '體積光', en: 'volumetric light rays' }
    ]
  },
  {
    id: 'weather', label: '天氣', max: 1,
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
    id: 'place', label: '場景', max: 1,
    options: [
      { id: 'studio', zh: '純色影棚', en: 'seamless studio backdrop' },
      { id: 'street', zh: '城市街道', en: 'city street' },
      { id: 'cafe', zh: '咖啡店', en: 'cozy café' },
      { id: 'beach', zh: '海灘', en: 'beach' },
      { id: 'forest', zh: '森林', en: 'forest' },
      { id: 'rooftop', zh: '夜晚天台', en: 'rooftop at night with city lights' },
      { id: 'library', zh: '圖書館', en: 'library' },
      { id: 'station', zh: '月台', en: 'train platform' },
      { id: 'oldtown', zh: '日式老街', en: 'old Japanese shopping street' }
    ]
  },
  {
    id: 'expression', label: '表情', max: 1,
    options: [
      { id: 'neutral', zh: '平靜', en: 'calm, neutral expression' },
      { id: 'smile', zh: '微笑', en: 'soft smile' },
      { id: 'laugh', zh: '大笑', en: 'laughing' },
      { id: 'serious', zh: '認真', en: 'serious expression' },
      { id: 'shy', zh: '害羞', en: 'shy expression' },
      { id: 'confident', zh: '自信', en: 'confident expression' }
    ]
  },
  {
    id: 'style', label: '風格', max: 1,
    options: [
      { id: 'photo', zh: '寫實攝影', en: 'photorealistic photograph' },
      { id: 'film', zh: '菲林質感', en: '35mm film photo with natural grain' },
      { id: 'editorial', zh: '時裝大片', en: 'fashion editorial photograph' },
      { id: 'anime', zh: '動漫插畫', en: 'anime illustration' },
      { id: 'render', zh: '3D 渲染', en: '3D render' },
      { id: 'watercolor', zh: '水彩', en: 'watercolor painting' },
      { id: 'oil', zh: '油畫', en: 'oil painting' },
      { id: 'pencil', zh: '鉛筆素描', en: 'pencil sketch' },
      { id: 'cyber', zh: '賽博朋克', en: 'cyberpunk' }
    ]
  }
];
