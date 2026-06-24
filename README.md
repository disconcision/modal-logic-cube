# Modal Logic Cube — interactive 3D Hasse diagram

An interactive 3D Hasse diagram of the 15 normal modal logics from **K** to **S5**,
reproducing `fig1.png`. Start from **K** and toggle the axioms **t, 4, d, b, 5**
on/off to grow the lattice; cover edges are colour-coded by the axiom they add
(the `+5` / euclidean family is green, etc.).

Built with **Three.js** (WebGL) — chosen for genuine 3D + native multitouch
camera control. (The originally-suggested `dragology` is a 2D-SVG React library
with no camera/3D, so it couldn't provide the requested 3-DOF multitouch camera.)

## Run

ES-module imports require the files to be served over HTTP (not opened as
`file://`). From this folder:

```bash
python3 -m http.server 8731
# then open http://localhost:8731/
```

or `npx serve` / any static file server. Everything (Three.js, OrbitControls,
CSS2DRenderer) is vendored under `vendor/`, so it runs fully offline.

## Controls

- **Orbit:** drag (1-finger on touch) — 2 rotational DOF
- **Zoom:** scroll / pinch — 1 DOF (dolly)
- **Pan:** right-drag / two-finger drag
- **Toggle axioms:** checkboxes in the panel (K is always present)
- **Hover** a node to see the modal logic's frame conditions

## Files

| file | purpose |
|------|---------|
| `index.html`    | page shell, panel markup, styles, import map |
| `modal-logic.js`| the lattice: closure of frame conditions, the 15 logics, dynamic Hasse-diagram + edge colouring (no rendering deps) |
| `main.js`       | Three.js scene, nodes/edges/labels, OrbitControls camera, auto-fit, UI wiring |
| `vendor/`       | vendored Three.js r160 + OrbitControls + CSS2DRenderer |

## The logic (how the diagram is computed)

Each logic is identified with the set of **frame properties** its axioms force:

| axiom | schema | frame property |
|-------|--------|----------------|
| `t` | □A → A     | reflexive  |
| `4` | □A → □□A   | transitive |
| `d` | □A → ◇A    | serial     |
| `b` | A → □◇A    | symmetric  |
| `5` | ◇A → □◇A   | euclidean  |

Adding an axiom adds its property, then **closes** under the implications between
frame conditions (e.g. reflexive ⇒ serial; symmetric+transitive ⇒ euclidean;
serial+symmetric+transitive ⇒ reflexive; reflexive+euclidean ⇒ S5). These
collapses are exactly why the 2⁵ = 32 axiom subsets yield only **15** distinct
logics and **26** cover edges.

For any set of enabled axioms the demo recomputes the visible sub-lattice as a
proper Hasse diagram on the fly, so every partial selection is a correct,
connected diagram (e.g. enabling just `t` shows K → T directly, since `t` derives
`d`). `window.modalLogicCube` is exposed for tinkering in the console.
