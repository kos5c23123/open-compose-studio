"""Our own browsing tags for the built-in library (used by build_library.py).

  face    style_name {zh, en} and tags (bob, layered, wavy, straight, wolf, bangs, colored)
          from tools/tags/face_styles.json
  pose    action, classified by eye, from tools/tags/pose_actions.json
  outfit  types and colors, read from our own outfit descriptions with the word lists below
"""
from __future__ import annotations

import json
import re
from pathlib import Path

TAGS = Path(__file__).resolve().parent / "tags"

# garment type -> words in an outfit description that mean it
OUTFIT_TYPES = {
    "dress": {"dress", "sundress", "gown", "pinafore", "nightdress", "romper", "babydoll"},
    "skirt": {"skirt"},
    "trousers": {"trousers", "jeans", "leggings", "chinos", "cargo"},
    "shorts": {"shorts", "boyshort"},
    "outerwear": {"jacket", "coat", "blazer", "cape", "trench", "puffer", "parka", "bolero", "overshirt", "hoodie"},
    "knitwear": {"sweater", "cardigan", "turtleneck", "pullover", "knit"},
    "set": {"set", "robe", "bodysuit", "swimsuit", "bikini", "pajama", "kimono", "teddy"},
}
# color family -> color words used in our descriptions (gold and silver are mostly jewelry, so left out)
COLOR_FAMILIES = {
    "black": {"black", "midnight"},
    "white": {"white", "ivory", "cream", "oatmeal", "champagne", "snow"},
    "brown": {"brown", "tan", "camel", "chocolate", "cognac", "beige", "sand", "khaki", "taupe", "cinnamon", "nude"},
    "grey": {"grey", "gray", "charcoal", "heather"},
    "blue": {"blue", "navy", "cobalt", "sky", "denim", "indigo", "sapphire", "powder", "turquoise"},
    "green": {"green", "olive", "forest", "emerald", "sage", "mint", "seafoam", "lime", "teal"},
    "red": {"red", "burgundy", "wine", "cherry", "ruby", "tomato"},
    "pink": {"pink", "blush", "rose", "fuchsia"},
    "orange": {"orange", "coral", "rust", "terracotta", "peach", "tangerine"},
    "yellow": {"yellow", "mustard", "lemon", "butter", "sunflower"},
    "purple": {"purple", "plum", "lilac", "lavender", "mauve"},
}
WORD_RE = re.compile(r"[a-z]+")


def _load(name: str) -> dict:
    return json.loads((TAGS / name).read_text(encoding="utf-8"))


def _matches(words: set[str], table: dict[str, set[str]]) -> list[str]:
    return [key for key, vocab in table.items() if words & vocab]


def tag_outfit(item: dict) -> dict:
    words = set(WORD_RE.findall(item.get("desc", "").lower()))
    return {**item, "types": _matches(words, OUTFIT_TYPES), "colors": _matches(words, COLOR_FAMILIES)}


def add_tags(catalog: dict) -> dict:
    """Return a copy of the catalog with tags added; fails if a face style or pose has no entry."""
    styles = _load("face_styles.json")["styles"]
    actions = _load("pose_actions.json")["actions"]
    missing = sorted({f["style"] for f in catalog["face"] if f["style"] and f["style"] not in styles})
    missing += sorted(p["id"] for p in catalog["pose"] if p["id"] not in actions)
    if missing:
        raise SystemExit("no tags for: " + ", ".join(missing))

    def face(f: dict) -> dict:
        s = styles.get(f["style"])
        return {**f, "style_name": {"zh": s["zh"], "en": s["en"]} if s else None, "tags": s["tags"] if s else []}

    return {**catalog,
            "face": [face(f) for f in catalog["face"]],
            "pose": [{**p, "action": actions[p["id"]]} for p in catalog["pose"]],
            "outfit": [tag_outfit(o) for o in catalog["outfit"]]}
