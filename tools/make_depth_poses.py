"""Generate our own depth pose references from Shisei's CC0 line art.

Why: ギア's depth gallery forbids redistribution, but Shisei's line art is CC0.
A monocular depth model turns each line drawing into a grey depth map; the
silhouette is cut out of the white background and the depth is normalised
inside it. The result is an approximate depth reference (not a 3D render), but
it follows the pose and can be used like the original depth pack.

Model: Depth Anything V2 Small (Apache-2.0), ONNX. The Base model is
CC-BY-NC-4.0, so it is offered only as an explicit option, not the default.
The generated depth images are derived from CC0 line art and are released here
under CC0 as well (see NOTICE).

Input   <compose-materials>/poses/shisei/original/line/*.webp (1,133 files)
        data/catalog.json maps each built-in pose view to its line-art file.
Output  images/pose-depth/w300/<key>.webp   thumbnails
        images/pose-depth/w900/<key>.webp   the image the app uses
        data/depth.js                       window.COMPOSE_DEPTH = [keys]
        tools/.cache/depth-report.json      QA stats (not committed)

Usage
  python3 -m venv tools/.venv
  tools/.venv/bin/pip install onnxruntime numpy scipy pillow
  tools/.venv/bin/python tools/make_depth_poses.py

  # trial / resume / other model
  tools/.venv/bin/python tools/make_depth_poses.py --limit 8
  tools/.venv/bin/python tools/make_depth_poses.py --resume
  tools/.venv/bin/python tools/make_depth_poses.py --model base   # CC-BY-NC, personal only
  tools/.venv/bin/python tools/make_depth_poses.py --shisei DIR --workers 6

The model is downloaded once to tools/.cache/ (~27 MB for small).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "tools" / ".cache"
CATALOG = REPO / "data" / "catalog.json"
DEFAULT_SHISEI = Path.home() / "Documents" / "compose-materials" / "poses" / "shisei" / "original" / "line"
OUT = REPO / "images" / "pose-depth"
MANIFEST = REPO / "data" / "depth.js"
REPORT = CACHE / "depth-report.json"
TIERS = {"w300": 300, "w900": 900}

MODELS = {
    "small": (
        "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx",
        "depth-anything-v2-small.onnx",
        "Apache-2.0",
    ),
    "base": (
        "https://huggingface.co/onnx-community/depth-anything-v2-base/resolve/main/onnx/model_quantized.onnx",
        "depth-anything-v2-base.onnx",
        "CC-BY-NC-4.0",
    ),
}

# worker globals
_SESSION = None
_MODEL = None
_MAX_SIDE = 1024
_OPEN_PX = 5
_KEEP = 0.12
_RESUME = False


def require_deps() -> None:
    missing = []
    for name in ("onnxruntime", "numpy", "scipy", "PIL"):
        try:
            __import__(name)
        except ImportError:
            missing.append(name)
    if missing:
        print("missing dependencies: " + ", ".join(missing), file=sys.stderr)
        print("create the venv first:\n  python3 -m venv tools/.venv\n  tools/.venv/bin/pip install onnxruntime numpy scipy pillow", file=sys.stderr)
        raise SystemExit(2)


def ensure_model(choice: str) -> Path:
    path = Path(choice).expanduser()
    if path.suffix == ".onnx" or "/" in choice:
        if not path.exists():
            raise SystemExit(f"model not found: {path}")
        return path
    if choice not in MODELS:
        raise SystemExit(f"unknown model {choice!r}; use small, base or a .onnx path")
    url, filename, license = MODELS[choice]
    dest = CACHE / filename
    if dest.exists() and dest.stat().st_size > 10_000_000:
        return dest
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"downloading {choice} model ({license}) from Hugging Face…")
    part = dest.with_suffix(".part")
    req = urllib.request.Request(url, headers={"User-Agent": "compose-studio-depth/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res, part.open("wb") as fh:
        total = int(res.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = res.read(1024 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done / 1048576:.1f} / {total / 1048576:.1f} MiB", end="")
    print()
    part.replace(dest)
    return dest


def init_worker(model_path: str, max_side: int, open_px: int, keep: float, resume: bool) -> None:
    global _SESSION, _MODEL, _MAX_SIDE, _OPEN_PX, _KEEP, _RESUME
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    _SESSION = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
    _MODEL = model_path
    _MAX_SIDE = max_side
    _OPEN_PX = open_px
    _KEEP = keep
    _RESUME = resume


def predict(im, max_side: int):
    import numpy as np
    from PIL import Image

    w, h = im.size
    k = min(1.0, max_side / max(w, h))
    nw = max(14, int(round(w * k / 14)) * 14)
    nh = max(14, int(round(h * k / 14)) * 14)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    x = np.asarray(im.resize((nw, nh), Image.LANCZOS), dtype=np.float32) / 255.0
    x = (x - mean) / std
    x = x.transpose(2, 0, 1)[None]
    y = _SESSION.run(None, {"pixel_values": x})[0][0]
    return np.asarray(Image.fromarray(y).resize((w, h), Image.BILINEAR), dtype=np.float32)


def figure_mask(im):
    """Inside-of-silhouette mask: the white paper outside is not part of the figure."""
    import numpy as np
    from PIL import Image, ImageFilter
    from scipy import ndimage

    g = np.array(im.convert("L"))
    line = Image.fromarray(np.where(g < 245, 255, 0).astype(np.uint8), "L")
    # close small gaps in the outline, then mark the outside by border-connected free space
    line = line.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    wall = np.array(line) > 0
    free = ~wall
    lab, n = ndimage.label(free)
    if n:
        borders = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
        out_ids = np.unique(borders[borders > 0])
        outside = np.isin(lab, out_ids)
    else:
        outside = np.zeros_like(free, dtype=bool)
    mask = ~outside
    if _OPEN_PX:
        mask = ndimage.binary_opening(mask, structure=np.ones((_OPEN_PX, _OPEN_PX), dtype=bool))
    lab, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        keep = np.where(sizes >= sizes.max() * _KEEP)[0] + 1
        mask = np.isin(lab, keep)
    return mask


def save_tier(gray, dest: Path, width: int, quality: int) -> None:
    from PIL import Image

    w, h = gray.size
    k = min(1.0, width / w)
    out = gray.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS) if k < 1 else gray
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    out.save(tmp, "WEBP", quality=quality, method=6)
    tmp.replace(dest)


def process(job):
    from PIL import Image
    import numpy as np

    key, src = job
    name = key.replace("|", "_")
    targets = {tier: OUT / tier / f"{name}.webp" for tier in TIERS}
    if _RESUME and all(p.exists() for p in targets.values()):
        return {"key": key, "skipped": True, "mask": None, "seconds": 0}

    started = time.time()
    im = Image.open(src).convert("RGB")
    depth = predict(im, _MAX_SIDE)
    mask = figure_mask(im)
    if not mask.any():
        return {"key": key, "error": "empty mask", "seconds": time.time() - started}
    vals = depth[mask]
    lo, hi = np.percentile(vals, [2, 98])
    z = np.clip((depth - lo) / (hi - lo + 1e-8), 0, 1) * 0.85 + 0.15
    z[~mask] = 0
    gray = Image.fromarray((z * 255).astype(np.uint8), "L")
    for tier, width in TIERS.items():
        save_tier(gray, targets[tier], width, 82)
    return {"key": key, "mask": float(mask.mean()), "seconds": time.time() - started}


def write_manifest(keys: list[str]) -> None:
    lines = [
        "// Generated by tools/make_depth_poses.py from Shisei (CC0) line art.",
        "// Depth: Depth Anything V2 Small (Apache-2.0). Local and public use allowed.",
        "// Keys are `series|pose number|angle` for built-in pose views.",
        f"window.COMPOSE_DEPTH = {json.dumps(sorted(set(keys)), ensure_ascii=False)};",
        "",
    ]
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_name(MANIFEST.name + ".part")
    tmp.write_text("\n".join(lines), encoding="utf-8")
    tmp.replace(MANIFEST)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shisei", type=Path, default=DEFAULT_SHISEI, help="Shisei original/line folder")
    ap.add_argument("--model", default="small", help="small (Apache-2.0), base (CC-BY-NC, personal), or a .onnx path")
    ap.add_argument("--max-side", type=int, default=1024)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--open-px", type=int, default=5, help="remove thin background lines (floor) from the mask")
    ap.add_argument("--keep", type=float, default=0.12, help="drop mask components smaller than this fraction of the largest")
    ap.add_argument("--limit", type=int, help="only the first N views (trial)")
    ap.add_argument("--resume", action="store_true", help="skip views whose two WebP tiers already exist")
    args = ap.parse_args()

    require_deps()
    if not args.shisei.is_dir():
        raise SystemExit(f"Shisei line folder not found: {args.shisei}")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    jobs = []
    for pose in catalog["pose"]:
        for angle, file in pose["views"].items():
            key = f"{pose['series']}|{pose['num']}|{angle}"
            src = args.shisei / file
            if not src.exists():
                raise SystemExit(f"missing line art: {src}")
            jobs.append((key, str(src)))
    jobs.sort()
    if args.limit:
        jobs = jobs[: args.limit]
    if not jobs:
        raise SystemExit("no views to generate")

    model = ensure_model(args.model)
    print(f"model: {model.name}, views: {len(jobs)}, workers: {args.workers}, max side: {args.max_side}")
    started = time.time()
    results = []
    with ProcessPoolExecutor(
        max_workers=max(1, args.workers),
        initializer=init_worker,
        initargs=(str(model), args.max_side, args.open_px, args.keep, args.resume),
    ) as pool:
        for i, res in enumerate(pool.map(process, jobs, chunksize=2), 1):
            results.append(res)
            if i % 25 == 0 or i == len(jobs):
                ok = sum(1 for r in results if "error" not in r)
                skipped = sum(1 for r in results if r.get("skipped"))
                print(f"  {i}/{len(jobs)}  ok={ok} skipped={skipped}")

    errors = [r for r in results if "error" in r]
    done = [r for r in results if "error" not in r and not r.get("skipped")]
    masks = [r["mask"] for r in done if r.get("mask") is not None]
    keys = [r["key"] for r in results if "error" not in r]
    write_manifest(keys)
    CACHE.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": model.name,
        "max_side": args.max_side,
        "views": len(jobs),
        "written": len(done),
        "skipped": sum(1 for r in results if r.get("skipped")),
        "errors": errors[:20],
        "mask_quantiles": {
            "min": round(min(masks), 4) if masks else None,
            "p05": round(float(__import__("numpy").percentile(masks, 5)), 4) if masks else None,
            "median": round(float(__import__("numpy").percentile(masks, 50)), 4) if masks else None,
            "p95": round(float(__import__("numpy").percentile(masks, 95)), 4) if masks else None,
            "max": round(max(masks), 4) if masks else None,
        },
        "seconds": round(time.time() - started, 1),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done: {len(done)} written, {report['skipped']} skipped, {len(errors)} errors, {report['seconds']}s")
    print(f"manifest: {MANIFEST} ({len(keys)} keys)")
    if errors:
        for e in errors[:10]:
            print(f"  {e['key']}: {e['error']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
