"""Check that data/catalog.json, data/library.js and images/ agree.

  - every item has a unique id, a known source and a valid rating
  - every file the catalog names exists in every tier
  - no image in images/ is missing from the catalog
  - data/library.js holds exactly the catalog's data

Usage:  python3 -I tools/verify_library.py      (exit code 1 on any problem)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
IMAGES = REPO / "images"
CATALOG = REPO / "data" / "catalog.json"
LIBRARY_JS = REPO / "data" / "library.js"
KINDS = ("face", "pose", "outfit")
DEPTH_JS = REPO / "data" / "depth-official.js"
DEPTH_IMAGES = IMAGES / "pose-depth-official"
DEPTH_PREFIX = "window.COMPOSE_DEPTH_OFFICIAL = "
DEPTH_TIERS = ("w300", "w900")
RATINGS = {"general", "suggestive"}
JS_PREFIX = "window.COMPOSE_LIBRARY = "


def files_of(kind: str, item: dict) -> list[str]:
    return list(item["views"].values()) if kind == "pose" else [item["file"]]


def check(catalog: dict) -> list[str]:
    problems = []
    if catalog.get("format") != "compose-studio-library":
        problems.append("catalog format is not compose-studio-library")
    tiers = catalog.get("tiers") or []
    for kind in KINDS:
        seen = set()
        named = set()
        for item in catalog.get(kind, []):
            iid = item.get("id")
            if not iid or iid in seen:
                problems.append(f"{kind}: missing or duplicate id {iid!r}")
            seen.add(iid)
            if item.get("source") not in catalog.get("sources", {}):
                problems.append(f"{kind} {iid}: unknown source {item.get('source')!r}")
            if kind != "face" and item.get("rating") not in RATINGS:
                problems.append(f"{kind} {iid}: bad rating {item.get('rating')!r}")
            for name in files_of(kind, item):
                named.add(name)
                for tier in tiers:
                    if not (IMAGES / kind / tier / name).is_file():
                        problems.append(f"{kind} {iid}: missing images/{kind}/{tier}/{name}")
        for tier in tiers:
            for f in sorted((IMAGES / kind / tier).glob("*")):
                if f.name not in named:
                    problems.append(f"images/{kind}/{tier}/{f.name} is not in the catalog")
    return problems


def check_js(catalog: dict) -> list[str]:
    lines = LIBRARY_JS.read_text(encoding="utf-8").splitlines()
    body = next((line for line in lines if line.startswith(JS_PREFIX)), None)
    if body is None:
        return ["data/library.js has no COMPOSE_LIBRARY line"]
    data = json.loads(body[len(JS_PREFIX):].rstrip(";").replace("<\\/", "</"))
    return [] if data == catalog else ["data/library.js differs from data/catalog.json; run build_library.py --catalog-only"]


def check_depth(catalog: dict) -> list[str]:
    if not DEPTH_JS.is_file():
        return []
    body = next((line for line in DEPTH_JS.read_text(encoding="utf-8").splitlines() if line.startswith(DEPTH_PREFIX)), None)
    if body is None:
        return ["data/depth-official.js has no COMPOSE_DEPTH_OFFICIAL line"]
    try:
        keys = json.loads(body[len(DEPTH_PREFIX):].rstrip(";"))
    except json.JSONDecodeError as exc:
        return [f"data/depth-official.js is not valid JSON: {exc}"]
    expected = {f"{p['series']}|{p['num']}|{angle}" for p in catalog.get("pose", []) for angle in p["views"]}
    problems = []
    missing = sorted(expected - set(keys))
    extra = sorted(set(keys) - expected)
    if missing:
        problems.append(f"depth: {len(missing)} catalog views have no depth map ({missing[:3]})")
    if extra:
        problems.append(f"depth: {len(extra)} depth keys are not in the catalog ({extra[:3]})")
    names = {key.replace("|", "_") + ".webp" for key in keys}
    for key in sorted(set(keys)):
        name = key.replace("|", "_") + ".webp"
        for tier in DEPTH_TIERS:
            if not (DEPTH_IMAGES / tier / name).is_file():
                problems.append(f"depth {key}: missing images/pose-depth-official/{tier}/{name}")
    for tier in DEPTH_TIERS:
        folder = DEPTH_IMAGES / tier
        if folder.is_dir():
            for f in sorted(folder.glob("*.webp")):
                if f.name not in names:
                    problems.append(f"images/pose-depth-official/{tier}/{f.name} is not in data/depth-official.js")
    return problems


def depth_count() -> int:
    if not DEPTH_JS.is_file():
        return 0
    body = next((line for line in DEPTH_JS.read_text(encoding="utf-8").splitlines() if line.startswith(DEPTH_PREFIX)), None)
    if body is None:
        return 0
    try:
        return len(json.loads(body[len(DEPTH_PREFIX):].rstrip(";")))
    except json.JSONDecodeError:
        return 0


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    problems = check(catalog) + check_js(catalog) + check_depth(catalog)
    counts = ", ".join(f"{k} {len(catalog.get(k, []))}" for k in KINDS)
    if depth_count():
        counts += f", depth {depth_count()}"
    if problems:
        print("\n".join(problems[:50]))
        print(f"{len(problems)} problem(s); {counts}")
        return 1
    print(f"ok: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
