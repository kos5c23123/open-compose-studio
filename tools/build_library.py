"""Build the built-in library: web-size images plus data/catalog.json and data/library.js.

Sources are folders on your own machine; nothing is downloaded here.
  --faces    face library folder: images.js plus face/ai-face-*.png and styling/ai-styling-*.png
             (from ai-portrait-gallery.pages.dev, CC0)
  --shisei   Shisei folder: catalog.json plus original/line/*.webp
             (catalog.json from the repo's data/, originals from its Release zip, CC0)
  --outfits  our own outfits: a folder of CS-*.png images
  --outfit-prompts  the prompt file those outfits were made from (gives each outfit its description)

Output:
  images/<kind>/w300/<file>.webp   thumbnails
  images/<kind>/w900/<file>.webp   the image the app sends to a model or copies
  data/catalog.json                the source of truth (see README, Built-in library)
  data/library.js                  the same data as a script, so the app also works from file://

Existing images are kept; delete a file to rebuild it. Needs Pillow with WebP.
Usage:  python3 tools/build_library.py --faces DIR --shisei DIR --outfits DIR --outfit-prompts FILE
        python3 tools/build_library.py --retag          # re-apply tools/tags/ to data/catalog.json
        python3 tools/build_library.py --catalog-only   # rewrite data/library.js from data/catalog.json

Browsing tags (outfit types and colors, pose actions, face hairstyles) come from library_tags.py.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from library_tags import add_tags  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
IMAGES = REPO / "images"
CATALOG = REPO / "data" / "catalog.json"
LIBRARY_JS = REPO / "data" / "library.js"
FORMAT = "compose-studio-library"
TIERS = {"w300": 300, "w900": 900}
WEBP_QUALITY = {"face": 82, "pose": 80, "outfit": 82}
WORKERS = 6

SOURCES = {
    "agi": {"name": "AIモデル顔データベース by あぎ (@agi_aibusi)", "url": "https://ai-portrait-gallery.pages.dev/",
            "license": "CC0-1.0"},
    "shisei": {"name": "Shisei 姿勢", "url": "https://github.com/wquguru/shisei", "license": "CC0-1.0"},
    "own": {"name": "Open Compose Studio", "url": "https://github.com/kos5c23123/open-compose-studio",
            "license": "CC0-1.0"},
}
# Shisei view names -> the angle names the app already uses
SHISEI_ANGLES = {"front": "front", "diag": "diag", "side": "side", "above": "high", "below": "low"}
OUTFIT_ID_RE = re.compile(r"^CS-(SPR|SUM|AUT|WIN|LNG|PTY|SWM|SXY)-\d{4}$")
SUGGESTIVE_OUTFITS = {"LNG", "SWM", "SXY"}
FACE_FILE_RE = re.compile(r"^ai-(face|styling)-([0-9a-f]+)\.png$")


def make_tiers(job: tuple[str, str, str]) -> str | None:
    """Write every missing tier of one image; returns an error message or None."""
    src, kind, name = job
    targets = {t: IMAGES / kind / t / f"{name}.webp" for t in TIERS}
    if all(p.exists() for p in targets.values()):
        return None
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")
            for tier, width in TIERS.items():
                dest = targets[tier]
                if dest.exists():
                    continue
                k = min(1.0, width / im.width)
                out = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_name(dest.name + ".part")
                out.save(tmp, "WEBP", quality=WEBP_QUALITY[kind], method=6)
                tmp.replace(dest)
    except (OSError, ValueError) as e:
        return f"{src}: {e}"
    return None


def read_face_rows(folder: Path) -> dict[str, dict]:
    text = (folder / "images.js").read_text(encoding="utf-8")
    start, end = text.index("[", text.index("GALLERY_IMAGES")), text.rindex("]")
    rows = json.loads(text[start:end + 1])
    return {str(r["id"]).lower(): r for r in rows if isinstance(r, dict) and r.get("id")}


def collect_faces(folder: Path) -> tuple[list[dict], list[tuple[str, str, str]]]:
    meta = read_face_rows(folder)
    items, jobs = [], []
    for section in ("face", "styling"):
        for f in sorted((folder / section).glob("ai-*.png")):
            m = FACE_FILE_RE.match(f.name)
            if not m or m.group(1) != section:
                print(f"skip {f.name}: unexpected file name", file=sys.stderr)
                continue
            fid = m.group(2)
            row = meta.get(fid, {})
            name = f.stem
            items.append({"id": fid, "section": section, "hair": str(row.get("hair", "")).strip(),
                          "style": str(row.get("style", "")).strip(), "file": f"{name}.webp", "source": "agi"})
            jobs.append((str(f), "face", name))
    return items, jobs


def collect_poses(folder: Path) -> tuple[list[dict], list[tuple[str, str, str]]]:
    rows = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    line = folder / "original" / "line"
    items, jobs = [], []
    for r in rows:
        views = {}
        for view, angle in SHISEI_ANGLES.items():
            file = (r.get("views") or {}).get(view)
            if file and (line / file).exists():
                name = Path(file).stem
                views[angle] = f"{name}.webp"
                jobs.append((str(line / file), "pose", name))
        if not views:
            continue  # Shisei hides a pose with no usable view; so do we
        # Shisei's pose names and categories follow ギア's list (credited, not licensed), so they are
        # left out; desc_en is Shisei's own text (only the std series has it)
        items.append({"id": f"{r['series']}_{r['id']}", "series": r["series"], "num": r["id"], "rating": r["rating"],
                      "desc": str(r.get("desc_en") or "").strip(), "views": views, "source": "shisei"})
    return items, jobs


def collect_outfits(folder: Path, prompts: Path) -> tuple[list[dict], list[tuple[str, str, str]]]:
    desc = {p["id"]: p["desc"] for p in json.loads(prompts.read_text(encoding="utf-8"))["prompts"]}
    items, jobs = [], []
    for f in sorted(folder.glob("*.png")):
        if not OUTFIT_ID_RE.match(f.stem):
            print(f"skip {f.name}: not a CS- outfit id", file=sys.stderr)
            continue
        code = f.stem.split("-")[1]
        items.append({"id": f.stem, "code": code, "rating": "suggestive" if code in SUGGESTIVE_OUTFITS else "general",
                      "desc": desc.get(f.stem, ""), "file": f"{f.stem}.webp", "source": "own"})
        jobs.append((str(f), "outfit", f.stem))
    return items, jobs


def write_library_js(catalog: dict) -> None:
    # keep "</" out of the inline data so no string can close a script tag
    data = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    LIBRARY_JS.write_text("// Generated by tools/build_library.py from data/catalog.json. Do not edit.\n"
                          f"window.COMPOSE_LIBRARY = {data};\n", encoding="utf-8")


def write_catalog(catalog: dict) -> None:
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_library_js(catalog)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--faces", type=Path)
    ap.add_argument("--shisei", type=Path)
    ap.add_argument("--outfits", type=Path)
    ap.add_argument("--outfit-prompts", type=Path)
    ap.add_argument("--catalog-only", action="store_true")
    ap.add_argument("--retag", action="store_true")
    args = ap.parse_args()

    if args.retag:
        catalog = add_tags(json.loads(CATALOG.read_text(encoding="utf-8")))
        write_catalog(catalog)
        print(f"wrote {CATALOG} and {LIBRARY_JS}")
        return 0
    if args.catalog_only:
        write_library_js(json.loads(CATALOG.read_text(encoding="utf-8")))
        print(f"wrote {LIBRARY_JS}")
        return 0
    if not (args.faces and args.shisei and args.outfits and args.outfit_prompts):
        ap.error("--faces, --shisei, --outfits and --outfit-prompts are all required")

    faces, face_jobs = collect_faces(args.faces)
    poses, pose_jobs = collect_poses(args.shisei)
    outfits, outfit_jobs = collect_outfits(args.outfits, args.outfit_prompts)
    jobs = face_jobs + pose_jobs + outfit_jobs
    print(f"faces {len(faces)}, poses {len(poses)} ({len(pose_jobs)} views), outfits {len(outfits)}; {len(jobs)} images")

    errors = []
    with ProcessPoolExecutor(WORKERS) as pool:
        for n, err in enumerate(pool.map(make_tiers, jobs, chunksize=8), 1):
            if err:
                errors.append(err)
            if n % 300 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(f"{len(errors)} image(s) failed; catalog not written")

    catalog = add_tags({"format": FORMAT, "version": 1, "tiers": list(TIERS), "sources": SOURCES,
                        "face": faces, "pose": poses, "outfit": outfits})
    write_catalog(catalog)
    print(f"wrote {CATALOG} and {LIBRARY_JS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
