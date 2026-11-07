# ギア pose, depth and original outfits

Source: **ギア** ([@giaaibusi](https://x.com/giaaibusi))

- Poses: [ポーズ集 POSE-DB-01](https://ai-pose-gallery.pages.dev/) — 1,439 views
- Depth: [Depthポーズ集 POSE-DB-02](https://ai-pose-depth-gallery.pages.dev/) — 1,439 views
- Outfits: [衣装集 COSTUME-DB-01](https://ai-costume-gallery.pages.dev/) — 1,407 outfits

## What is included

`images/pose/`, `images/pose-depth-official/` and `images/outfit/` contain w300
thumbnails and full-resolution w900 WebP copies of the sets above (poses and
depth 900×1200; outfits 1366×2048), with their names/categories in
`data/catalog.json` and `data/depth-official.js`. The exact PNG originals and the
downloaded archives are **not** included.

## Upstream terms

The upstream image data is free for creative work, including commercial use and
editing, but the images themselves (original or processed) may not be
redistributed, reposted or resold; they must not be used to depict real people or
minors or for purposes against public order and morals. The 1,439 depth maps are
derived from the same pose set. Adult/suggestive content is hidden by default
behind **Show suggestive**.

## Updating

The helper scripts (`tools/fetch_depth_poses.py`, and the build tools in
`tools/`) document the source paths. Do not add the full-size archives or any
other ギア images to the repository without checking the upstream terms again.
