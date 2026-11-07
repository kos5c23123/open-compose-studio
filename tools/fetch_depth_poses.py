"""Download ギア's depth pose gallery into a personal-only comparison pack.

Source: https://ai-pose-depth-gallery.pages.dev/  (depthポーズ集 POSE-DB-02)

IMPORTANT — the author's terms on the site say, in part:
  * free to use for creative work (commercial use, editing and reference are OK);
  * the image data itself (original size and processed versions) may NOT be
    redistributed, reposted or resold;
  * bulk downloading of the database (including automated acquisition with a
    tool) is NOT allowed; using the images one at a time as generation
    references is allowed.

This script automates a bulk download, so only run it if you have decided that
is acceptable for your own personal use, and never commit or publish the images
it writes.  Everything it writes stays on your machine and is git-ignored:

NOTE: the app supports two local depth sources.  This script builds the Official
one; make_depth_poses.py builds the optional Generated one (CC0).  The official
pack is tracked in the repository; the generated pack is local-only and ignored.
  <compose-materials>/poses/depth/...        the downloaded PNGs (archive)
  images/pose-depth-official/w300,w900/*.webp  Official local pack
  data/depth-official.js                     its manifest (Settings → Depth poses)

The app pairs a depth map with a built-in pose view by (series, pose number,
angle); the ギア depth gallery and the built-in ギア poses share the same ids.

Usage
  python3 tools/fetch_depth_poses.py                 # download all 1,439 views
  python3 tools/fetch_depth_poses.py --only-builtin   # only the 1,439 views in the built-in library
  python3 tools/fetch_depth_poses.py --limit 10       # small trial run
  python3 tools/fetch_depth_poses.py --no-download    # rebuild WebP + manifest from the archive
  python3 tools/fetch_depth_poses.py --yes            # skip the confirmation prompt

Requires Pillow (WebP support).  Downloads are resumable; existing files are
skipped.  Two workers with a short pause keep the load on the source low.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SITE = "https://ai-pose-depth-gallery.pages.dev/"
DEFAULT_SRC = Path.home() / "Documents" / "compose-materials"
USER_AGENT = "compose-studio-depth-pack/1.0 (personal use; low rate)"
TIMEOUT_S = 60
RETRIES = 4
BACKOFF_S = 2.0
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# Shisei series -> the series prefix the depth gallery uses
TIERS = {"w300": 300, "w900": 900}
WEBP_QUALITY = 88

TERMS = """
The depth gallery's terms (https://ai-pose-depth-gallery.pages.dev/):
  - Free to use for creative work; commercial use, editing and reference are OK.
  - The image data itself (original size and processed versions) may not be
    redistributed, reposted or resold.
  - Bulk downloading of the database (including automated acquisition) is
    forbidden; using images one at a time for generation is allowed.
  - Must not depict real people or minors.

This script performs a bulk download. Run it only for personal use, and do not
commit, publish or share the downloaded files.
"""


def get_bytes(url: str) -> bytes:
    """GET with retries; 404 fails immediately."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(BACKOFF_S * (2**attempt))
    raise RuntimeError(f"failed after {RETRIES} attempts: {url}: {last}")


def parse_rows(html: str) -> list[dict]:
    m = re.search(r"const\s+D\s*=\s*(\[[\s\S]*?\])\s*;\s*\n", html)
    if not m:
        raise ValueError("depth catalog (const D=[...]) not found in the page")
    rows = json.loads(m.group(1))
    out: list[dict] = []
    for r in rows:
        rid = str(r.get("id", ""))
        if not re.match(r"^(full_single|full_sexy|upper80v2|pair60)_P\d{3}_(front|high|low|side|diag)$", rid):
            print(f"skipping unexpected row: {json.dumps(r, ensure_ascii=False)[:160]}", file=sys.stderr)
            continue
        if r.get("原寸") != f"img/{rid}.png":
            print(f"skipping row with unexpected path: {rid}", file=sys.stderr)
            continue
        out.append(r)
    if not out:
        raise ValueError("no usable rows in the depth catalog")
    return out


def archive_path(archive: Path, rid: str) -> Path:
    return archive / rid.split("_P")[0] / f"{rid}.png"


def builtin_mapping(src: Path) -> dict[str, str]:
    """depth gallery id -> built-in view key (`series|num|angle`)."""
    catalog_path = REPO / "data" / "catalog.json"
    if not catalog_path.exists():
        print(f"warning: {catalog_path} missing; no built-in mapping", file=sys.stderr)
        return {}
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for pose in catalog.get("pose", []):
        for angle in pose.get("views", {}):
            rid = f"{pose['series']}_{pose['num']}_{angle}"
            mapping[rid] = f"{pose['series']}|{pose['num']}|{angle}"
    return mapping


