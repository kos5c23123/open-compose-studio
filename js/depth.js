// Depth pose packs.
//   official  images/pose-depth-official/ + data/depth-official.js  (ギア POSE-DB-02, built in)
//   generated images/pose-depth/         + data/depth.js            (Shisei CC0 line art + Depth Anything V2, optional local)
// Loading fails gracefully when a pack is absent, so the depth controls simply
// do not appear on the public site.
window.Engine = window.Engine || {};

(function () {
  const PACKS = {
    official: {
      src: 'data/depth-official.js',
      global: 'COMPOSE_DEPTH_OFFICIAL',
      base: 'images/pose-depth-official'
    },
    generated: {
      src: 'data/depth.js',
      global: 'COMPOSE_DEPTH',
      base: 'images/pose-depth'
    }
  };
  const jobs = {};
  const RAW = 'https://raw.githubusercontent.com/kos5c23123/open-compose-studio/main/';
  const remoteFull = /(^|\.)github\.io$/.test(location.hostname);

  // The key a built-in pose view uses: `series|pose number|angle`, e.g. `std|P001|high`.
  function keyOf(info) {
    return info && info.kind === 'pose' && info.key ? `${info.key}|${info.angle}` : '';
  }

  // Resolve to the manifest array, or null when the pack is not installed.
  function loadManifest(id) {
    const pack = PACKS[id];
    if (!pack) return Promise.resolve(null);
    if (Array.isArray(window[pack.global])) return Promise.resolve(window[pack.global]);
    if (!jobs[id]) {
      jobs[id] = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = pack.src;
        s.onload = () => resolve(Array.isArray(window[pack.global]) ? window[pack.global] : null);
        s.onerror = () => resolve(null);
        document.head.append(s);
      });
    }
    return jobs[id];
  }

  // Check both packs once; a missing pack becomes null.
  async function probe() {
    const out = {};
    await Promise.all(Object.keys(PACKS).map(async (id) => {
      const keys = await loadManifest(id);
      out[id] = keys ? { count: new Set(keys).size, keys, base: PACKS[id].base } : null;
    }));
    return out;
  }

  // Load one pack; null when it is not installed.
  async function load(id) {
    const pack = PACKS[id];
    if (!pack) return null;
    const keys = await loadManifest(id);
    return keys ? { keys: new Set(keys), base: pack.base } : null;
  }

  // Add depth URLs to built-in pose entries whose key is in the pack.
  function attach(items, keys, base) {
    if (!keys || !keys.size || !base) return 0;
    let n = 0;
    for (const item of items) {
      const key = keyOf(item.info);
      if (!key || !keys.has(key)) continue;
      const name = key.replace(/\|/g, '_');
      item.depthKey = key;
      item.depthSrc = remoteFull ? `${RAW}${base}/w900/${encodeURIComponent(name)}.webp` : `${base}/w900/${encodeURIComponent(name)}.webp`;
      item.depthThumbSrc = `${base}/w300/${encodeURIComponent(name)}.webp`;
      n++;
    }
    return n;
  }

  Engine.depth = { load, probe, attach, keyOf, PACKS };
})();
