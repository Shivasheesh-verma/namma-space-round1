// node --test test/
// The route is checked against the same room files the viewer loads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LayoutCollider } from "../src/collision.js";
import { buildGrid, firstBlockedSegment, nearness, route, routeLength, samplePath, segmentClear, straighten } from "../src/path.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../mushroom/${name}`, import.meta.url)));
const data = read("collision.json");
const plan = read("plan.json");
const spawn = read("spawn.json");
const places = read("pois.json").places;
const collider = new LayoutCollider(data);
collider.setFurniture(plan);
const grid = buildGrid(collider);

// Walk the route the way the viewer does and count the steps a wall or a desk stopped.
function follow(points) {
  const p = { x: points[0].x, z: points[0].z };
  let blocked = 0;
  for (const next of points.slice(1)) {
    for (let guard = 0; guard < 10000; guard++) {
      const dx = next.x - p.x, dz = next.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 1e-6) break;
      const step = Math.min(0.02, dist);
      blocked += collider.move(p, dx / dist * step, dz / dist * step);
    }
  }
  return { blocked, end: p };
}

test("free distance and the body check agree", () => {
  for (const node of grid.nodes) assert.ok(collider.freeDistance(node.x, node.z) >= collider.radius - 1e-8);
  const [ox, oz] = plan.origin_xz;
  const [i, j] = plan.objects[0].cells[0];
  const x = ox + (i + 0.5) * plan.cell_m, z = oz + (j + 0.5) * plan.cell_m;
  assert.ok(collider.freeDistance(x, z) < collider.radius);
  assert.equal(collider.canOccupy(x, z), false);
});

test("every grid edge is one the body can walk", () => {
  for (let i = 0; i < grid.nodes.length; i++) {
    for (const { j } of grid.neighbours[i]) assert.equal(segmentClear(collider, grid.nodes[i], grid.nodes[j]), true);
  }
});

test("there is a route from the start to every place and the body follows it untouched", () => {
  for (const place of places) {
    const points = route(grid, spawn, place);
    assert.ok(points.length >= 2, `no route to ${place.id}`);
    assert.equal(firstBlockedSegment(collider, points), -1, `blocked segment on the way to ${place.id}`);
    const walked = follow(points);
    assert.equal(walked.blocked, 0, `the body was stopped on the way to ${place.id}`);
    const last = points[points.length - 1];
    assert.ok(Math.hypot(walked.end.x - last.x, walked.end.z - last.z) < 0.01);
    assert.ok(Math.hypot(last.x - place.x, last.z - place.z) <= 0.36, `route to ${place.id} ends ${Math.hypot(last.x - place.x, last.z - place.z).toFixed(2)} m away`);
  }
});

test("routes between every pair of places are clear in both directions", () => {
  for (const a of places) {
    for (const b of places) {
      if (a === b) continue;
      const points = route(grid, a, b);
      assert.ok(points.length >= 2, `no route ${a.id} to ${b.id}`);
      assert.equal(firstBlockedSegment(collider, points), -1);
    }
  }
});

test("straightening removes the grid staircase without moving closer to obstacles", () => {
  const far = places.find((p) => p.id === "front");
  const points = route(grid, spawn, far);
  // The grid alone turns every 0.1 m. A straightened route has far fewer corners.
  assert.ok(points.length <= routeLength(points) / grid.step / 4, `${points.length} corners over ${routeLength(points).toFixed(1)} m`);
  const worst = Math.max(...samplePath(points, 0.05).map((p) => nearness(collider, p.x, p.z)));
  assert.ok(worst < 1);
  const again = straighten(collider, points);
  assert.equal(firstBlockedSegment(collider, again), -1);
  assert.ok(again.length <= points.length, "straightening again never adds corners");
});

test("in a corridor the route runs down the middle", () => {
  // A 2 m wide, 12 m long corridor with nothing in it.
  const hall = new LayoutCollider({
    polygon: [[0, 0], [12, 0], [12, 2], [0, 2]],
    solid_segments: [[[0, 0], [12, 0]], [[12, 0], [12, 2]], [[12, 2], [0, 2]], [[0, 2], [0, 0]]],
    radius: 0.18, floor_y: 0, eye_height: 1.6, doors: [],
  });
  const g = buildGrid(hall);
  const points = route(g, { x: 0.5, z: 0.4 }, { x: 11.5, z: 0.4 });
  assert.equal(firstBlockedSegment(hall, points), -1);
  const mid = samplePath(points, 0.1).filter((p) => p.x > 2 && p.x < 10);
  assert.ok(mid.length > 50);
  for (const p of mid) assert.ok(Math.abs(p.z - 1) <= 0.3, `x ${p.x.toFixed(1)} is ${Math.abs(p.z - 1).toFixed(2)} m off the centre line`);
  // The shortest route would hug the z = 0.4 side the whole way.
  assert.ok(routeLength(points) < 12.5);
});

test("a point behind a wall is not joined to the route through the wall", () => {
  const room = new LayoutCollider({
    polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
    solid_segments: [[[0, 0], [4, 0]], [[4, 0], [4, 4]], [[4, 4], [0, 4]], [[0, 4], [0, 0]], [[2, 0], [2, 3]]],
    radius: 0.18, floor_y: 0, eye_height: 1.6, doors: [],
  });
  const g = buildGrid(room);
  const points = route(g, { x: 1.7, z: 1 }, { x: 2.3, z: 1 });
  assert.equal(firstBlockedSegment(room, points), -1);
  assert.ok(routeLength(points) > 4, "the route goes round the end of the wall");
  assert.ok(Math.max(...points.map((p) => p.z)) > 3.1);
});

test("the body, the path, and the plan stand on the same floor", () => {
  assert.equal(collider.floorY, data.floor_y);
  assert.ok(Math.abs(spawn.y - (data.floor_y + data.eye_height)) < 1e-3, "the start height is the floor plus the eye height");
  const points = route(grid, spawn, places[0]);
  // Path points and the plan outline are both in the collider's x, z; none leaves the floor polygon.
  for (const p of samplePath(points, 0.05)) assert.equal(collider.canOccupy(p.x, p.z), true);
});
