// A walkable route on the floor. Nodes are places LayoutCollider.canOccupy accepts,
// so the route stays off the walls, the closed door, and the furniture.

function key(x, z) {
  return `${x.toFixed(2)},${z.toFixed(2)}`;
}

export function buildGrid(collider, step = 0.25) {
  const poly = collider.data.polygon;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const nodes = [];
  const index = new Map();
  for (let x = minX + step / 2; x <= maxX; x += step) {
    for (let z = minZ + step / 2; z <= maxZ; z += step) {
      const gx = Math.round(x * 100) / 100;
      const gz = Math.round(z * 100) / 100;
      if (!collider.canOccupy(gx, gz)) continue;
      index.set(key(gx, gz), nodes.length);
      nodes.push({ x: gx, z: gz });
    }
  }
  const neighbours = nodes.map(() => []);
  const offsets = [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [step, -step], [-step, step], [-step, -step]];
  for (let i = 0; i < nodes.length; i++) {
    for (const [dx, dz] of offsets) {
      const nx = Math.round((nodes[i].x + dx) * 100) / 100;
      const nz = Math.round((nodes[i].z + dz) * 100) / 100;
      const j = index.get(key(nx, nz));
      if (j === undefined) continue;
      neighbours[i].push({ j, cost: Math.hypot(dx, dz) });
    }
  }
  return { nodes, neighbours, step };
}

// Places sit in the same grid as the walk, so a click or a search
// finds the nearest tagged place without scanning the whole room.
export function indexPlaces(places, step = 1) {
  const cells = new Map();
  for (const place of places) {
    const k = `${Math.floor(place.x / step)},${Math.floor(place.z / step)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(place);
  }
  return { cells, step, places };
}

export function placesNear(index, x, z, radius) {
  if (!index) return [];
  const span = Math.ceil(radius / index.step);
  const cx = Math.floor(x / index.step);
  const cz = Math.floor(z / index.step);
  const found = [];
  for (let i = cx - span; i <= cx + span; i++) {
    for (let j = cz - span; j <= cz + span; j++) {
      const bucket = index.cells.get(`${i},${j}`);
      if (!bucket) continue;
      for (const place of bucket) {
        const d = Math.hypot(place.x - x, place.z - z);
        if (d <= radius) found.push({ place, d });
      }
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found;
}

export function nearestNode(grid, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const node of grid.nodes) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD) { bestD = d; best = node; }
  }
  return best;
}

export function route(grid, from, to) {
  const start = nearestNode(grid, from.x, from.z);
  const goal = nearestNode(grid, to.x, to.z);
  if (!start || !goal) return [];
  const si = grid.nodes.indexOf(start);
  const gi = grid.nodes.indexOf(goal);
  const open = [si];
  const came = new Map();
  const g = new Map([[si, 0]]);
  const f = new Map([[si, Math.hypot(start.x - goal.x, start.z - goal.z)]]);
  const seen = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
    const current = open.splice(bi, 1)[0];
    if (current === gi) break;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const { j, cost } of grid.neighbours[current]) {
      const next = g.get(current) + cost;
      if (next >= (g.get(j) ?? Infinity)) continue;
      came.set(j, current);
      g.set(j, next);
      const node = grid.nodes[j];
      f.set(j, next + Math.hypot(node.x - goal.x, node.z - goal.z));
      open.push(j);
    }
  }
  if (!came.has(gi) && si !== gi) return [];
  const out = [];
  let c = gi;
  while (c !== undefined) {
    out.push(grid.nodes[c]);
    if (c === si) break;
    c = came.get(c);
  }
  out.reverse();
  return out;
}
