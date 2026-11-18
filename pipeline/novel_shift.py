#!/usr/bin/env python3
"""Make a view the phone never took, by sliding the real camera sideways and reprojecting its depth.

No model fills the holes. A pixel is written only when the phone's own depth lands there.
The empty pixels stay empty, so a later train can ignore them.

  python3 pipeline/novel_shift.py SESSION FRAME OUT.png --shift 0.35
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("session", type=Path)
    ap.add_argument("frame", type=int, help="index in poses.jsonl")
    ap.add_argument("out", type=Path)
    ap.add_argument("--shift", type=float, default=0.35, help="metres to the camera's right")
    a = ap.parse_args()
    rows = [json.loads(line) for line in (a.session / "poses.jsonl").read_text().splitlines() if line.strip()]
    row = rows[a.frame]
    depth = np.asarray(Image.open(a.session / row["depth"])).astype(np.float32) / 1000.0
    rgb = np.asarray(Image.open(a.session / row["rgb"]))
    h, w = depth.shape
    k = row["depth_intrinsics"]
    pose = np.asarray(row["pose"], dtype=np.float64).reshape(4, 4)
    # Slide along the camera's right, which is the first column of the pose.
    novel = pose.copy()
    novel[:3, 3] += a.shift * pose[:3, 0]
    world_to_novel = np.linalg.inv(novel)
    ys, xs = np.mgrid[0:h, 0:w]
    z = depth
    ok = (z > 0.25) & (z < 4.0)
    u = xs[ok] + 0.5
    v = ys[ok] + 0.5
    cam = np.stack([(u - k["cx"]) * z[ok] / k["fx"], -(v - k["cy"]) * z[ok] / k["fy"], -z[ok]], 1)
    world = cam @ pose[:3, :3].T + pose[:3, 3]
    cam2 = world @ world_to_novel[:3, :3].T + world_to_novel[:3, 3]
    z2 = -cam2[:, 2]
    keep = z2 > 0.2
    # The colour photo is 3.75 times the depth grid and shares the pinhole.
    sx, sy = rgb.shape[1] / w, rgb.shape[0] / h
    xi = np.clip(np.rint(xs[ok][keep] * sx).astype(int), 0, rgb.shape[1] - 1)
    yi = np.clip(np.rint(ys[ok][keep] * sy).astype(int), 0, rgb.shape[0] - 1)
    colour = rgb[yi, xi]
    uu = k["fx"] * cam2[keep, 0] / z2[keep] + k["cx"]
    vv = k["cy"] - k["fy"] * cam2[keep, 1] / z2[keep]
    ui = np.rint(uu).astype(int)
    vi = np.rint(vv).astype(int)
    inside = (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)
    ui, vi, z2, colour = ui[inside], vi[inside], z2[keep][inside], colour[inside]
    order = np.argsort(z2)[::-1]  # far first, so nearer pixels win
    canvas = np.zeros((h, w, 3), np.uint8)
    mask = np.zeros((h, w), bool)
    # Each depth sample covers the pixels around it. The depth grid is coarse; a one-pixel
    # splat leaves a black grid even where the scan saw the wall.
    for du in (-1, 0, 1):
        for dv in (-1, 0, 1):
            x = np.clip(ui[order] + du, 0, w - 1)
            y = np.clip(vi[order] + dv, 0, h - 1)
            canvas[y, x] = colour[order]
            mask[y, x] = True
    # Show the result at the photo's size. Empty stays black.
    big = np.array(Image.fromarray(canvas).resize((rgb.shape[1], rgb.shape[0]), Image.Resampling.NEAREST))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(big).save(a.out)
    print(json.dumps({"frame": a.frame, "shift_m": a.shift, "filled": float(mask.mean()), "out": str(a.out)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
