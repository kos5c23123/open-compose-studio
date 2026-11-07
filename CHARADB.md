# CharaDB anime outfits

Source: [CharaDB](https://charadb-2fi.pages.dev/) by **たき AI** ([@taki_auto](https://x.com/taki_auto)).
Official repository: <https://github.com/taki-ttt/charadb>. Official licence: <https://github.com/taki-ttt/charadb/blob/main/LICENSE>.

## What is included

`images/outfit/w300/` and `images/outfit/w900/` contain the 440 CharaDB outfits
(`ANM-001` … `ANM-495`, `ANX-013` … `ANX-436`) as w300 thumbnails and
full-resolution 1024×1536 WebP copies, and `data/catalog.json` holds their names,
categories and tags. The exact 1024×1536 JPEGs are **not** included; `tools/fetch_charadb.py` downloads them
to a local folder if you want them.

The 15 CharaDB categories are mapped to the app's `ANM` (general) and `ANX`
(suggestive) outfit codes. The 44 `ANX` items stay hidden until **Show
suggestive** is enabled.

## Upstream terms

The image licence is **not** MIT or CC0. Per the author's terms, the images are
free to use as reference material, without credit, but the images themselves
(original or processed) may not be redistributed, reposted or resold, and may not
be used to depict real people or minors. Tags and names are CC0 1.0; the official
code is MIT. Check the model's licence before sending an image to it.

## Updating

`tools/fetch_charadb.py` downloads the current official set and builds a local
app pack (`original/` + `app/`); it does not modify this repository. To update
the built-in copies, review the official licence first.