def valid_png(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 100:
        return False
    with path.open("rb") as fh:
        if fh.read(8) != PNG_MAGIC:
            return False
    try:
        with Image.open(path) as im:
            im.verify()
        return True
    except (OSError, ValueError):
        return False


def download(rid: str, dest: Path) -> str:
    """Download one PNG atomically. Returns 'ok', 'skip' or 'fail:<reason>'."""
    if valid_png(dest):
        return "skip"
    url = SITE + f"img/{rid}.png"
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                data = res.read()
            if not data.startswith(PNG_MAGIC):
                raise ValueError("not a PNG")
            dest.parent.mkdir(parents=True, exist_ok=True)
            part = dest.with_name(dest.name + ".part")
            part.write_bytes(data)
            part.replace(dest)
            return "ok"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "fail:404"
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as e:
            if attempt == RETRIES - 1:
                return f"fail:{type(e).__name__}: {e}"
        time.sleep(BACKOFF_S * (2**attempt))
    return "fail:unknown"


def make_tiers(src: Path, key: str) -> str | None:
    """Write the two WebP tiers for one depth view; returns an error message or None."""
    name = key.replace("|", "_")
    targets = {tier: REPO / "images" / "pose-depth-official" / tier / f"{name}.webp" for tier in TIERS}
    if all(p.exists() for p in targets.values()):
        return None
    try:
        with Image.open(src) as im:
            im = im.convert("L")
            for tier, width in TIERS.items():
                dest = targets[tier]
                if dest.exists():
                    continue
                k = min(1.0, width / im.width)
                out = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_name(dest.name + ".part")
                out.save(tmp, "WEBP", quality=WEBP_QUALITY, method=6)
                tmp.replace(dest)
        return None
    except (OSError, ValueError) as e:
        return str(e)


def write_manifest(keys: list[str], path: Path, global_name: str = "COMPOSE_DEPTH") -> None:
    lines = [
        "// Generated by tools/fetch_depth_poses.py. Personal only: do not commit.",
        "// Keys are `series|pose number|angle` for built-in pose views with a depth map.",
        f"window.{global_name} = {json.dumps(sorted(set(keys)), ensure_ascii=False)};",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text("\n".join(lines), encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="compose-materials folder (default: ~/Documents/compose-materials)")
    ap.add_argument("--only-builtin", action="store_true", help="download only views used by the built-in library")
    ap.add_argument("--limit", type=int, help="stop after N depth rows (for a trial run)")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--delay", type=float, default=0.25, help="seconds each worker waits between requests")
    ap.add_argument("--no-download", action="store_true", help="use the existing archive only")
    ap.add_argument("--yes", action="store_true", help="skip the terms confirmation")
    ap.add_argument("--manifest-only", action="store_true", help="only rewrite data/depth-official.js from existing WebP files")
    args = ap.parse_args()

    if not args.yes:
        print(TERMS)
        if not sys.stdin.isatty():
            print("Refusing to start without a terminal; pass --yes to confirm.", file=sys.stderr)
            return 2
        if input("Type 'yes' to continue: ").strip().lower() != "yes":
            print("Cancelled.")
            return 2

    archive = args.src / "poses" / "depth"
    mapping = builtin_mapping(args.src)
    print(f"built-in depth views mapped: {len(mapping)}")

    if args.manifest_only:
        keys = [k for k in mapping.values() if all((REPO / "images" / "pose-depth-official" / t / f"{k.replace('|', '_')}.webp").exists() for t in TIERS)]
        write_manifest(keys, REPO / "data" / "depth-official.js", "COMPOSE_DEPTH_OFFICIAL")
        print(f"manifest: {len(keys)} views -> data/depth-official.js")
        return 0

    rows: list[dict] = []
    if args.no_download:
        if (archive / "ai-pose-depth-gallery.html").exists():
            rows = parse_rows((archive / "ai-pose-depth-gallery.html").read_text(encoding="utf-8"))
        else:
            print(f"error: no saved gallery page under {archive}", file=sys.stderr)
            return 2
    else:
        print(f"fetching {SITE}")
        html = get_bytes(SITE).decode("utf-8")
        rows = parse_rows(html)
        archive.mkdir(parents=True, exist_ok=True)
        (archive / "ai-pose-depth-gallery.html").write_text(html, encoding="utf-8")

    if args.only_builtin:
        rows = [r for r in rows if r["id"] in mapping]
    if args.limit:
        rows = rows[: args.limit]
    print(f"{len(rows)} depth views; archive: {archive}")

    jobs = [(r["id"], archive_path(archive, r["id"])) for r in rows]
    results: dict[str, str] = {}
    todo = []
    for rid, dest in jobs:
        if valid_png(dest):
            results[rid] = "skip"
        else:
            todo.append((rid, dest))

    if args.no_download:
        for rid, _ in todo:
            results[rid] = "fail:missing (archive only)"
    elif todo:
        print(f"downloading {len(todo)} views ({args.workers} workers, {args.delay}s pause)…")
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {}
            for rid, dest in todo:
                futures[pool.submit(download, rid, dest)] = rid
                time.sleep(args.delay)
            done = 0
            for fut in as_completed(futures):
                rid = futures[fut]
                try:
                    results[rid] = fut.result()
                except Exception as e:  # noqa: BLE001
                    results[rid] = f"fail:{type(e).__name__}: {e}"
                done += 1
                if done % 100 == 0 or done == len(todo):
                    ok = sum(1 for v in results.values() if v in ("ok", "skip"))
                    print(f"  {done}/{len(todo)} ({ok} on disk)")

    # Build WebP tiers + the manifest for the views the built-in library can use.
    keys: list[str] = []
    built = 0
    errors = 0
    for rid, key in mapping.items():
        dest = archive_path(archive, rid)
        if not valid_png(dest):
            continue
        err = make_tiers(dest, key)
        if err:
            errors += 1
            if errors <= 5:
                print(f"  webp error for {key}: {err}", file=sys.stderr)
        else:
            keys.append(key)
            built += 1
    write_manifest(keys, REPO / "data" / "depth-official.js", "COMPOSE_DEPTH_OFFICIAL")
    print(f"built {built} depth views into images/pose-depth-official; manifest: data/depth-official.js")

    failed = {k: v for k, v in results.items() if v.startswith("fail")}
    if failed:
        print(f"{len(failed)} downloads failed (re-run to retry):")
        for rid, msg in list(failed.items())[:15]:
            print(f"  {rid}: {msg}")
    print("done.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
