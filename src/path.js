// A walkable route on the floor. Every node and every segment is a place the body can be:
// LayoutCollider.canOccupy with the body radius, sampled along the segment. The route costs more
// near walls and furniture, so it keeps to the middle of a corridor, and it is then straightened.

const SAMPLE = 0.025; // metres between body checks along a segment; the same step LayoutCollider.move uses
const WANT = 1.0;     // metres from the body centre to the nearest wall or desk that costs nothing extra
const WEIGHT = 4;     // how much longer a metre right against an obstacle counts than a metre in the open

// 0 in the open, 1 when the body touches an obstacle.
export function nearness(collider, x, z) {
  const free = collider.freeDistance(x, z, WANT);
  const t = (WANT - Math.min(free, WANT)) / (WANT - collider.radius);
  return Math.max(0, Math.min(1, t)) ** 2;
}

// True when the body can slide from a to b in a straight line without touching anything.
export function segmentClear(collider, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / SAMPLE));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!collider.canOccupy(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

// Length of a to b, weighted by how close the body passes to walls and furniture.
export function segmentCost(collider, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d === 0) return 0;
  const n = Math.max(1, Math.ceil(d / 0.1));
  let near = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const w = k === 0 || k === n ? 0.5 : 1;
    near += w * nearness(collider, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
  }
  return d * (1 + WEIGHT * near / n);
}

// Grid nodes are counted in whole cells from one corner, so two neighbours are always exactly
// one cell apart. With furniture on the plan the grid sits on the furniture cells at half their
// size: the middle of a gap between two desks is then always a node, however narrow the gap.
export function buildGrid(collider, step) {
  const poly = collider.data.polygon;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const f = collider.furniture;
  if (!step) step = f ? f.cell / 2 : 0.1;
  if (f) {
    minX = f.ox + Math.floor((minX - f.ox) / step) * step - step / 2;
    minZ = f.oz + Math.floor((minZ - f.oz) / step) * step - step / 2;
  }
  const cols = Math.ceil((maxX - minX) / step);
  const rows = Math.ceil((maxZ - minZ) / step);
  const nodes = [];
  const index = new Map();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = minX + (i + 0.5) * step;
      const z = minZ + (j + 0.5) * step;
      if (!collider.canOccupy(x, z)) continue;
      index.set(i * rows + j, nodes.length);
      nodes.push({ x, z, i, j, near: nearness(collider, x, z) });
    }
  }
  const neighbours = nodes.map(() => []);
  for (let a = 0; a < nodes.length; a++) {
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const i = nodes[a].i + di, j = nodes[a].j + dj;
      if (i >= cols || j < 0 || j >= rows) continue;
      const b = index.get(i * rows + j);
      if (b === undefined) continue;
      // Two free cells can still have a wall end or a desk corner between them.
      if (!segmentClear(collider, nodes[a], nodes[b])) continue;
      const cost = Math.hypot(di, dj) * step * (1 + WEIGHT * (nodes[a].near + nodes[b].near) / 2);
      neighbours[a].push({ j: b, cost });
      neighbours[b].push({ j: a, cost });
    }
  }
  return { nodes, neighbours, step, collider };
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

// The nearest node the body can reach from the point in a straight line. A node that is
// closer but behind a desk or a wall is not chosen. Falls back to the plain nearest node.
function snap(grid, point) {
  const reach = Math.max(0.5, grid.step * 4);
  const near = [];
  for (let i = 0; i < grid.nodes.length; i++) {
    const d = Math.hypot(grid.nodes[i].x - point.x, grid.nodes[i].z - point.z);
    if (d <= reach) near.push({ i, d });
  }
  near.sort((a, b) => a.d - b.d);
  const standable = grid.collider.canOccupy(point.x, point.z);
  if (standable) {
    for (const { i } of near) if (segmentClear(grid.collider, point, grid.nodes[i])) return { i, joined: true };
  }
  const node = nearestNode(grid, point.x, point.z);
  return node ? { i: grid.nodes.indexOf(node), joined: false } : null;
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].f <= heap[i].f) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].f < heap[m].f) m = l;
      if (r < heap.length && heap[r].f < heap[m].f) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

// A* over the grid with the clearance-weighted costs. Returns node indices, or [] when there is no way.
function search(grid, si, gi) {
  const goal = grid.nodes[gi];
  const g = new Map([[si, 0]]);
  const came = new Map();
  const done = new Set();
  const heap = [];
  heapPush(heap, { i: si, f: Math.hypot(grid.nodes[si].x - goal.x, grid.nodes[si].z - goal.z) });
  while (heap.length) {
    const { i } = heapPop(heap);
    if (i === gi) break;
    if (done.has(i)) continue;
    done.add(i);
    for (const { j, cost } of grid.neighbours[i]) {
      const next = g.get(i) + cost;
      if (next >= (g.get(j) ?? Infinity)) continue;
      came.set(j, i);
      g.set(j, next);
      heapPush(heap, { i: j, f: next + Math.hypot(grid.nodes[j].x - goal.x, grid.nodes[j].z - goal.z) });
    }
  }
  if (si !== gi && !came.has(gi)) return [];
  const out = [gi];
  while (out[out.length - 1] !== si) out.push(came.get(out[out.length - 1]));
  return out.reverse();
}

// Replace runs of grid steps with one straight segment. A segment is taken only when the body
// fits along all of it and it does not pass closer to walls and desks than the steps it replaces.
// `reach` is how many points ahead one segment may jump; a long route is straightened in two
// passes, short jumps first and then the few corners that are left, so a click never stalls.
export function straighten(collider, points, reach = Infinity) {
  if (points.length < 3) return points.slice();
  const cost = [0];
  for (let i = 1; i < points.length; i++) cost.push(cost[i - 1] + segmentCost(collider, points[i - 1], points[i]));
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = Math.min(points.length - 1, i + reach);
    for (; j > i + 1; j--) {
      if (!segmentClear(collider, points[i], points[j])) continue;
      if (segmentCost(collider, points[i], points[j]) <= (cost[j] - cost[i]) * 1.02 + 1e-9) break;
    }
    out.push(points[j]);
    i = j;
  }
  return out;
}

// Every segment of a route, checked again with the body radius. Returns the index of the first
// segment the body cannot follow, or -1 when the whole route is clear.
export function firstBlockedSegment(collider, points) {
  for (let i = 1; i < points.length; i++) {
    if (!segmentClear(collider, points[i - 1], points[i])) return i - 1;
  }
  return -1;
}

export function routeLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return sum;
}

// Points every `spacing` metres along the route, corners included. For the marks on the floor.
export function samplePath(points, spacing = 0.25) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  if (points.length) out.push({ x: points[points.length - 1].x, z: points[points.length - 1].z });
  return out;
}

export function route(grid, from, to) {
  const start = snap(grid, from);
  const goal = snap(grid, to);
  if (!start || !goal) return [];
  const steps = search(grid, start.i, goal.i);
  if (!steps.length) return [];
  const points = steps.map((i) => ({ x: grid.nodes[i].x, z: grid.nodes[i].z }));
  if (start.joined) points.unshift({ x: from.x, z: from.z });
  if (goal.joined) points.push({ x: to.x, z: to.z });
  const straight = straighten(grid.collider, straighten(grid.collider, points, 60));
  // The straightened route is used only if the body fits along every segment of it.
  return firstBlockedSegment(grid.collider, straight) === -1 ? straight : points;
}
