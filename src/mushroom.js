import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { LayoutCollider } from "./collision.js";
import { buildGrid, indexPlaces, placesNear, route, routeLength, samplePath } from "./path.js";

const status = document.querySelector("#status");
const metrics = document.querySelector("#metrics");
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.querySelector("#stage").appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#111418");
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 40);
camera.rotation.order = "YXZ";

const keys = new Set();
let yaw = 0, pitch = 0, locked = false, ready = false;
let collider, spawn, splat, spark, planData = null, places = [], grid = null;
let path = [], pathName = "", follow = null, pathMarks = null, planFrame = null, placeIndex = null;
let topMap = null, topMeta = null, furnitureEdges = null, planStatic = null;
const queryEl = document.querySelector("#q");
const hitsEl = document.querySelector("#hits");
const distanceEl = document.querySelector("#distance");
const planCanvas = document.querySelector("#plan");
const planCtx = planCanvas.getContext("2d");
const clock = new THREE.Clock();
let frames = 0, fpsStamp = performance.now(), fps = 0;

function say(text) {
  status.textContent = text;
  if (metrics) metrics.textContent = text;
  status.style.display = text.startsWith("Click the picture") ? "none" : "block";
}

// The room files and the splat. A page can name another room folder and splat file on <body>;
// without that it is the classroom.
const roomDir = document.body.dataset.room || "mushroom";
const splatUrl = document.body.dataset.splat || "https://zitm8zj1k0rea8km.public.blob.vercel-storage.com/scene.ply";
const readyText = document.body.dataset.ready
  || "Search a place, then follow the path. Desks, walls, and the closed door stop you. WASD walks. Shift is faster. R resets.";

