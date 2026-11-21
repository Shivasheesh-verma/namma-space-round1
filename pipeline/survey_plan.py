#!/usr/bin/env python3
"""Turn a phone survey into the walk's walls.

Corner marks, in order, are the room polygon. A last corner within 0.15 m of the first is the
return mark and is not an extra wall. Desk marks block a 0.6 m by 0.4 m footprint. Step marks
are recorded and do not block. LiDAR cells that are already blocked stay blocked. Cells inside
the polygon with nothing standing are free.

If any corner lies more than 0.5 m outside the LiDAR plan's rectangle, the tool writes
delta.json and exits 2. It does not average the two.

  python3 pipeline/survey_plan.py survey.json lidar_plan.json out_dir
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

CELL = 0.1
RADIUS = 0.18
EYE = 1.529
CLOSE_M = 0.15
DESK = (0.6, 0.4)
OUTSIDE_M = 0.5


def corners_of(marks: list) -> list:
    corners = [m for m in marks if m["kind"] == "corner"]
    if len(corners) >= 5:
        a, b = corners[0], corners[-1]
        if ((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5 <= CLOSE_M:
            corners = corners[:-1]
    return corners


def inside(poly: list, x: float, z: float) -> bool:
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / (zj - zi + 1e-15) + xi):
            hit = not hit
        j = i
    return hit


def dist_to_rect(rect, x, z) -> float:
    xs = [p[0] for p in rect]
    zs = [p[1] for p in rect]
    dx = 0.0 if min(xs) <= x <= max(xs) else min(abs(x - min(xs)), abs(x - max(xs)))
    dz = 0.0 if min(zs) <= z <= max(zs) else min(abs(z - min(zs)), abs(z - max(zs)))
    if min(xs) <= x <= max(xs) and min(zs) <= z <= max(zs):
        return 0.0
    return (dx * dx + dz * dz) ** 0.5


def main() -> int:
    survey_path, lidar_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    survey = json.loads(survey_path.read_text())
    lidar = json.loads(lidar_path.read_text())
    corners = corners_of(survey["marks"])
    if len(corners) < 3:
        print("need at least 3 corners", file=sys.stderr)
        return 1
    poly = [[c["x"], c["z"]] for c in corners]
    lidar_rect = lidar.get("polygon") or [
        [lidar["origin_xz"][0], lidar["origin_xz"][1]],
        [lidar["origin_xz"][0] + lidar["room_m"][0], lidar["origin_xz"][1] + lidar["room_m"][1]],
    ]
    deltas = []
    for corner in corners:
        gap = dist_to_rect(lidar_rect, corner["x"], corner["z"])
        if gap > OUTSIDE_M:
            deltas.append({"x": corner["x"], "z": corner["z"], "outside_m": round(gap, 3)})
    out_dir.mkdir(parents=True, exist_ok=True)
    if deltas:
        (out_dir / "delta.json").write_text(json.dumps({"corners_outside": deltas}, indent=1) + "\n")
        print(json.dumps({"stopped": True, "corners_outside": len(deltas)}))
        return 2

    floor_y = sum(c["y"] for c in corners) / len(corners)
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    ox, oz = min(xs) - CELL, min(zs) - CELL
    width, depth = max(xs) - ox + CELL, max(zs) - oz + CELL
    ni, nj = int(round(width / CELL)), int(round(depth / CELL))
    blocked = [[False] * nj for _ in range(ni)]
    for i in range(ni):
        for j in range(nj):
            x, z = ox + (i + 0.5) * CELL, oz + (j + 0.5) * CELL
            if not inside(poly, x, z):
                blocked[i][j] = True
    # LiDAR cells that still block, mapped into this grid.
    lox, loz = lidar["origin_xz"]
    lcell = float(lidar["cell_m"])
    for i, j in lidar["objects"][0]["cells"]:
        x, z = lox + (i + 0.5) * lcell, loz + (j + 0.5) * lcell
        ii, jj = int((x - ox) / CELL), int((z - oz) / CELL)
        if 0 <= ii < ni and 0 <= jj < nj and inside(poly, x, z):
            blocked[ii][jj] = True
    for mark in survey["marks"]:
        if mark["kind"] != "desk":
            continue
        for i in range(ni):
            for j in range(nj):
                x, z = ox + (i + 0.5) * CELL, oz + (j + 0.5) * CELL
                if abs(x - mark["x"]) <= DESK[0] / 2 and abs(z - mark["z"]) <= DESK[1] / 2:
                    blocked[i][j] = True
    cells = [[i, j] for i in range(ni) for j in range(nj) if blocked[i][j]]
    free = ni * nj - len(cells)
    plan = {
        "kind": "not_free_floor",
        "cell_m": CELL,
        "origin_xz": [round(ox, 4), round(oz, 4)],
        "room_m": [round(ni * CELL, 4), round(nj * CELL, 4)],
        "free_cells": free,
        "free_m2": round(free * CELL * CELL, 2),
        "objects": [{"name": "blocked", "cells": cells}],
        "note": "Walls are the survey corners. LiDAR cells that still block stay blocked. Desks are 0.6 m by 0.4 m. Steps are recorded and do not block.",
    }
    segments = [[[a[0], a[1]], [b[0], b[1]]] for a, b in zip(poly, poly[1:] + poly[:1])]
    collision = {
        "source": "survey corners plus lidar cells that still block",
        "floor_y": round(floor_y, 4),
        "polygon": poly,
        "radius": RADIUS,
        "eye_height": EYE,
        "solid_segments": segments,
        "steps": [
            {"x": m["x"], "y": m["y"], "z": m["z"], "height_above_floor_m": round(m["y"] - floor_y, 4)}
            for m in survey["marks"] if m["kind"] == "step"
        ],
    }
    (out_dir / "plan.json").write_text(json.dumps(plan) + "\n")
    (out_dir / "collision.json").write_text(json.dumps(collision, indent=1) + "\n")
    print(json.dumps({"corners": len(corners), "free_cells": free, "blocked": len(cells), "floor_y": round(floor_y, 4)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
