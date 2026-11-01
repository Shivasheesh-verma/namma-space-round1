import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { LayoutCollider } from "./collision.js";

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
let collider, spawn, splat, spark, planData = null;
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

async function get(name) {
  const r = await fetch(`mushroom/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

function look() {
  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

function reset() {
  camera.position.set(spawn.x, collider.floorY + collider.data.eye_height, spawn.z);
  yaw = 0;
  pitch = -0.08;
  look();
}

function drawPlan() {
  const poly = collider.data.polygon;
  const door = collider.data.doors[0];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const pad = 0.7, w = planCanvas.width, h = planCanvas.height;
  const s = Math.min((w - 28) / (maxX - minX + pad * 2), (h - 36) / (maxZ - minZ + pad * 2));
  const X = (x) => 14 + (x - minX + pad) * s;
  const Y = (z) => 10 + (maxZ - z + pad) * s;
  const ctx = planCtx;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f3f0e8";
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  poly.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))));
  ctx.closePath();
  ctx.fillStyle = "#c9c8bc";
  ctx.fill();
  if (planData) {
    const cell = planData.cell_m;
    const [ox, oz] = planData.origin_xz;
    ctx.fillStyle = "#ff4d32";
    for (const o of planData.objects) {
      for (const [i, j] of o.cells) {
        const x = ox + i * cell, z = oz + j * cell;
        ctx.fillRect(X(x), Y(z + cell), cell * s, cell * s);
      }
    }
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#111";
  ctx.stroke();
  if (door) {
    ctx.fillStyle = "#d7ff3f";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(door.center_xz[0]), Y(door.center_xz[1]), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const px = camera.position.x, pz = camera.position.z;
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(X(px), Y(pz), 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(px), Y(pz));
  ctx.lineTo(X(px - Math.sin(yaw) * 0.7), Y(pz - Math.cos(yaw) * 0.7));
  ctx.stroke();
  const bar = 2 * s;
  const bx = 14, by = h - 16;
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + bar, by);
  ctx.stroke();
  ctx.font = "600 11px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("2 m", bx, by - 3);
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
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.2 : 1.35) * dt / Math.hypot(f, s);
      collider.move(
        camera.position,
        (s * Math.cos(yaw) - f * Math.sin(yaw)) * speed,
        (-s * Math.sin(yaw) - f * Math.cos(yaw)) * speed,
      );
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
  if (e.code === "KeyR") reset();
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
};

async function boot() {
  say("Loading the measured room…");
  const data = await get("collision.json");
  spawn = await get("spawn.json");
  collider = new LayoutCollider(data);
  if (!collider.canOccupy(spawn.x, spawn.z)) throw new Error("Spawn is inside a wall");
  try { planData = await get("plan.json"); } catch { planData = null; }
  reset();
  drawPlan();
  spark = new SparkRenderer({ renderer, sortRadial: true });
  scene.add(spark);
  say("Downloading the room…");
  const response = await fetch("https://zitm8zj1k0rea8km.public.blob.vercel-storage.com/scene.ply");
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
  say("Click the picture, then walk with WASD. Walls and the closed door stop you. Furniture does not. Shift is faster. R resets. MuSHRoom classroom, CC BY 4.0.");
  renderer.setAnimationLoop(frame);
}

boot().catch((e) => { say(e.message || String(e)); console.error(e); });
