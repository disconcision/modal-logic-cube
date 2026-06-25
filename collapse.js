import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  AXES, N, NSUB, AX_COLOR, AX_FORMULA, AX_NAME, axesOf, popcount, maskOf, closure,
  makeRule, analyze, PRESETS, MODAL_NAMES,
} from "./closure.js";

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
// the rule library: [{ prem:Set<axis>, concl:axis|null, active:bool }]
// `active` rules are applied; inactive ones are parked in the "Off" bucket.
let rules = [];
let layoutMode = 0;            // 0 = cube, 1 = diamond, 2 = fig-1
let coversOnly = false;
let showLabels = true;
let activeAxes = new Set(AXES); // which axioms are "in play" (dimensions)
let activeMask = NSUB - 1;

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

// "merged axes" layout (recomputed on every rule/dimension change):
//   a sum-of-axis-vectors embedding where axioms that lie on a single-axiom
//   IMPLICATION CHAIN share one direction. Generalises the fig-1 trick: t and d
//   chain (t ⊨ d) so they get one axis; for the modal preset this reproduces
//   page 1 exactly. The chain count = number of independent directions needed.
// Each axiom has a STABLE home direction. A chain adopts the home of its
// lowest-index member; the others overlay onto that same axis. This keeps a
// rule-toggle LOCAL — only the axioms it actually involves move, not a global
// reshuffle. Homes are chosen so the modal preset reproduces fig 1:
// t = vertical, 4 = depth, b = horizontal, 5 = diagonal; d's own home (used
// only when it is NOT merged onto t) is the spare diagonal.
const HOME_DIR = {
  t: new THREE.Vector3(0, 3.2, 0),
  "4": new THREE.Vector3(0, 0, -3.2),
  b: new THREE.Vector3(3.2, 0, 0),
  "5": new THREE.Vector3(1.6, 0, -1.6),
  d: new THREE.Vector3(-1.35, 1.6, 1.7),
};
// FIXED centring point (the centroid of the modal assignment). Subtracting a
// constant — rather than each layout's own centroid — means toggling a rule
// translates nothing: axioms the rule doesn't involve stay exactly put.
const MERGED_CENTER = HOME_DIR.t.clone().add(
  HOME_DIR["4"].clone().add(HOME_DIR.b).add(HOME_DIR["5"]).multiplyScalar(0.5)
);
const mergedPosCache = new Array(NSUB);
let mergedChains = []; // for the read-out / explanation

function recomputeMergedLayout(arules) {
  const active = AXES.filter((a) => activeAxes.has(a));
  const idx = (a) => AXES.indexOf(a);
  const bitOf = (a) => 1 << idx(a);
  const forces = {};
  for (const a of active) forces[a] = closure(bitOf(a), arules); // a forces all bits in here
  const prec = (a, b) => {
    const ab = !!(forces[a] & bitOf(b)), ba = !!(forces[b] & bitOf(a));
    return ab && ba ? idx(a) < idx(b) : ab;     // mutual implication -> order by index
  };
  // minimum chain cover (= Dilworth) via Kuhn's bipartite matching on the
  // comparability DAG: matchR[b] = a means b follows a in a chain.
  const matchR = {};
  const tryK = (a, seen) => {
    for (const b of active) {
      if (a === b || !prec(a, b) || seen.has(b)) continue;
      seen.add(b);
      if (matchR[b] === undefined || tryK(matchR[b], seen)) { matchR[b] = a; return true; }
    }
    return false;
  };
  for (const a of active) tryK(a, new Set());
  const succOf = {}, hasPred = new Set();
  for (const b in matchR) { succOf[matchR[b]] = b; hasPred.add(b); }
  const chains = [];
  for (const a of active) {
    if (hasPred.has(a)) continue;        // chain head = node with no predecessor
    const chain = []; let x = a;
    while (x !== undefined) { chain.push(x); x = succOf[x]; }
    chains.push(chain);
  }
  chains.sort((c1, c2) => Math.min(...c1.map(idx)) - Math.min(...c2.map(idx)));
  mergedChains = chains;
  // a chain takes the stable home direction of its lowest-index member
  const dirOf = {};
  for (const chain of chains) {
    const rep = chain.reduce((m, a) => (idx(a) < idx(m) ? a : m));
    chain.forEach((a) => (dirOf[a] = HOME_DIR[rep]));
  }

  for (let m = 0; m < NSUB; m++) {
    const p = new THREE.Vector3();
    AXES.forEach((a, i) => { if ((m & (1 << i)) && dirOf[a]) p.add(dirOf[a]); });
    mergedPosCache[m] = p.sub(MERGED_CENTER);
  }
}

