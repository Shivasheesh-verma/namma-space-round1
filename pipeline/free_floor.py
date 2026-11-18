#!/usr/bin/env python3
"""Room files for the viewer from a LiDAR capture: where the floor was measured free.

Reads a converted session (capture.json, poses.jsonl, depth PNGs in millimetres, ARKit camera-to-world poses).
Every depth pixel becomes a point in the room. The floor is cut into square cells and each cell is one of:

  free     the LiDAR saw floor there and saw nothing standing on it
  walked   the phone was carried within --walked-radius of it. A person walked there, so it is free floor
           whatever the LiDAR saw: a doorway it could not measure, or someone walking in front of the phone
  blocked  everything else: walls, furniture, and floor the capture never measured

Only cells joined to the start of the walk are kept. Nothing is guessed: floor that was not measured and
not walked stays blocked, and the picture of the plan shows it as not floor.

Writes into OUT_DIR, in the shapes the viewer already reads:
  collision.json  the rectangle around the kept floor, the floor height, the eye height, the body radius
  plan.json       the blocked cells inside that rectangle (they stop the walk and are outlined on the plan)
  spawn.json      the first camera position, on free floor, and the direction the phone faced
  floor.png       a picture of the cells for checking by eye (white free, green walked, grey blocked, red path)

  python3 pipeline/free_floor.py SESSION OUT_DIR --floor-y -1.2364 [--every 5] [--cell 0.1]

Needs numpy and Pillow. CPU only.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def edge_ok(d: np.ndarray, rel: float = 0.05, abs_m: float = 0.05) -> np.ndarray:
    """False on depth pixels next to a jump: those are mixed pixels that float between two surfaces."""
    pad = np.pad(d, 1, mode="edge")
    jump = np.zeros_like(d)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                jump = np.maximum(jump, np.abs(pad[1 + dy:1 + dy + d.shape[0], 1 + dx:1 + dx + d.shape[1]] - d))
    return jump <= np.maximum(abs_m, rel * d)


def world_points(session: Path, row: dict, near: float, far: float, step: int) -> np.ndarray:
    d = np.asarray(Image.open(session / row["depth"])).astype(np.float32) / 1000.0
    ok = (d > near) & (d < far) & edge_ok(d)
    vv, uu = np.mgrid[0:d.shape[0]:step, 0:d.shape[1]:step]
    ok = ok[vv, uu]
    z = d[vv, uu][ok]
    k = row["depth_intrinsics"]
    u, v = uu[ok] + 0.5, vv[ok] + 0.5
    cam = np.stack([(u - k["cx"]) * z / k["fx"], -(v - k["cy"]) * z / k["fy"], -z], 1)   # ARKit camera: +y up, looks down -z
    M = np.asarray(row["pose"], dtype=np.float64).reshape(4, 4)
    return cam @ M[:3, :3].T + M[:3, 3]


def classify(session: Path, rows: list, floor_y: float, cell: float, band: float, low: float, high: float,
             near: float, far: float, min_floor: int, max_obstacle: int, walked_radius: float):
    cams = np.array([np.asarray(r["pose"]).reshape(4, 4)[:3, 3] for r in rows])
    pts = np.concatenate([world_points(session, r, near, far, 2) for r in rows])
    h = pts[:, 1] - floor_y
    lo = np.floor(np.minimum(pts[:, [0, 2]].min(0), cams[:, [0, 2]].min(0)) / cell) * cell
    hi = np.maximum(pts[:, [0, 2]].max(0), cams[:, [0, 2]].max(0))
    n = np.ceil((hi - lo) / cell).astype(int) + 1
    ij = np.floor((pts[:, [0, 2]] - lo) / cell).astype(int)
    floor = np.zeros(n, np.int32)
    obstacle = np.zeros(n, np.int32)
    f = np.abs(h) <= band
    o = (h >= low) & (h <= high)
    np.add.at(floor, (ij[f, 0], ij[f, 1]), 1)
    np.add.at(obstacle, (ij[o, 0], ij[o, 1]), 1)
    # A handful of standing returns on a cell that is mostly floor is a speck, not a wall.
    # Six points on 177 of floor were stopping the walk in the middle of the corridor.
    speck = (floor >= 40) & (obstacle <= np.maximum(max_obstacle, (0.08 * floor).astype(np.int32)))
    free = ((floor >= min_floor) & (obstacle <= max_obstacle)) | speck
    gx = lo[0] + (np.arange(n[0]) + 0.5) * cell
    gz = lo[1] + (np.arange(n[1]) + 0.5) * cell
    near_path = np.zeros(n, bool)
    r = int(np.ceil(walked_radius / cell))
    for cx, cz in cams[:, [0, 2]]:
        i, j = int((cx - lo[0]) / cell), int((cz - lo[1]) / cell)
        i0, i1, j0, j1 = max(i - r, 0), min(i + r + 1, n[0]), max(j - r, 0), min(j + r + 1, n[1])
        near_path[i0:i1, j0:j1] |= ((gx[i0:i1, None] - cx) ** 2 + (gz[None, j0:j1] - cz) ** 2) <= walked_radius ** 2
    walked = near_path & ~free
    return free, walked, lo, n, cams, {"points": int(len(pts)), "floor_points": int(f.sum()), "obstacle_points": int(o.sum())}


def joined_to(mask: np.ndarray, start) -> np.ndarray:
    """Cells of mask joined to start through their four sides."""
    out = np.zeros_like(mask)
    if not mask[start]:
        return out
    stack = [start]
    out[start] = True
    while stack:
        i, j = stack.pop()
        for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and mask[a, b] and not out[a, b]:
                out[a, b] = True
                stack.append((a, b))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--floor-y", type=float, required=True, help="height of the floor in the capture frame, metres")
    ap.add_argument("--every", type=int, default=5, help="use every Nth frame")
    ap.add_argument("--cell", type=float, default=0.1)
    ap.add_argument("--band", type=float, default=0.08, help="a point this close to the floor height is floor")
    ap.add_argument("--low", type=float, default=0.15, help="a point between --low and --high above the floor stands on it")
    ap.add_argument("--high", type=float, default=1.9)
    ap.add_argument("--near", type=float, default=0.25)
    ap.add_argument("--far", type=float, default=4.0, help="LiDAR depth past this is not trusted")
    ap.add_argument("--min-floor", type=int, default=6)
    ap.add_argument("--max-obstacle", type=int, default=3)
    ap.add_argument("--walked-radius", type=float, default=0.25)
    ap.add_argument("--radius", type=float, default=0.18, help="body radius the viewer walks with")
    a = ap.parse_args()
    rows = [json.loads(l) for l in (a.session / "poses.jsonl").read_text().splitlines() if l.strip()]
    use = rows[::a.every]
    free, walked, lo, n, cams, counts = classify(a.session, use, a.floor_y, a.cell, a.band, a.low, a.high, a.near, a.far,
                                                 a.min_floor, a.max_obstacle, a.walked_radius)
    ok = free | walked
    all_cams = np.array([np.asarray(r["pose"]).reshape(4, 4)[:3, 3] for r in rows])
    start = None
    for c in all_cams:   # the first camera position that stands on kept floor
        ij = (int((c[0] - lo[0]) / a.cell), int((c[2] - lo[1]) / a.cell))
        if ok[ij]:
            start, start_cam = ij, c
            break
    if start is None:
        raise SystemExit("no camera position stands on measured floor")
    keep = joined_to(ok, start)
    on_floor = np.array([keep[int((c[0] - lo[0]) / a.cell), int((c[2] - lo[1]) / a.cell)] for c in all_cams])
    ii, jj = np.nonzero(keep)
    i0, i1, j0, j1 = ii.min() - 1, ii.max() + 2, jj.min() - 1, jj.max() + 2     # one blocked cell all round
    ox, oz = lo[0] + i0 * a.cell, lo[1] + j0 * a.cell
    x1, z1 = lo[0] + i1 * a.cell, lo[1] + j1 * a.cell
    sub = np.zeros((i1 - i0, j1 - j0), bool)
    si0, sj0 = max(i0, 0), max(j0, 0)
    sub[si0 - i0:si0 - i0 + keep[si0:i1, sj0:j1].shape[0], sj0 - j0:sj0 - j0 + keep[si0:i1, sj0:j1].shape[1]] = keep[si0:i1, sj0:j1]
    blocked = [[int(i), int(j)] for i, j in zip(*np.nonzero(~sub))]
    eye = float(np.median(all_cams[:, 1]) - a.floor_y)
    rect = [[ox, oz], [x1, oz], [x1, z1], [ox, z1]]
    a.out.mkdir(parents=True, exist_ok=True)
    src = {"session": a.session.name, "frames_used": len(use), "of": len(rows), **counts}
    rule = {"cell_m": a.cell, "floor_band_m": a.band, "standing_band_m": [a.low, a.high], "depth_m": [a.near, a.far],
            "min_floor_points": a.min_floor, "max_standing_points": a.max_obstacle, "walked_radius_m": a.walked_radius}
    (a.out / "collision.json").write_text(json.dumps({
        "source": "Own LiDAR capture. The rectangle around the floor that was measured free or walked. The cells in plan.json stop the walk.",
        "floor_y": round(a.floor_y, 4), "polygon": [[round(x, 4), round(z, 4)] for x, z in rect],
        "radius": a.radius, "eye_height": round(eye, 3),
        "solid_segments": [[[round(v, 4) for v in rect[k]], [round(v, 4) for v in rect[(k + 1) % 4]]] for k in range(4)],
        "doors": [], "made_from": src, "rule": rule}, indent=1) + "\n")
    (a.out / "plan.json").write_text(json.dumps({
        "cell_m": a.cell, "origin_xz": [round(ox, 4), round(oz, 4)], "room_m": [round(x1 - ox, 2), round(z1 - oz, 2)],
        "kind": "not_free_floor",
        "note": "Cells that are not measured free floor: walls, furniture, and floor the capture never saw. They stop the walk.",
        "free_cells": int(keep.sum()), "free_m2": round(float(keep.sum()) * a.cell ** 2, 2),
        "walked_cells": int((keep & walked).sum()),
        "objects": [{"id": "not_free_floor", "cells": blocked}]}) + "\n")
    M = np.asarray(rows[0]["pose"]).reshape(4, 4)
    fwd = -M[:3, 2]
    yaw = float(np.arctan2(-fwd[0], -fwd[2]))
    # The phone's first frame can face a wall. Keep that yaw only when a metre ahead is still free floor.
    sx, sz = float(start_cam[0]), float(start_cam[2])

    def clear_ahead(y):
        dx, dz = -np.sin(y), -np.cos(y)
        dist = 0.0
        while dist < 6:
            dist += a.cell
            ix = int((sx + dx * dist - lo[0]) / a.cell)
            iz = int((sz + dz * dist - lo[1]) / a.cell)
            if not (0 <= ix < keep.shape[0] and 0 <= iz < keep.shape[1]) or not keep[ix, iz]:
                return dist
        return dist

    if clear_ahead(yaw) < 1.2:
        best = max((clear_ahead(np.deg2rad(d)), np.deg2rad(d)) for d in range(0, 360, 5))
        yaw = best[1]
    (a.out / "spawn.json").write_text(json.dumps({
        "x": round(sx, 3), "z": round(sz, 3), "y": round(a.floor_y + eye, 4),
        "yaw": round(yaw, 3)}) + "\n")
    # picture for checking: +x right, +z up, as on the viewer's plan
    s = 8
    img = np.full((sub.shape[1] * s, sub.shape[0] * s, 3), 120, np.uint8)
    cells = np.zeros(sub.shape + (3,), np.uint8)
    cells[:] = 120
    cells[sub] = 255
    w = np.zeros_like(sub)
    w[si0 - i0:si0 - i0 + keep[si0:i1, sj0:j1].shape[0], sj0 - j0:sj0 - j0 + keep[si0:i1, sj0:j1].shape[1]] = (keep & walked)[si0:i1, sj0:j1]
    cells[w] = (140, 220, 140)
    img = np.repeat(np.repeat(cells.transpose(1, 0, 2)[::-1], s, 0), s, 1).copy()
    for c in all_cams:
        px, py = int((c[0] - ox) / a.cell * s), img.shape[0] - 1 - int((c[2] - oz) / a.cell * s)
        img[max(py - 1, 0):py + 2, max(px - 1, 0):px + 2] = (230, 40, 40)
    Image.fromarray(img).save(a.out / "floor.png")
    rep = {"out": str(a.out), "free_m2": round(float(keep.sum()) * a.cell ** 2, 2), "free_cells": int(keep.sum()),
           "seen_free_cells": int((keep & free).sum()), "walked_cells": int((keep & walked).sum()),
           "free_cells_not_joined_to_start": int((ok & ~keep).sum()),
           "camera_positions_on_kept_floor": f"{int(on_floor.sum())} of {len(on_floor)}",
           "rectangle_m": [round(x1 - ox, 2), round(z1 - oz, 2)], "eye_height_m": round(eye, 3), **src}
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
