"""Download CharaDB's public anime outfit set for local reference use.

Source: https://charadb-2fi.pages.dev/ by たき AI (@taki_auto)
Metadata: data/costume-anime-zh.json in anhao/ai-pose-gallery-zh (pinned commit)
          (Chinese names/categories translated there; tags/names are CC0)

IMPORTANT — the image licence is *not* MIT or CC0. The official terms allow free
use as reference material, with no credit, but forbid redistributing, reposting
or reselling the images (original or processed), and forbid using them to depict
real people or minors. Do not commit the downloaded images or put them in a
public build. They stay in ~/Documents/compose-materials and are git-ignored.

What it builds:
  <out>/original/O001.jpg              the official full-size JPEGs (440)
  <out>/app/ANM-001.webp               app-ready 900 px WebP (general)
  <out>/app/ANX-001.webp               app-ready 900 px WebP (sensitive)
  <out>/app/anime-meta.html            `const D = [...]` names for the app
  <out>/README.txt                     source and terms

Load the app pack:
  Library → Outfit → Add folder → choose <out>/app
  (the app reads anime-meta.html automatically; ANM/ANX are the category tabs)

Usage
  python3 tools/fetch_charadb.py --yes
  python3 tools/fetch_charadb.py --yes --limit 8           # trial
  python3 tools/fetch_charadb.py --yes --no-download       # rebuild app pack
  python3 tools/fetch_charadb.py --yes --out /path/to/dir

Requires Pillow (JPEG + WebP). Optional: opencc-python-reimplemented converts the
Simplified Chinese names to Traditional; without it the names stay Simplified.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    from opencc import OpenCC
    _CC = OpenCC('s2t')
except ImportError:
    _CC = None


def t2(s: str) -> str:
    """CharaDB metadata is Simplified Chinese; the app UI is Traditional."""
    return _CC.convert(s) if _CC and s else s


REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "tools" / ".cache"
DEFAULT_OUT = Path.home() / "Documents" / "compose-materials" / "outfits" / "anime"
META_URL = (
    "https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/"
    "261ff0978e1670cb3560ce3b7e15346f0e2fd0d5/data/costume-anime-zh.json"
)
META_CACHE = CACHE / "charadb-zh.json"
SOURCE = "https://charadb-2fi.pages.dev/"
NOTICE = "https://github.com/taki-ttt/charadb/blob/main/LICENSE"
UA = "compose-studio-charadb/1.0"

RULES = """CharaDB images (たき AI):
  * free to use as reference material; credit not required
  * the images themselves (original or processed) may NOT be redistributed,
    reposted or resold, and may not be included in a sold work
  * do not use them to depict real people or minors
  * the image licence is not MIT or CC0; the tags/names are CC0, the code MIT
  * sending an image to an image model is your responsibility under the
    author's current terms and the model's licence