const LAYOUTS = [cubePosCache, diamondPosCache, mergedPosCache];
const _tmp = new THREE.Vector3();
function layoutPos(mask, out) { return out.copy(LAYOUTS[layoutMode][mask]); }

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
// applied rules: in the Active bucket, complete, and within the active dimensions
function activeRules() {
  return rules
    .filter((r) => r.active && r.concl && r.prem.size > 0)
    .filter((r) => activeAxes.has(r.concl) && [...r.prem].every((a) => activeAxes.has(a)))
    .map((r) => makeRule([...r.prem], r.concl));
}

function recompute() {
  activeMask = maskOf([...activeAxes]);
  const arules = activeRules();
  recomputeMergedLayout(arules);
  const a = analyze(arules, activeMask);
  repr = a.repr;
  closedSet = new Set(a.closed);
  coverPairs = new Set();
  let cov = 0;
  for (const e of a.quotient) {
    if (e.cover) { coverPairs.add(e.a + "," + e.b); cov++; }
  }
  quotientCount = a.quotient.length;
  coverCount = cov;

  // labels: only on (active) representatives, and only when not too crowded — so
  // the full cube stays clean and logic names "emerge" as it folds down.
  const labelsOn = showLabels && closedSet.size <= 18;
  for (const v of verts) {
    const isRep = repr[v.mask] === v.mask; // repr is -1 for inactive masks
    if (isRep && labelsOn) {
      const name = MODAL_NAMES[v.mask];
      v.el.textContent = name || axesOf(v.mask).join("") || "∅";
      v.el.className = "node-label" + (name ? " named" : "");
      v.label.visible = true;
    } else {
      v.label.visible = false;
    }
  }
  const k = activeAxes.size;
  document.getElementById("n-closed").textContent = closedSet.size;
  document.getElementById("n-total").textContent = 1 << k;
  document.getElementById("n-edges").textContent = coversOnly ? coverCount : quotientCount;
  document.getElementById("e-total").textContent = k * (1 << Math.max(0, k - 1));
}

