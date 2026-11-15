#!/usr/bin/env python3
"""Top-down colour of a LiDAR walk, for the plan under the path.

An overhead render of the trained splat is fog: the gaussians are thin disks that face the
walking cameras. This script does not render the splat. It puts each depth pixel, with the
colour of the matching photo, into a cell on the floor:

  floor      points within --floor-band of the floor. Their mean colour is the ground.
  standing   points between --stand-low and --stand-high. Where several land in one cell,
             that cell is drawn with their mean colour instead, so a desk or a wall reads
             on top of the floor.

A cell with fewer than --min-points samples stays transparent. Nothing is invented.

The picture uses the same frame as pipeline/plan_top.py: +x to the right, the top row at
max z. The viewer already places a plan-top.png with plan-top.json.

  python3 pipeline/plan_lidar.py SESSION OUT.png --floor-y -1.2364 --bounds -5.2 1.3 -30.6 0.5

Needs numpy and Pillow. CPU only.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def rows_of(session: Path, every: int) -> list:
    rows = [json.loads(line) for line in session.joinpath("poses.jsonl").read_text().splitlines() if line.strip()]
    return rows[::every]


def coloured_points(session: Path, row: dict, near: float, far: float, step: int):
    """World points and RGB for depth pixels that are not on a depth jump."""
    depth = np.asarray(Image.open(session / row["depth"])).astype(np.float32) / 1000.0
    pad = np.pad(depth, 1, mode="edge")
    jump = np.zeros_like(depth)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                jump = np.maximum(jump, np.abs(pad[1 + dy:1 + dy + depth.shape[0], 1 + dx:1 + dx + depth.shape[1]] - depth))
    ok = (depth > near) & (depth < far) & (jump <= np.maximum(0.05, 0.05 * depth))
    vv, uu = np.mgrid[0:depth.shape[0]:step, 0:depth.shape[1]:step]
    ok = ok[vv, uu]
    z = depth[vv, uu][ok]
    if z.size == 0:
        return np.zeros((0, 3)), np.zeros((0, 3), np.float32)
    k = row["depth_intrinsics"]
    u, v = uu[ok] + 0.5, vv[ok] + 0.5
    cam = np.stack([(u - k["cx"]) * z / k["fx"], -(v - k["cy"]) * z / k["fy"], -z], 1)
    pose = np.asarray(row["pose"], dtype=np.float64).reshape(4, 4)
    world = cam @ pose[:3, :3].T + pose[:3, 3]
    rgb = np.asarray(Image.open(session / row["rgb"]))
    # Depth and the photo share one pinhole. 192x256 depth sits on the 720x960 photo.
    sx, sy = rgb.shape[1] / depth.shape[1], rgb.shape[0] / depth.shape[0]
    xi = np.clip(np.rint(uu[ok] * sx).astype(int), 0, rgb.shape[1] - 1)
    yi = np.clip(np.rint(vv[ok] * sy).astype(int), 0, rgb.shape[0] - 1)
    return world, rgb[yi, xi].astype(np.float32)


def mask_to_floor(img: np.ndarray, meta_bounds, px: float, plan_path: Path, radius_m: float) -> np.ndarray:
    """Drop colour that is farther than radius_m from free or walked floor.

    A window or a plant beside the walk can still fall inside the rectangle. The plan only
    claims the floor the scan measured or the phone was carried over, so the picture stays there.
    """
    plan = json.loads(plan_path.read_text())
    cell = float(plan["cell_m"])
    ox, oz = plan["origin_xz"]
    ni, nj = [int(round(m / cell)) for m in plan["room_m"]]
    free = np.ones((ni, nj), bool)
    for obj in plan["objects"]:
        for i, j in obj["cells"]:
            if 0 <= i < ni and 0 <= j < nj:
                free[i, j] = False
    pad = int(np.ceil(radius_m / cell))
    padded = np.pad(free, pad)
    near = np.zeros_like(free)
    for di in range(-pad, pad + 1):
        for dj in range(-pad, pad + 1):
            if di * di + dj * dj > pad * pad:
                continue
            near |= padded[pad + di:pad + di + ni, pad + dj:pad + dj + nj]
    min_x, _, _, max_z = meta_bounds
    height, width = img.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width]
    x = min_x + (xs + 0.5) * px
    z = max_z - (ys + 0.5) * px
    ii = np.floor((x - ox) / cell).astype(int)
    jj = np.floor((z - oz) / cell).astype(int)
    inside = (ii >= 0) & (ii < ni) & (jj >= 0) & (jj < nj)
    keep = np.zeros((height, width), bool)
    keep[inside] = near[ii[inside], jj[inside]]
    img[..., 3] = np.where(keep, img[..., 3], 0)
    return img


def bake(session: Path, rows: list, floor_y: float, bounds, px: float, floor_band: float,
         stand_low: float, stand_high: float, near: float, far: float, step: int, min_points: int):
    min_x, max_x, min_z, max_z = bounds
    width, height = int(round((max_x - min_x) / px)), int(round((max_z - min_z) / px))
    floor_sum = np.zeros((height, width, 3), np.float64)
    floor_n = np.zeros((height, width), np.int32)
    stand_sum = np.zeros_like(floor_sum)
    stand_n = np.zeros_like(floor_n)
    used = 0
    for row in rows:
        world, colour = coloured_points(session, row, near, far, step)
        if len(world) == 0:
            continue
        used += 1
        ix = np.floor((world[:, 0] - min_x) / px).astype(int)
        iy = np.floor((max_z - world[:, 2]) / px).astype(int)
        inside = (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
        h = world[:, 1] - floor_y
        floor = inside & (np.abs(h) <= floor_band)
        stand = inside & (h >= stand_low) & (h <= stand_high)
        np.add.at(floor_sum, (iy[floor], ix[floor]), colour[floor])
        np.add.at(floor_n, (iy[floor], ix[floor]), 1)
        np.add.at(stand_sum, (iy[stand], ix[stand]), colour[stand])
        np.add.at(stand_n, (iy[stand], ix[stand]), 1)
    out = np.zeros((height, width, 4), np.float32)
    show_floor = floor_n >= min_points
    show_stand = stand_n >= min_points
    out[show_floor, :3] = (floor_sum[show_floor] / floor_n[show_floor, None]).astype(np.float32)
    out[show_stand, :3] = (stand_sum[show_stand] / stand_n[show_stand, None]).astype(np.float32)
    out[show_floor | show_stand, 3] = 255
    return out, {"frames_used": used, "frames": len(rows), "floor_cells": int(show_floor.sum()),
                 "standing_cells": int(show_stand.sum()), "width": width, "height": height}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--floor-y", type=float, required=True)
    ap.add_argument("--bounds", type=float, nargs=4, required=True, metavar=("MIN_X", "MAX_X", "MIN_Z", "MAX_Z"))
    ap.add_argument("--every", type=int, default=5)
    ap.add_argument("--px", type=float, default=0.02)
    ap.add_argument("--floor-band", type=float, default=0.08)
    ap.add_argument("--stand-low", type=float, default=0.15)
    ap.add_argument("--stand-high", type=float, default=1.2)
    ap.add_argument("--near", type=float, default=0.25)
    ap.add_argument("--far", type=float, default=4.0)
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--min-points", type=int, default=3)
    ap.add_argument("--plan", type=Path, default=None, help="plan.json; keep colour within --mask-radius of its free floor")
    ap.add_argument("--mask-radius", type=float, default=0.4)
    a = ap.parse_args()
    rows = rows_of(a.session, a.every)
    img, counts = bake(a.session, rows, a.floor_y, a.bounds, a.px, a.floor_band, a.stand_low, a.stand_high,
                       a.near, a.far, a.step, a.min_points)
    if a.plan is not None:
        img = mask_to_floor(img, a.bounds, a.px, a.plan, a.mask_radius)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGBA").save(a.out)
    covered = float((img[..., 3] > 0).mean())
    meta = {
        "min_x": a.bounds[0], "max_x": a.bounds[1], "min_z": a.bounds[2], "max_z": a.bounds[3],
        "note": "Colour from the phone's own depth and photos. The highest band in a cell is drawn: standing surfaces over the floor. An overhead render of the splat is fog.",
        "source": a.session.name,
        "rule": {
            "floor_y": a.floor_y, "floor_band_m": a.floor_band, "stand_low_m": a.stand_low,
            "stand_high_m": a.stand_high, "metres_per_pixel": a.px, "every": a.every, "min_points": a.min_points,
        },
        "covered_fraction": covered, **counts,
    }
    if a.plan is not None:
        meta["mask"] = f"colour kept within {a.mask_radius} m of free or walked floor"
        meta["plan"] = a.plan.name
    a.out.with_suffix(".json").write_text(json.dumps(meta) + "\n")
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