Source: {source}
Licence: {notice}
""".format(source=SOURCE, notice=NOTICE)


def require_deps() -> None:
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("missing Pillow; run: python3 -m pip install pillow", file=sys.stderr)
        raise SystemExit(2)


def load_meta(path: Path | None) -> list[dict]:
    if path:
        return json.loads(path.read_text(encoding="utf-8"))
    if META_CACHE.exists():
        return json.loads(META_CACHE.read_text(encoding="utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    print("fetching CharaDB metadata…")
    req = urllib.request.Request(META_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
    data = json.loads(raw)
    META_CACHE.write_bytes(raw)
    return data


def validate(items: list[dict]) -> None:
    ids = [x.get("id") for x in items]
    if len(ids) != len(set(ids)) or not ids:
        raise SystemExit("metadata has duplicate or empty ids")
    for x in items:
        if not re.fullmatch(r"charadb-O\d{3}", str(x.get("id"))):
            raise SystemExit(f"unexpected id: {x.get('id')}")
        if not str(x.get("原图", "")).startswith(SOURCE + "img/"):
            raise SystemExit(f"unexpected image URL for {x.get('id')}: {x.get('原图')}")


def image_ok(path: Path, min_side: int = 256) -> bool:
    from PIL import Image

    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            return min(im.size) >= min_side
    except Exception:
        return False


def download_one(item: dict, out: Path, force: bool) -> tuple[str, str]:
    rid = item["id"]
    dest = out / "original" / f"{rid.split('-', 1)[1]}.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force and image_ok(dest):
        return rid, "exists"
    tmp = dest.with_name(dest.name + ".part")
    last = ""
    for attempt in range(3):
        try:
            req = urllib.request.Request(item["原图"], headers={"User-Agent": UA, "Referer": SOURCE})
            with urllib.request.urlopen(req, timeout=60) as res, tmp.open("wb") as fh:
                shutil.copyfileobj(res, fh)
            if not image_ok(tmp):
                raise ValueError("not a valid JPEG")
            tmp.replace(dest)
            return rid, "ok"
        except Exception as exc:  # noqa: BLE001 - retry any network/image error
            last = str(exc)
            if tmp.exists():
                tmp.unlink()
            time.sleep(0.8 * (attempt + 1))
    return rid, f"fail: {last}"


def app_name(item: dict) -> str:
    num = item["id"].split("-", 1)[1].replace("O", "")
    code = "ANX" if item.get("敏感") else "ANM"
    return f"{code}-{num}"


def keyword(item: dict) -> str:
    tags = [t for t in item.get("标签", []) if t and t != item.get("分类")]
    bits = [t2(item.get("服装名称", "")), t2(item.get("分类", "")), "、".join(t2(x) for x in tags)]
    return " · ".join(x for x in bits if x)


def build_app(items: list[dict], out: Path, quality: int) -> None:
    from PIL import Image

    app = out / "app"
    app.mkdir(parents=True, exist_ok=True)
    rows = []
    for item in items:
        src = out / "original" / f"{item['id'].split('-', 1)[1]}.jpg"
        if not src.exists():
            print(f"  skip (no original): {item['id']}", file=sys.stderr)
            continue
        name = app_name(item)
        dest = app / f"{name}.webp"
        if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
            with Image.open(src) as im:
                im = im.convert("RGB")
                width = min(900, im.width)
                height = round(im.height * width / im.width)
                im = im.resize((width, height), Image.LANCZOS)
                tmp = dest.with_name(dest.name + ".part")
                im.save(tmp, "WEBP", quality=quality, method=6)
                tmp.replace(dest)
        rows.append({"id": name, "キーワード": keyword(item)})
    rows.sort(key=lambda x: x["id"])
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    meta = (
        "<!doctype html><meta charset=\"utf-8\">\n"
        "<title>CharaDB anime outfits</title>\n"
        "<script>\n"
        f"const D = {payload};\n"
        "</script>\n"
    )
    (app / "anime-meta.html").write_text(meta, encoding="utf-8")
    print(f"app pack: {len(rows)} outfits -> {app}")


def write_readme(out: Path, count: int) -> None:
    text = f"""CharaDB anime outfits — local reference pack

Source: {SOURCE}
Author: たき AI (@taki_auto)
Official repository: https://github.com/taki-ttt/charadb
Licence: {NOTICE}

{RULES}

Downloaded: {count} outfits
  original/  official 1024x1536 JPEGs
  app/       900 px WebP + anime-meta.html for Compose Studio

Do not commit this folder or put it in a public build. The app loads it from
your disk via Library → Outfit → Add folder → app/.
"""
    (out / "README.txt").write_text(text, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--meta", type=Path, help="use a local costume-anime-zh.json")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--delay", type=float, default=0.12)
    ap.add_argument("--quality", type=int, default=84)
    ap.add_argument("--no-download", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--yes", action="store_true", help="confirm the image terms")
    args = ap.parse_args()

    require_deps()
    if not args.yes:
        print(RULES)
        if not sys.stdin.isatty():
            print("Refusing without a terminal; pass --yes after reading the terms.", file=sys.stderr)
            return 2
        if input("Type 'yes' to continue: ").strip().lower() != "yes":
            return 2

    items = load_meta(args.meta)
    validate(items)
    if args.limit:
        items = items[: args.limit]
    total = len(items)
    out = args.out.expanduser()
    (out / "original").mkdir(parents=True, exist_ok=True)
    print(f"CharaDB: {total} outfits -> {out}")

    if not args.no_download:
        done = 0
        fails = []
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futs = {pool.submit(download_one, item, out, args.force): item for item in items}
            for fut in as_completed(futs):
                rid, status = fut.result()
                done += 1
                if status.startswith("fail"):
                    fails.append((rid, status))
                if done % 25 == 0 or done == total:
                    print(f"  downloaded {done}/{total} (failed {len(fails)})")
                time.sleep(args.delay)
        if fails:
            print("some downloads failed; re-run to retry:", file=sys.stderr)
            for rid, msg in fails[:10]:
                print(f"  {rid}: {msg}", file=sys.stderr)
            return 1

    build_app(items, out, args.quality)
    write_readme(out, total)
    print(f"done. Load: {out / 'app'}  (Library → Outfit → Add folder)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