// ---------------------------------------------------------------------------
//  Per-frame update of vertex/edge geometry
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _mid = new THREE.Vector3();
function updateScene() {
  // move each vertex toward its representative's layout position (the per-frame
  // lerp also animates morphs between layouts and folds between rule sets)
  for (const v of verts) {
    if (v.mask & ~activeMask) { v.mesh.visible = false; continue; } // inactive dimension
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
    if ((e.lo | e.hi) & ~activeMask) { e.mesh.visible = false; continue; } // touches inactive axiom
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
//  Rule library: start with the standard modal rules (reload to reset)
// ---------------------------------------------------------------------------
function seedModalRules() {
  rules = PRESETS.modal.rules.map((s) => ({
    prem: new Set(s.slice(0, -1)), concl: s[s.length - 1], active: true,
  }));
}

// ---------------------------------------------------------------------------
//  Panel: rule editor (two buckets — Active / Off)
// ---------------------------------------------------------------------------
const rulesActiveEl = document.getElementById("rules-active");
const rulesOffEl = document.getElementById("rules-off");

function chip(ax, on, kind) {
  const b = document.createElement("button");
  b.className = "chip" + (on ? " on" : "");
  b.textContent = ax;
  b.style.background = on ? AX_COLOR[ax] : "";
  b.style.borderColor = on ? AX_COLOR[ax] : "";
  b.title = `${ax} : ${AX_FORMULA[ax]}  ·  ${AX_NAME[ax]}` +
    (kind === "prem" ? "  (toggle premise)" : "  (toggle conclusion)");
  return b;
}

function ruleRow(rule) {
  const row = document.createElement("div");
  row.className = "rule-row";

  // meta control: move between buckets (outside the rule box, on the left)
  const mv = document.createElement("button"); mv.className = "rrbtn mv";
  mv.textContent = rule.active ? "↓" : "↑";
  mv.title = rule.active ? "Park this rule (move to Off)" : "Apply this rule (move to Active)";
  mv.addEventListener("click", () => { rule.active = !rule.active; renderRules(); recompute(); });

  // the rule itself
  const box = document.createElement("div"); box.className = "rule";
  const prem = document.createElement("div"); prem.className = "prem";
  AXES.forEach((ax) => {
    const c = chip(ax, rule.prem.has(ax), "prem");
    c.addEventListener("click", () => {
      rule.prem.has(ax) ? rule.prem.delete(ax) : rule.prem.add(ax);
      if (rule.concl === ax) rule.concl = null;        // conclusion can't be a premise
      renderRules(); recompute();
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
      renderRules(); recompute();
    });
    concl.appendChild(c);
  });
  box.append(prem, turn, concl);

  // meta control: delete (outside the rule box, on the right)
  const rm = document.createElement("button"); rm.className = "rrbtn rm"; rm.textContent = "×";
  rm.title = "Delete rule";
  rm.addEventListener("click", () => { rules.splice(rules.indexOf(rule), 1); renderRules(); recompute(); });

  row.append(mv, box, rm);
  return row;
}

function renderRules() {
  rulesActiveEl.innerHTML = "";
  rulesOffEl.innerHTML = "";
  const act = rules.filter((r) => r.active);
  const off = rules.filter((r) => !r.active);
  act.forEach((r) => rulesActiveEl.appendChild(ruleRow(r)));
  off.forEach((r) => rulesOffEl.appendChild(ruleRow(r)));
  if (!act.length) rulesActiveEl.innerHTML = '<div class="bucket-empty">no active rules — axioms are independent</div>';
  if (!off.length) rulesOffEl.innerHTML = '<div class="bucket-empty">empty</div>';
  document.getElementById("n-active").textContent = act.length ? `(${act.length})` : "";
}

document.getElementById("addrule").addEventListener("click", () => {
  rules.push({ prem: new Set(), concl: null, active: true });
  renderRules(); recompute();
});

// ---------------------------------------------------------------------------
//  Panel: view options
// ---------------------------------------------------------------------------
const layoutSeg = document.getElementById("layout-seg");
layoutSeg.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    layoutMode = Number(b.dataset.layout);
    layoutSeg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  }));

// dimensions: which axioms are "in play"
const dimsEl = document.getElementById("dims");
function renderDims() {
  dimsEl.innerHTML = "";
  AXES.forEach((ax) => {
    const on = activeAxes.has(ax);
    const c = document.createElement("button");
    c.className = "chip" + (on ? " on" : "");
    c.textContent = ax;
    c.style.background = on ? AX_COLOR[ax] : "";
    c.style.borderColor = on ? AX_COLOR[ax] : "";
    c.title = `${ax} : ${AX_FORMULA[ax]}  ·  ${AX_NAME[ax]}\n${on ? "in play — click to remove this dimension" : "click to add this dimension"}`;
    c.addEventListener("click", () => {
      if (on) { if (activeAxes.size > 1) activeAxes.delete(ax); } // keep >=1
      else activeAxes.add(ax);
      renderDims(); recompute();
    });
    dimsEl.appendChild(c);
  });
}
document.getElementById("covers").addEventListener("change", (e) => { coversOnly = e.target.checked; recompute(); });

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
  // default to the "answer": standard modal rules, merged-axes (fig-1) view, clean covers
  document.getElementById("covers").checked = true; coversOnly = true;
  showLabels = true;
  layoutMode = 2;
  layoutSeg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.layout === "2"));
  activeAxes = new Set(AXES);
  renderDims();
  seedModalRules();
  renderRules();
  recompute();
}
start();
addEventListener("pageshow", start);
tick();

window.foldDemo = {
  scene, camera, controls, verts, edges, seedModalRules, recompute,
  get rules() { return rules; }, get chains() { return mergedChains; },
};
