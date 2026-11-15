#!/usr/bin/env python3
"""Top-down plan picture of the flat surfaces in a trained splat.

An overhead camera render of the whole splat is fog: most gaussians are thin disks that face the walking
cameras, and a camera straight above sees them edge-on. This script does not render the splat from above.
It keeps only the gaussians that are themselves horizontal surfaces and draws each one where it is:

  kept   thin (shortest axis at most --flat of the middle axis), shortest axis within --tilt degrees of
         vertical, opacity at least --min-opacity, centre between --low and --high metres above the floor
  drawn  the gaussian's own footprint on the floor plane (its covariance projected onto x, z), its own
         colour (SH degree 0) and its own opacity, composited from the highest surface down

Nothing is filled in. A pixel with no kept gaussian over it stays transparent, so a hole in the picture is a
place the scan has no horizontal surface.

  python3 pipeline/plan_top.py SCENE.ply OUT.png --floor-y -1.2959 --bounds -7.2 2.0 -4.1 3.6

Writes OUT.png (RGBA, +x to the right and +z up the page, the same frame as the viewer's plan) and OUT.json with the
bounds the viewer needs and the counts. Needs numpy and Pillow.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SH_C0 = 0.28209479177387814


def read_ply(path: Path) -> dict:
    """Binary little-endian vertex PLY with float properties (the 3DGS layout)."""
    with open(path, "rb") as fh:
        names, n = [], None
        while True:
            line = fh.readline().decode("ascii", "replace").strip()
            if line.startswith("format") and "binary_little_endian" not in line:
                raise SystemExit(f"{path}: only binary_little_endian PLY is supported")
            if line.startswith("element vertex"):
                n = int(line.split()[-1])
            elif line.startswith("property"):
                _, kind, name = line.split()
                if kind not in ("float", "float32"):
                    raise SystemExit(f"{path}: property {name} is {kind}, expected float")
                names.append(name)
            elif line == "end_header":
                break
        data = np.fromfile(fh, dtype="<f4", count=n * len(names)).reshape(n, len(names))
    return {k: data[:, i] for i, k in enumerate(names)}


def rotations(q: np.ndarray) -> np.ndarray:
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    w, x, y, z = q.T
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1)], 1)


def select(p: dict, floor_y: float, low: float, high: float, tilt_deg: float, flat: float, min_opacity: float):
    """Horizontal surfaces only. Returns (mask, R, scales, opacity, height)."""
    s = np.exp(np.stack([p["scale_0"], p["scale_1"], p["scale_2"]], 1).astype(np.float64))
    R = rotations(np.stack([p["rot_0"], p["rot_1"], p["rot_2"], p["rot_3"]], 1).astype(np.float64))
    op = 1.0 / (1.0 + np.exp(-p["opacity"].astype(np.float64)))
    order = np.sort(s, 1)
    normal = R[np.arange(len(s)), :, s.argmin(1)]
    h = p["y"].astype(np.float64) - floor_y
    mask = ((order[:, 0] <= flat * order[:, 1]) & (np.abs(normal[:, 1]) >= np.cos(np.radians(tilt_deg)))
            & (op >= min_opacity) & (h >= low) & (h <= high))
    return mask, R, s, op, h


def render(p: dict, mask, R, s, op, h, bounds, px: float):
    """Front-to-back compositing from the highest surface down. Returns float RGBA in [0, 1]."""
    min_x, max_x, min_z, max_z = bounds
    W, H = int(round((max_x - min_x) / px)), int(round((max_z - min_z) / px))
    idx = np.nonzero(mask)[0]
    idx = idx[np.argsort(-h[idx])]
    Rm, sm = R[idx], s[idx]
    cov = np.einsum("nij,nj,nkj->nik", Rm, sm * sm, Rm)[:, [0, 0, 2, 2], [0, 2, 0, 2]].reshape(-1, 2, 2) / (px * px)
    cov[:, 0, 0] += 0.3
    cov[:, 1, 1] += 0.3   # the usual 0.3 px anti-alias term, so a tiny gaussian still lands on a pixel
    inv = np.linalg.inv(cov)
    rad = np.ceil(3 * np.sqrt(np.maximum(cov[:, 0, 0], cov[:, 1, 1]))).astype(int)
    cx = (p["x"][idx] - min_x) / px
    cy = (max_z - p["z"][idx]) / px          # the top row of the picture is max_z, as on the viewer's plan
    col = np.clip(0.5 + SH_C0 * np.stack([p["f_dc_0"][idx], p["f_dc_1"][idx], p["f_dc_2"][idx]], 1), 0, 1)
    rgb = np.zeros((H, W, 3))
    trans = np.ones((H, W))
    for k in range(len(idx)):
        r = rad[k]
        x0, x1 = max(int(cx[k]) - r, 0), min(int(cx[k]) + r + 1, W)
        y0, y1 = max(int(cy[k]) - r, 0), min(int(cy[k]) + r + 1, H)
        if x0 >= x1 or y0 >= y1:
            continue
        dx = np.arange(x0, x1) + 0.5 - cx[k]
        dy = (np.arange(y0, y1) + 0.5 - cy[k])[:, None]
        a, b, c = inv[k, 0, 0], inv[k, 0, 1], inv[k, 1, 1]
        # rows run against z, so the x-z cross term changes sign
        power = -0.5 * (a * dx * dx - 2 * b * dx * dy + c * dy * dy)
        alpha = np.minimum(0.99, op[idx[k]] * np.exp(power))
        t = trans[y0:y1, x0:x1]
        rgb[y0:y1, x0:x1] += (alpha * t)[..., None] * col[k]
        trans[y0:y1, x0:x1] = t * (1 - alpha)
    alpha = 1 - trans
    out = np.zeros((H, W, 4))
    out[..., :3] = rgb / np.maximum(alpha, 1e-6)[..., None]
    out[..., 3] = alpha
    return out, len(idx)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ply", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--floor-y", type=float, required=True)
    ap.add_argument("--bounds", type=float, nargs=4, required=True, metavar=("MIN_X", "MAX_X", "MIN_Z", "MAX_Z"))
    ap.add_argument("--low", type=float, default=-0.15, help="metres above the floor; the default includes the floor itself")
    ap.add_argument("--high", type=float, default=1.3, help="metres above the floor; below shelves, lamps and the ceiling")
    ap.add_argument("--tilt", type=float, default=25.0)
    ap.add_argument("--flat", type=float, default=0.5)
    ap.add_argument("--min-opacity", type=float, default=0.05)
    ap.add_argument("--px", type=float, default=0.01, help="metres per pixel")
    a = ap.parse_args()
    p = read_ply(a.ply)
    mask, R, s, op, h = select(p, a.floor_y, a.low, a.high, a.tilt, a.flat, a.min_opacity)
    img, used = render(p, mask, R, s, op, h, a.bounds, a.px)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(a.out)
    meta = {"min_x": a.bounds[0], "max_x": a.bounds[1], "min_z": a.bounds[2], "max_z": a.bounds[3],
            "note": "Flat surfaces only. An overhead camera render of this splat is fog.",
            "source": a.ply.name, "gaussians_in_splat": int(len(mask)), "gaussians_drawn": int(used),
            "rule": {"floor_y": a.floor_y, "low_m": a.low, "high_m": a.high, "tilt_deg": a.tilt, "flat_ratio": a.flat,
                     "min_opacity": a.min_opacity, "metres_per_pixel": a.px},
            "covered_fraction": float((img[..., 3] > 0.5).mean())}
    a.out.with_suffix(".json").write_text(json.dumps(meta) + "\n")
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
