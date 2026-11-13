export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function inside(poly, x, z) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (segmentDistance([x, z], a, b) < 1e-6) return true;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

export class LayoutCollider {
  constructor(data) {
    this.data = data;
    this.radius = data.radius;
    this.floorY = data.floor_y;
    this.furniture = null;
  }
  setFurniture(plan) {
    if (!plan) { this.furniture = null; return; }
    const cell = plan.cell_m;
    const [ox, oz] = plan.origin_xz;
    const keys = new Set();
    for (const object of plan.objects) {
      for (const [i, j] of object.cells) keys.add(`${i},${j}`);
    }
    this.furniture = { cell, ox, oz, keys };
  }
  hitsFurniture(x, z) {
    if (!this.furniture) return false;
    const { cell, ox, oz, keys } = this.furniture;
    const i = Math.round((x - ox) / cell - 0.5);
    const j = Math.round((z - oz) / cell - 0.5);
    const reach = this.radius + cell * 0.5;
    const reach2 = reach * reach;
    const span = Math.ceil(reach / cell);
    for (let di = -span; di <= span; di++) {
      for (let dj = -span; dj <= span; dj++) {
        if (!keys.has(`${i + di},${j + dj}`)) continue;
        const cx = ox + (i + di + 0.5) * cell;
        const cz = oz + (j + dj + 0.5) * cell;
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < reach2) return true;
      }
    }
    return false;
  }
  clearance(x, z) {
    return Math.min(...this.data.solid_segments.map(([a, b]) => segmentDistance([x, z], a, b)));
  }
  canOccupy(x, z) {
    return inside(this.data.polygon, x, z)
      && this.clearance(x, z) >= this.radius - 1e-8
      && !this.hitsFurniture(x, z);
  }
  move(p, dx, dz) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.025));
    let blocked = 0;
    for (let k = 0; k < n; k++) {
      const x = p.x + dx / n, z = p.z + dz / n;
      if (this.canOccupy(x, z)) { p.x = x; p.z = z; }
      else {
        blocked++;
        if (this.canOccupy(x, p.z)) p.x = x;
        if (this.canOccupy(p.x, z)) p.z = z;
      }
    }
    return blocked;
  }
}
