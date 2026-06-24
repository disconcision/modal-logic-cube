import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  AXES, N, NSUB, AX_COLOR, axesOf, popcount,
  makeRule, analyze, PRESETS, MODAL_NAMES,
} from "./closure.js";

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
// rules: [{ prem:Set<axis>, concl:axis|null }]
let rules = [];
let layoutTarget = 0;          // 0 = cube, 1 = diamond
let coversOnly = false;
let showLabels = true;

// derived (recomputed on any rule change)
let repr = new Array(NSUB);
let closedSet = new Set();
let coverPairs = new Set();
let quotientCount = 0, coverCount = 0;

// ---------------------------------------------------------------------------
//  Layout: a position in 3D for every mask, in each of the two layouts
// ---------------------------------------------------------------------------
// 5-cube: three main orthogonal axes + two offset axes -> a penteract
const CUBE_DIR = {
  t: new THREE.Vector3(3.0, 0, 0),
  "4": new THREE.Vector3(0, 3.0, 0),
  d: new THREE.Vector3(0, 0, 3.0),
  b: new THREE.Vector3(1.45, 1.45, 1.15),
  "5": new THREE.Vector3(-1.25, 1.4, 1.7),
};
const CUBE_CENTER = new THREE.Vector3();
AXES.forEach((a) => CUBE_CENTER.add(CUBE_DIR[a]));
CUBE_CENTER.multiplyScalar(0.5);

const cubePosCache = [], diamondPosCache = [];
for (let m = 0; m < NSUB; m++) {
  const p = new THREE.Vector3().sub(CUBE_CENTER);
  AXES.forEach((a, i) => { if (m & (1 << i)) p.add(CUBE_DIR[a]); });
  cubePosCache[m] = p;

  // diamond: height = rank; within a rank, sum of pentagon unit vectors
  const rank = popcount(m);
  const h = new THREE.Vector2();
  AXES.forEach((_, i) => {
    if (m & (1 << i)) {
      const th = (Math.PI * 2 * i) / N + Math.PI / 2;
      h.x += Math.cos(th); h.y += Math.sin(th);
    }
  });
  diamondPosCache[m] = new THREE.Vector3(h.x * 2.5, (rank - 2.5) * 2.5, h.y * 2.5);
}
const _tmp = new THREE.Vector3();
function layoutPos(mask, out) {
  return out.lerpVectors(cubePosCache[mask], diamondPosCache[mask], layoutEased);
}
let layoutEased = 0; // animated toward layoutTarget

// ---------------------------------------------------------------------------
//  Three.js scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("app").appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: document.getElementById("labels") });
labelRenderer.setSize(innerWidth, innerHeight);

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(6, 12, 9); scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.5); rim.position.set(-8, 3, -10); scene.add(rim);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9; controls.zoomToCursor = true;
controls.minDistance = 5; controls.maxDistance = 90;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
camera.position.set(9, 6.5, 15);
controls.update();

// ---------------------------------------------------------------------------
//  Vertices (32) and edges (80) — created once
// ---------------------------------------------------------------------------
const vGeoRep = new THREE.SphereGeometry(0.17, 24, 18);
const vGeoSub = new THREE.SphereGeometry(0.12, 16, 12);
const repMat = new THREE.MeshStandardMaterial({ color: 0xeaf0f8, roughness: 0.4, metalness: 0.1 });
const subMat = new THREE.MeshStandardMaterial({ color: 0x5b6675, roughness: 0.7, metalness: 0.0 });

const verts = [];
for (let m = 0; m < NSUB; m++) {
  const mesh = new THREE.Mesh(vGeoRep, repMat);
  mesh.position.copy(cubePosCache[m]);
  scene.add(mesh);
  const el = document.createElement("div");
  el.className = "node-label";
  const label = new CSS2DObject(el);
  mesh.add(label);
  verts.push({ mask: m, mesh, label, el });
}

const edgeGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const _up = new THREE.Vector3(0, 1, 0);
const edges = [];
for (let m = 0; m < NSUB; m++) {
  for (let i = 0; i < N; i++) {
    const b = 1 << i;
    if (m & b) continue;
    const ax = AXES[i];
    const mat = new THREE.MeshStandardMaterial({
      color: AX_COLOR[ax], roughness: 0.5, metalness: 0.1,
      emissive: new THREE.Color(AX_COLOR[ax]), emissiveIntensity: 0.25,
    });
    const cyl = new THREE.Mesh(edgeGeo, mat);
    scene.add(cyl);
    edges.push({ lo: m, hi: m | b, axis: ax, mesh: cyl });
  }
}

// ---------------------------------------------------------------------------
//  Recompute closure-derived data
// ---------------------------------------------------------------------------
function activeRules() {
  // drop incomplete rules (need a conclusion and >=1 premise)
  return rules
    .filter((r) => r.concl && r.prem.size > 0)
    .map((r) => makeRule([...r.prem], r.concl));
}

function recompute() {
  const a = analyze(activeRules());
  repr = a.repr;
  closedSet = new Set(a.closed);
  coverPairs = new Set();
  let cov = 0;
  for (const e of a.quotient) {
    if (e.cover) { coverPairs.add(e.a + "," + e.b); cov++; }
  }
  quotientCount = a.quotient.length;
  coverCount = cov;

  // labels: only on representatives, and only when not too crowded — so the
  // full cube stays clean and logic names "emerge" as it folds down.
  const labelsOn = showLabels && closedSet.size <= 18;
  for (const v of verts) {
    const isRep = repr[v.mask] === v.mask;
    if (isRep && labelsOn) {
      const name = MODAL_NAMES[v.mask];
      v.el.textContent = name || axesOf(v.mask).join("") || "∅";
      v.el.className = "node-label" + (name ? " named" : "");
      v.label.visible = true;
    } else {
      v.label.visible = false;
    }
  }
  document.getElementById("n-closed").textContent = closedSet.size;
  document.getElementById("n-edges").textContent = coversOnly ? coverCount : quotientCount;
}

// ---------------------------------------------------------------------------
//  Per-frame update of vertex/edge geometry
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _mid = new THREE.Vector3();
function updateScene() {
  // ease layout toward target
  layoutEased += (layoutTarget - layoutEased) * 0.12;

  // move each vertex toward its representative's layout position
  for (const v of verts) {
    layoutPos(repr[v.mask], _tmp);
    v.mesh.position.lerp(_tmp, 0.14);
    const isRep = repr[v.mask] === v.mask;
    // hide a merged sub-vertex once it has arrived inside its representative
    v.mesh.visible = isRep || v.mesh.position.distanceToSquared(_tmp) > 0.02;
    v.mesh.geometry = isRep ? vGeoRep : vGeoSub;
    v.mesh.material = isRep ? repMat : subMat;
  }

  // edges follow their endpoints
  for (const e of edges) {
    const ra = repr[e.lo], rb = repr[e.hi];
    const collapsed = ra === rb;
    let show;
    if (collapsed) {
      show = !coversOnly; // show the shrinking fold (hidden when "covers only")
    } else {
      const k = Math.min(ra, rb) + "," + Math.max(ra, rb);
      show = !coversOnly || coverPairs.has(k);
    }
    if (!show) { e.mesh.visible = false; continue; }

    _a.copy(verts[e.lo].mesh.position);
    _b.copy(verts[e.hi].mesh.position);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 0.04) { e.mesh.visible = false; continue; } // fully collapsed
    e.mesh.visible = true;
    _mid.addVectors(_a, _b).multiplyScalar(0.5);
    e.mesh.position.copy(_mid);
    e.mesh.quaternion.setFromUnitVectors(_up, _d.normalize());
    e.mesh.scale.set(0.045, len, 0.045);
  }
}

