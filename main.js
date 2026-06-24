import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  AXIOMS, AX_FORMULA, AX_NAME, AX_COLOR,
  allLogics, computeDiagram,
} from "./modal-logic.js";

const PROP_WORD = { s: "serial", r: "reflexive", y: "symmetric", x: "transitive", e: "euclidean" };

// ---------------------------------------------------------------------------
//  Control panel
// ---------------------------------------------------------------------------
document.getElementById("k-formula").textContent = AX_FORMULA.k;

const enabled = new Set();              // currently-enabled axioms
const axiomsEl = document.getElementById("axioms");
for (const a of AXIOMS) {
  const row = document.createElement("label");
  row.className = "axiom";
  row.innerHTML = `
    <input type="checkbox" autocomplete="off" data-ax="${a}">
    <span class="sw" style="background:${AX_COLOR[a]}"></span>
    <span class="tag">${a}</span>
    <span class="meta">
      <span class="f">${AX_FORMULA[a]}</span>
      <span class="n">+${a} · ${AX_NAME[a]}</span>
    </span>`;
  row.querySelector("input").addEventListener("change", (e) => {
    if (e.target.checked) enabled.add(a); else enabled.delete(a);
    updateDiagram();
  });
  axiomsEl.appendChild(row);
}
document.getElementById("btn-all").addEventListener("click", () => setAll(true));
document.getElementById("btn-none").addEventListener("click", () => setAll(false));
function setAll(on) {
  enabled.clear();
  if (on) AXIOMS.forEach((a) => enabled.add(a));
  axiomsEl.querySelectorAll("input").forEach((i) => (i.checked = on));
  updateDiagram();
}

// ---------------------------------------------------------------------------
//  Three.js scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("app").appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById("labels") });
labelRenderer.setSize(innerWidth, innerHeight);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(6, 12, 9);
scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
rim.position.set(-8, 4, -10);
scene.add(rim);

// overall layout scale (spreads nodes out for legibility)
const SCALE = 1.32;

// centroid of all logic positions -> orbit target
const centroid = new THREE.Vector3();
const logics = allLogics();
logics.forEach((l) => centroid.add(new THREE.Vector3(...l.coord).multiplyScalar(SCALE)));
centroid.multiplyScalar(1 / logics.length);

// faint ground grid for spatial reference
const grid = new THREE.GridHelper(26, 26, 0x2a3340, 0x202833);
grid.position.set(centroid.x, -3 * SCALE - 0.5, centroid.z);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(centroid);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9;
controls.zoomToCursor = true;
controls.minDistance = 4;
controls.maxDistance = 60;
// native multitouch: one finger orbits, two fingers dolly + pan
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

camera.position.copy(centroid).add(new THREE.Vector3(12.5, 9, 13).multiplyScalar(SCALE));
controls.update();

// ---------------------------------------------------------------------------
//  Nodes (created once, shown/hidden per toggle state)
// ---------------------------------------------------------------------------
const sphereGeo = new THREE.SphereGeometry(0.19, 32, 24);
const nodeMat = new THREE.MeshStandardMaterial({ color: 0xdfe7f2, roughness: 0.45, metalness: 0.12 });
const baseMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4, metalness: 0.15, emissive: 0x4a3500, emissiveIntensity: 0.5 });

const nodes = new Map(); // name -> { group, mesh, label, props }
const pickables = [];
for (const l of logics) {
  const group = new THREE.Group();
  group.position.set(...l.coord).multiplyScalar(SCALE);

  const mesh = new THREE.Mesh(sphereGeo, l.name === "K" ? baseMat : nodeMat);
  mesh.userData.name = l.name;
  group.add(mesh);
  pickables.push(mesh);

  const el = document.createElement("div");
  el.className = "node-label" + (l.name === "K" ? " base" : "");
  el.textContent = l.name;
  const label = new CSS2DObject(el);
  group.add(label);

  group.visible = false;
  label.visible = false;
  scene.add(group);
  nodes.set(l.name, { group, mesh, label, props: l.props });
}

