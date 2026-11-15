// node --test test/oct27.test.js
// The 27 October room files: the floor the scan measured is one piece, and the body can walk it end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LayoutCollider } from "../src/collision.js";
import { buildGrid, firstBlockedSegment, route, routeLength } from "../src/path.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../oct27/${name}`, import.meta.url)));
const data = read("collision.json");
const plan = read("plan.json");
const spawn = read("spawn.json");
const collider = new LayoutCollider(data);
collider.setFurniture(plan);
const grid = buildGrid(collider);

function follow(points) {
  const p = { x: points[0].x, z: points[0].z };
  let blocked = 0;
  for (const next of points.slice(1)) {
    for (let guard = 0; guard < 100000; guard++) {
      const dx = next.x - p.x, dz = next.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 1e-6) break;
      const step = Math.min(0.02, dist);
      blocked += collider.move(p, dx / dist * step, dz / dist * step);
    }
  }
  return { blocked, end: p };
}

test("the start stands on free floor at eye height above it", () => {
  assert.equal(collider.canOccupy(spawn.x, spawn.z), true);
  assert.ok(Math.abs(spawn.y - (data.floor_y + data.eye_height)) < 1e-3);
  assert.ok(data.eye_height > 1.2 && data.eye_height < 1.8);
});

test("the plan is the cells that are not free floor, and no place is named", () => {
  assert.equal(plan.kind, "not_free_floor");
  const cells = plan.room_m[0] * plan.room_m[1] / plan.cell_m ** 2;
  assert.ok(Math.abs(cells - plan.objects[0].cells.length - plan.free_cells) < 1, "blocked and free cells fill the rectangle");
  assert.deepEqual(read("pois.json").places, []);
});

test("the top-down picture uses the same rectangle as the floor", () => {
  const top = read("plan-top.json");
  const xs = data.polygon.map((p) => p[0]);
  const zs = data.polygon.map((p) => p[1]);
  assert.equal(top.min_x, Math.min(...xs));
  assert.equal(top.max_x, Math.max(...xs));
  assert.equal(top.min_z, Math.min(...zs));
  assert.equal(top.max_z, Math.max(...zs));
  assert.equal(top.source, "session_oct27");
  assert.ok(top.covered_fraction > 0.2);
});

test("the measured floor is one piece", () => {
  const seen = new Array(grid.nodes.length).fill(false);
  let start = 0, best = Infinity;
  grid.nodes.forEach((n, i) => { const d = Math.hypot(n.x - spawn.x, n.z - spawn.z); if (d < best) { best = d; start = i; } });
  const stack = [start];
  seen[start] = true;
  let count = 1;
  while (stack.length) {
    for (const { j } of grid.neighbours[stack.pop()]) if (!seen[j]) { seen[j] = true; count++; stack.push(j); }
  }
  assert.ok(count / grid.nodes.length > 0.99, `${count} of ${grid.nodes.length} grid nodes can be reached from the start`);
});

test("the body walks from the start to the far end of the scan untouched", () => {
  let far = null, farD = 0;
  for (const n of grid.nodes) { const d = Math.hypot(n.x - spawn.x, n.z - spawn.z); if (d > farD) { farD = d; far = n; } }
  assert.ok(farD > 20, "the scan is a long walk");
  const t0 = performance.now();
  const points = route(grid, spawn, far);
  const ms = performance.now() - t0;
  assert.ok(points.length >= 2);
  assert.equal(firstBlockedSegment(collider, points), -1);
  assert.ok(routeLength(points) >= farD);
  const walked = follow(points);
  assert.equal(walked.blocked, 0);
  assert.ok(Math.hypot(walked.end.x - far.x, walked.end.z - far.z) < 0.01);
  assert.ok(ms < 1500, `the longest route took ${ms.toFixed(0)} ms`);
});