// ---------------------------------------------------------------------------
//  Panel: presets
// ---------------------------------------------------------------------------
const presetsEl = document.getElementById("presets");
for (const [pkmkey, p] of Object.entries(PRESETS)) {
  const btn = document.createElement("button");
  btn.textContent = p.label;
  btn.dataset.preset = pkmkey;
  btn.addEventListener("click", () => loadPreset(pkmkey));
  presetsEl.appendChild(btn);
}
function loadPreset(pkey) {
  rules = PRESETS[pkey].rules.map((short) => ({
    prem: new Set(short.slice(0, -1)),
    concl: short[short.length - 1],
  }));
  presetsEl.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.preset === pkey));
  renderRules();
  recompute();
}

// ---------------------------------------------------------------------------
//  Panel: rule editor
// ---------------------------------------------------------------------------
const rulesEl = document.getElementById("rules");
function chip(ax, on, kind) {
  const b = document.createElement("button");
  b.className = "chip" + (on ? " on" : "");
  b.textContent = ax;
  b.style.background = on ? AX_COLOR[ax] : "";
  b.style.borderColor = on ? AX_COLOR[ax] : "";
  b.dataset.ax = ax; b.dataset.kind = kind;
  return b;
}
function markEdited() {
  presetsEl.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
}
function renderRules() {
  rulesEl.innerHTML = "";
  rules.forEach((rule, ri) => {
    const row = document.createElement("div");
    row.className = "rule";
    const prem = document.createElement("div"); prem.className = "prem";
    AXES.forEach((ax) => {
      const c = chip(ax, rule.prem.has(ax), "prem");
      c.addEventListener("click", () => {
        rule.prem.has(ax) ? rule.prem.delete(ax) : rule.prem.add(ax);
        if (rule.concl === ax) rule.concl = null; // conclusion can't be a premise
        markEdited(); renderRules(); recompute();
      });
      prem.appendChild(c);
    });
    const turn = document.createElement("span"); turn.className = "turn"; turn.textContent = "⊨";
    const concl = document.createElement("div"); concl.className = "concl";
    AXES.forEach((ax) => {
      const sel = rule.concl === ax;
      const c = chip(ax, sel, "concl");
      c.addEventListener("click", () => {
        rule.concl = sel ? null : ax;
        if (rule.concl) rule.prem.delete(ax);
        markEdited(); renderRules(); recompute();
      });
      concl.appendChild(c);
    });
    const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "×";
    rm.addEventListener("click", () => { rules.splice(ri, 1); markEdited(); renderRules(); recompute(); });
    row.append(prem, turn, concl, rm);
    rulesEl.appendChild(row);
  });
}
document.getElementById("addrule").addEventListener("click", () => {
  rules.push({ prem: new Set(), concl: null });
  markEdited(); renderRules();
});

// ---------------------------------------------------------------------------
//  Panel: view options
// ---------------------------------------------------------------------------
const layoutSeg = document.getElementById("layout-seg");
layoutSeg.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    layoutTarget = Number(b.dataset.layout);
    layoutSeg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  }));
document.getElementById("covers").addEventListener("change", (e) => { coversOnly = e.target.checked; recompute(); });
document.getElementById("labels-on").addEventListener("change", (e) => { showLabels = e.target.checked; recompute(); });

// ---------------------------------------------------------------------------
//  Resize + loop
// ---------------------------------------------------------------------------
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
function tick() {
  requestAnimationFrame(tick);
  updateScene();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function start() {
  document.getElementById("covers").checked = false; coversOnly = false;
  document.getElementById("labels-on").checked = true; showLabels = true;
  layoutTarget = 0; layoutEased = 0;
  loadPreset("independent");
}
start();
addEventListener("pageshow", start);
tick();

window.foldDemo = { scene, camera, controls, verts, edges, loadPreset, get rules() { return rules; } };