async function get(name) {
  const r = await fetch(`${roomDir}/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

function look() {
  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

function reset() {
  camera.position.set(spawn.x, collider.floorY + collider.data.eye_height, spawn.z);
  yaw = spawn.yaw || 0;
  pitch = -0.08;
  look();
}

// The sides of furniture cells that have no furniture next to them: the outline of each piece.
function outlineCells(plan) {
  const cell = plan.cell_m;
  const [ox, oz] = plan.origin_xz;
  const taken = new Set();
  for (const o of plan.objects) for (const [i, j] of o.cells) taken.add(i * 100000 + j);
  const edges = [];
  for (const o of plan.objects) {
    for (const [i, j] of o.cells) {
      const x = ox + i * cell, z = oz + j * cell;
      if (!taken.has((i - 1) * 100000 + j)) edges.push([x, z, x, z + cell]);
      if (!taken.has((i + 1) * 100000 + j)) edges.push([x + cell, z, x + cell, z + cell]);
      if (!taken.has(i * 100000 + j - 1)) edges.push([x, z, x + cell, z]);
      if (!taken.has(i * 100000 + j + 1)) edges.push([x, z + cell, x + cell, z + cell]);
    }
  }
  return edges;
}

// Where a point of the room lands on the plan canvas. A room much longer in z than in x is laid on
// its side so it fills the panel: x runs down the page and z runs to the right.
function planView() {
  const poly = collider.data.polygon;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const pad = 0.7, w = planCanvas.width, h = planCanvas.height;
  const spanX = maxX - minX + pad * 2, spanZ = maxZ - minZ + pad * 2;
  const turned = w > h && spanZ > spanX * 1.5;
  const s = turned ? Math.min((w - 28) / spanZ, (h - 36) / spanX) : Math.min((w - 28) / spanX, (h - 36) / spanZ);
  const point = turned
    ? (x, z) => [14 + (z - minZ + pad) * s, 10 + (x - minX + pad) * s]
    : (x, z) => [14 + (x - minX + pad) * s, 10 + (maxZ - z + pad) * s];
  const room = turned
    ? (u, v) => [(v - 10) / s - pad + minX, (u - 14) / s - pad + minZ]
    : (u, v) => [(u - 14) / s - pad + minX, maxZ + pad - (v - 10) / s];
  // The same mapping as a canvas matrix, for drawing the top-down picture in room coordinates.
  const matrix = turned
    ? [0, s, s, 0, 14 + (pad - minZ) * s, 10 + (pad - minX) * s]
    : [s, 0, 0, -s, 14 + (pad - minX) * s, 10 + (maxZ + pad) * s];
  return { s, point, room, matrix, turned, w, h };
}

// Everything on the plan that does not move: the floor, the top-down picture of the scan, the
// furniture outline, the walls, the door, and the scale bar. Drawn once and kept.
function drawStaticPlan(view) {
  const layer = document.createElement("canvas");
  layer.width = view.w;
  layer.height = view.h;
  const ctx = layer.getContext("2d");
  const { s, point } = view;
  const poly = collider.data.polygon;
  const outline = () => {
    ctx.beginPath();
    poly.forEach(([x, z], i) => { const [u, v] = point(x, z); if (i) ctx.lineTo(u, v); else ctx.moveTo(u, v); });
    ctx.closePath();
  };
  ctx.fillStyle = "#f3f0e8";
  ctx.fillRect(0, 0, view.w, view.h);
  outline();
  ctx.fillStyle = "#c9c8bc";
  ctx.fill();
  const notFloor = planData && planData.kind === "not_free_floor";
  if (notFloor) {
    // In this kind of plan the cells are everything that is not measured free floor. Paint them as
    // paper, so only the floor that was measured or walked reads as floor.
    const cell = planData.cell_m;
    const [ox, oz] = planData.origin_xz;
    ctx.fillStyle = "#f3f0e8";
    for (const o of planData.objects) {
      for (const [i, j] of o.cells) {
        const [u0, v0] = point(ox + i * cell, oz + j * cell);
        const [u1, v1] = point(ox + (i + 1) * cell, oz + (j + 1) * cell);
        ctx.fillRect(Math.min(u0, u1) - 0.5, Math.min(v0, v1) - 0.5, Math.abs(u1 - u0) + 1, Math.abs(v1 - v0) + 1);
      }
    }
  }
  if (topMap && topMap.complete && topMap.naturalWidth && topMeta) {
    // The flat surfaces of the scan, seen from above. Only what lies inside the outline is drawn.
    ctx.save();
    outline();
    ctx.clip();
    ctx.setTransform(...view.matrix);
    ctx.transform(1, 0, 0, -1, 0, 0);   // picture rows run against z
    ctx.drawImage(topMap, topMeta.min_x, -topMeta.max_z, topMeta.max_x - topMeta.min_x, topMeta.max_z - topMeta.min_z);
    ctx.restore();
  }
  if (planData) {
    // Furniture from the LiDAR as an outline, so the desk tops under it stay visible.
    if (!furnitureEdges) furnitureEdges = outlineCells(planData);
    ctx.strokeStyle = notFloor ? "#111" : "#ff4d32";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [ax, az, bx, bz] of furnitureEdges) {
      const [u0, v0] = point(ax, az), [u1, v1] = point(bx, bz);
      ctx.moveTo(u0, v0);
      ctx.lineTo(u1, v1);
    }
    ctx.stroke();
  }
  if (!notFloor) {
    outline();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#111";
    ctx.stroke();
  }
  for (const door of collider.data.doors) {
    const [u, v] = point(door.center_xz[0], door.center_xz[1]);
    ctx.fillStyle = "#d7ff3f";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(u, v, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const bx = 14, by = view.h - 16;
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + 2 * s, by);
  ctx.stroke();
  ctx.font = "600 11px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("2 m", bx, by - 3);
  return layer;
}

function drawPlan() {
  if (!planFrame) planFrame = planView();
  if (!planStatic) planStatic = drawStaticPlan(planFrame);
  const { point } = planFrame;
  const ctx = planCtx;
  ctx.drawImage(planStatic, 0, 0);
  const px = camera.position.x, pz = camera.position.z;
  const [u, v] = point(px, pz);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(u, v, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(u, v);
  ctx.lineTo(...point(px - Math.sin(yaw) * 0.7, pz - Math.cos(yaw) * 0.7));
  ctx.stroke();
  if (path.length > 1) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 4;
    ctx.beginPath();
    path.forEach((p, i) => { const [a, b] = point(p.x, p.z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
    ctx.stroke();
    ctx.strokeStyle = "#d7ff3f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.font = "700 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (const place of places) {
    const [a, b] = point(place.x, place.z);
    ctx.fillStyle = place.name === pathName ? "#d7ff3f" : "#111";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(a, b, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.fillText(place.name.split(" ")[0], a + 6, b - 2);
  }
  if (spawn && distanceEl) {
    const d = Math.hypot(px - spawn.x, pz - spawn.z);
    distanceEl.textContent = `${d.toFixed(1)} m`;
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready) {
    let f = 0, s = 0;
    if (keys.has("KeyW")) f += 1;
    if (keys.has("KeyS")) f -= 1;
    if (keys.has("KeyA")) s -= 1;
    if (keys.has("KeyD")) s += 1;
    if (f || s) {
      follow = null;
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.2 : 1.35) * dt / Math.hypot(f, s);
      collider.move(
        camera.position,
        (s * Math.cos(yaw) - f * Math.sin(yaw)) * speed,
        (-s * Math.sin(yaw) - f * Math.cos(yaw)) * speed,
      );
    } else if (follow) {
      const next = follow.points[follow.i];
      const dx = next.x - camera.position.x;
      const dz = next.z - camera.position.z;
      const dist = Math.hypot(dx, dz);
      // Walk onto each corner itself. The segments between corners are the ones checked with
      // the body radius, so the body must not cut them short.
      if (dist < 0.02) {
        follow.i += 1;
        if (follow.i >= follow.points.length) follow = null;
      } else {
        yaw = Math.atan2(-dx, -dz);
        const step = Math.min(1.15 * dt, dist);
        collider.move(camera.position, dx / dist * step, dz / dist * step);
      }
    }
    camera.position.y = collider.floorY + collider.data.eye_height;
    look();
    drawPlan();
  }
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsStamp > 500) {
    fps = frames * 1000 / (now - fpsStamp);
    frames = 0;
    fpsStamp = now;
    if (ready) metrics.textContent = `${fps.toFixed(0)} fps`;
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener("keydown", (e) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(e.code)) {
    keys.add(e.code);
    e.preventDefault();
  }
  if (e.code === "KeyR") {
    follow = null; path = []; pathName = "";
    if (pathMarks) scene.remove(pathMarks);
    pathMarks = null;
    reset();
  }
  if (e.code === "Enter" && document.activeElement === queryEl) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
renderer.domElement.addEventListener("click", () => {
  renderer.domElement.focus();
  renderer.domElement.requestPointerLock?.().catch(() => {});
});
window.addEventListener("mousemove", (e) => {
  if (!ready || document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.002;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.002, -1.2, 1.2);
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked) keys.clear();
});

window.nammaMushroom = {
  get ready() { return ready; },
  get fps() { return fps; },
  collider: () => collider,
  position: () => camera.position.toArray(),
  walk(dx, dz) { return collider.move(camera.position, dx, dz); },
  go(id) { const place = places.find((item) => item.id === id); if (place) choose(place); return path; },
  goTo(x, z) { choose({ name: "That point", words: [], x, z }); return path; },
};

async function boot() {
  say("Loading the measured room…");
  const data = await get("collision.json");
  spawn = await get("spawn.json");
  collider = new LayoutCollider(data);
  if (!collider.canOccupy(spawn.x, spawn.z)) throw new Error("Spawn is inside a wall");
  try { planData = await get("plan.json"); } catch { planData = null; }
  collider.setFurniture(planData);
  if (!collider.canOccupy(spawn.x, spawn.z)) throw new Error("Spawn is inside a desk or a wall");
  try { places = (await get("pois.json")).places; } catch { places = []; }
  try {
    topMeta = await get("plan-top.json");
    topMap = new Image();
    topMap.onload = () => { planStatic = null; if (collider && spawn) drawPlan(); };
    topMap.src = `${roomDir}/plan-top.png`;
  } catch { topMeta = null; }
  grid = buildGrid(collider);
  placeIndex = indexPlaces(places, 1);
  wireSearch();
  renderHits("");
  planCanvas.addEventListener("click", (event) => {
    if (!planFrame || !grid || !ready) return;
    const rect = planCanvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (planCanvas.width / rect.width);
    const py = (event.clientY - rect.top) * (planCanvas.height / rect.height);
    const [x, z] = planFrame.room(px, py);
    const near = placesNear(placeIndex, x, z, 0.7);
    if (near.length) choose(near[0].place);
    else choose({ name: "That point", words: [], x, z });
  });
  reset();
  drawPlan();
  spark = new SparkRenderer({ renderer, sortRadial: true });
  scene.add(spark);
  say("Downloading the room…");
  const response = await fetch(splatUrl);
  if (!response.ok) throw new Error(`scene.ply: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let got = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    const mb = (got / 1e6).toFixed(0);
    metrics.textContent = total
      ? `Downloading the room, ${mb} of ${(total / 1e6).toFixed(0)} MB`
      : `Downloading the room, ${mb} MB`;
  }
  const fileBytes = new Uint8Array(got);
  let off = 0;
  for (const chunk of chunks) { fileBytes.set(chunk, off); off += chunk.byteLength; }
  say("Drawing the room…");
  splat = new SplatMesh({ fileBytes, fileName: "scene.ply", lod: false, raycastable: false });
  await splat.initialized;
  scene.add(splat);
  ready = true;
  say(readyText);
  renderHits("");
  renderer.setAnimationLoop(frame);
}

