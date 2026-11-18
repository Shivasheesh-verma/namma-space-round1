// node --test test/oct27.test.js
// The 27 October room files: the floor the scan measured is one piece, and the body can walk it end to end.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("the October start looks down the walk, not at the phone's first yaw", () => {
  assert.ok(Math.abs(spawn.yaw - 0.052) < 1e-6, `yaw is ${spawn.yaw}`);
});

test("the pages use one built bundle, plan and search wait only for the room files, and the files are never cached", () => {
  const text = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  const bundles = ["index.html", "oct27.html"].map((page) => text(page).match(/src="(\.\/assets\/index-[\w-]+\.js)"/)?.[1]);
  assert.ok(bundles[0] && bundles[0] === bundles[1], `bundles: ${bundles}`);
  assert.ok(existsSync(new URL(`../${bundles[0]}`, import.meta.url)));
  for (const page of ["index.html", "oct27.html"]) assert.ok(!text(page).includes("src/mushroom.js"), `${page} still imports the source`);
  assert.ok(text("index.html").includes('href="oct27.html"'), "the classroom page links to the October page");
  assert.ok(text("oct27.html").includes('href="index.html"'), "the October page links back");
  const src = text("src/mushroom.js");
  assert.ok(src.includes('cache: "no-store"'), "room JSON is fetched uncached");
  const boot = src.slice(src.indexOf("async function boot"));
  assert.ok(boot.indexOf("roomReady = true") < boot.indexOf("fetch(splatUrl"), "the room is usable before the splat download starts");
  assert.ok(boot.indexOf("setAnimationLoop(frame)") < boot.indexOf("fetch(splatUrl"), "the plan keeps drawing during the download");
  assert.ok(!/!ready\) return/.test(src), "plan clicks must not wait for the splat");
});

test("the plan is the cells that are not free floor", () => {
  assert.equal(plan.kind, "not_free_floor");
  const cells = plan.room_m[0] * plan.room_m[1] / plan.cell_m ** 2;
  assert.ok(Math.abs(cells - plan.objects[0].cells.length - plan.free_cells) < 1, "blocked and free cells fill the rectangle");
});

test("corridor, opening, and far room are free and reachable", () => {
  const places = read("pois.json").places;
  assert.deepEqual(places.map((p) => p.id), ["corridor", "opening", "far"]);
  for (const place of places) {
    assert.equal(collider.canOccupy(place.x, place.z), true, place.id);
    assert.equal(place.labeled_by, null);
    const points = route(grid, spawn, place);
    assert.ok(points.length >= 2, place.id);
    assert.equal(firstBlockedSegment(collider, points), -1, place.id);
  }
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