// ---------------------------------------------------------------------------
//  Edges (rebuilt on every toggle change)
// ---------------------------------------------------------------------------
const edgeGroup = new THREE.Group();
scene.add(edgeGroup);
const edgeGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); // unit; scaled per edge
const _up = new THREE.Vector3(0, 1, 0);

function clearEdges() {
  for (const c of edgeGroup.children) c.material.dispose();
  edgeGroup.clear();
}

function addEdge(aName, bName, color) {
  const a = new THREE.Vector3(...nodes.get(aName).group.position.toArray());
  const b = new THREE.Vector3(...nodes.get(bName).group.position.toArray());
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.5, metalness: 0.1,
    emissive: new THREE.Color(color), emissiveIntensity: 0.28,
  });
  const cyl = new THREE.Mesh(edgeGeo, mat);
  cyl.position.copy(mid);
  cyl.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
  cyl.scale.set(0.05, len, 0.05);
  edgeGroup.add(cyl);
}

// ---------------------------------------------------------------------------
//  Diagram update
// ---------------------------------------------------------------------------
function updateDiagram() {
  const d = computeDiagram(enabled);
  const visible = new Set(d.nodes.map((n) => n.name));

  for (const [name, n] of nodes) {
    const on = visible.has(name);
    n.group.visible = on;
    n.label.visible = on;
  }
  clearEdges();
  for (const e of d.edges) addEdge(e.from, e.to, e.color);

  document.getElementById("n-logics").textContent = d.nodes.length;
  document.getElementById("n-edges").textContent = d.edges.length;

  frameVisible();
}

// Smoothly reframe the camera onto the currently-visible nodes, preserving the
// current viewing direction (so toggling feels like the cube growing in place).
let tween = null;
function frameVisible() {
  const box = new THREE.Box3();
  let any = false;
  for (const [, n] of nodes) if (n.group.visible) { box.expandByPoint(n.group.position); any = true; }
  if (!any) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1.3);
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.35 + 1.8;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  tween = {
    fromT: controls.target.clone(), toT: sphere.center.clone(),
    fromP: camera.position.clone(), toP: sphere.center.clone().addScaledVector(dir, dist),
    start: performance.now(), dur: 600,
  };
}

// ---------------------------------------------------------------------------
//  Hover read-out
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const readout = document.getElementById("readout");
const readoutNm = readout.querySelector(".nm");
const readoutPr = readout.querySelector(".pr");
let hovered = null;

renderer.domElement.addEventListener("pointermove", (ev) => {
  if (ev.pointerType === "touch") return;
  pointer.x = (ev.clientX / innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false)
    .filter((h) => h.object.parent.visible);
  const name = hits.length ? hits[0].object.userData.name : null;

  if (name !== hovered) {
    if (hovered) nodes.get(hovered).mesh.scale.setScalar(1);
    hovered = name;
    if (name) {
      const n = nodes.get(name);
      n.mesh.scale.setScalar(1.45);
      const props = [...n.props].map((p) => PROP_WORD[p]);
      readoutNm.textContent = name;
      readoutPr.textContent = props.length ? props.join(" · ") : "no frame conditions";
      readout.classList.add("on");
      renderer.domElement.style.cursor = "pointer";
    } else {
      readout.classList.remove("on");
      renderer.domElement.style.cursor = "";
    }
  }
});

// ---------------------------------------------------------------------------
//  Resize + render loop
// ---------------------------------------------------------------------------
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

function tick() {
  requestAnimationFrame(tick);
  if (tween) {
    const k = Math.min(1, (performance.now() - tween.start) / tween.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (k >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// deterministic start: base K only. Re-asserted on pageshow so that browser
// form/bfcache restoration (which can re-check boxes after load) can't leak
// state into a fresh visit.
function resetToK() {
  enabled.clear();
  axiomsEl.querySelectorAll("input").forEach((i) => (i.checked = false));
  updateDiagram();
}
resetToK();
addEventListener("pageshow", resetToK);
tick();

// expose internals for console tinkering / scripted control
window.modalLogicCube = { scene, camera, controls, renderer, nodes, enabled, updateDiagram, resetToK };