function renderHits(text) {
  if (!hitsEl) return;
  const q = text.trim().toLowerCase();
  const matched = places.filter((place) => {
    if (!q) return true;
    return place.name.toLowerCase().includes(q) || place.words.some((word) => word.includes(q) || q.includes(word));
  });
  hitsEl.replaceChildren();
  for (const place of matched) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = place.name;
    button.addEventListener("click", () => choose(place));
    item.appendChild(button);
    hitsEl.appendChild(item);
  }
}

function choose(place) {
  const found = route(grid, camera.position, place);
  path = found;
  pathName = place.name;
  if (!found.length) {
    follow = null;
    if (pathMarks) scene.remove(pathMarks);
    pathMarks = null;
    say(`No walkable path to ${place.name}.`);
    return;
  }
  follow = { points: found, i: 0 };
  showPath();
  drawPlan();
  const metres = routeLength(found);
  say(`Path to ${place.name}, ${metres.toFixed(1)} m. ${document.body.dataset.pathNote || "It goes around the desks."}`);
  if (queryEl) queryEl.value = place.name;
}

function showPath() {
  if (pathMarks) scene.remove(pathMarks);
  pathMarks = new THREE.Group();
  const y = collider.floorY + 0.05;
  const material = new THREE.MeshBasicMaterial({ color: 0xd7ff3f });
  for (const point of samplePath(path, 0.25)) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.14), material);
    mark.position.set(point.x, y, point.z);
    pathMarks.add(mark);
  }
  scene.add(pathMarks);
}

function wireSearch() {
  if (!queryEl) return;
  queryEl.addEventListener("input", () => renderHits(queryEl.value));
  queryEl.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    e.preventDefault();
    const q = queryEl.value.trim().toLowerCase();
    const place = places.find((item) => item.name.toLowerCase() === q)
      || places.find((item) => item.words.some((word) => word === q || word.includes(q)));
    if (place) choose(place);
    else say("No place with that name.");
  });
}

boot().catch((e) => { say(e.message || String(e)); console.error(e); });
