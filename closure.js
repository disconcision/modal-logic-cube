// ===========================================================================
//  closure.js  —  the Boolean lattice B5 of 5 axioms, and how an arbitrary set
//  of Horn rules (conjunction of axioms ⊨ axiom) folds it into the lattice of
//  closed sets.  No rendering dependencies.
//
//  A subset of the 5 axioms is a bitmask 0..31 (bit i ↔ AXES[i]).
//  closure(m) applies the rules to a fixpoint.  Vertices that share a closure
//  are identified; the closed masks (closure(m)===m) are the survivors.
// ===========================================================================

export const AXES = ["t", "4", "d", "b", "5"];
export const N = AXES.length;          // 5
export const NSUB = 1 << N;            // 32

export const AX_COLOR = {
  t: "#ef4444", "4": "#3b82f6", d: "#f59e0b", b: "#a855f7", "5": "#22c55e",
};
export const AX_NAME = {
  t: "reflexive", "4": "transitive", d: "serial", b: "symmetric", "5": "euclidean",
};
export const AX_FORMULA = {
  t: "□A → A", "4": "□A → □□A", d: "□A → ◇A", b: "A → □◇A", "5": "◇A → □◇A",
};

const bit = (ax) => 1 << AXES.indexOf(ax);
export const maskOf = (axList) => axList.reduce((m, a) => m | bit(a), 0);
export const axesOf = (mask) => AXES.filter((_, i) => mask & (1 << i));
export const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

// a rule: { prem: bitmask, concl: single-bit mask, premAx:[...], conclAx:'x' }
export function makeRule(premAx, conclAx) {
  return { prem: maskOf(premAx), concl: bit(conclAx), premAx: [...premAx], conclAx };
}

// closure of a mask under a list of rules (order-independent fixpoint)
export function closure(mask, rules) {
  let m = mask, changed = true;
  while (changed) {
    changed = false;
    for (const r of rules) {
      if ((m & r.prem) === r.prem && !(m & r.concl)) { m |= r.concl; changed = true; }
    }
  }
  return m;
}

// Full analysis for a rule set, restricted to subsets of `activeMask` (the
// axioms "in play"): representative of every vertex, the closed masks, the
// quotient edges, and which of those edges are covers.
export function analyze(rules, activeMask = NSUB - 1) {
  const inU = (m) => (m & ~activeMask) === 0;          // m ⊆ activeMask
  const repr = new Array(NSUB).fill(-1);
  for (let m = 0; m < NSUB; m++) if (inU(m)) repr[m] = closure(m, rules);
  const closed = [];
  for (let m = 0; m < NSUB; m++) if (inU(m) && repr[m] === m) closed.push(m);

  // the edges of the active sub-cube (differ by one active bit), tagged by axis
  const cubeEdges = [];
  for (let m = 0; m < NSUB; m++) {
    if (!inU(m)) continue;
    for (let i = 0; i < N; i++) {
      const b = 1 << i;
      if (m & b || !(activeMask & b)) continue;
      cubeEdges.push({ lo: m, hi: m | b, axis: AXES[i] });
    }
  }

  // quotient: distinct unordered pairs of distinct representatives
  const qkey = (a, b) => (a < b ? a + "," + b : b + "," + a);
  const quo = new Map();
  for (const e of cubeEdges) {
    const a = repr[e.lo], b = repr[e.hi];
    if (a === b) continue;            // edge collapsed inside one class
    const k = qkey(a, b);
    if (!quo.has(k)) quo.set(k, { a: Math.min(a, b), b: Math.max(a, b), axes: new Set() });
    quo.get(k).axes.add(e.axis);
  }

  // covers among closed sets (subset order, nothing strictly between)
  const sub = (x, y) => (x & y) === x;
  const isCover = (a, b) => {
    if (a === b || !sub(a, b)) return false;
    return !closed.some((c) => c !== a && c !== b && sub(a, c) && sub(c, b));
  };
  for (const e of quo.values()) e.cover = isCover(e.a, e.b) || isCover(e.b, e.a);

  return { repr, closed, cubeEdges, quotient: [...quo.values()] };
}

// ---- presets ----------------------------------------------------------------
export const PRESETS = {
  independent: { label: "Independent", rules: [] },
  tImpliesD: { label: "Only  t ⊨ d", rules: [["t", "d"]] },
  symTrans: {
    label: "Sym/Trans/Eucl interlock",
    rules: [["b", "4", "5"], ["b", "5", "4"]],   // any two of {b,4,5} give the third
  },
  modal: {
    label: "Modal logic (K…S5)",
    rules: [
      ["t", "d"],            // reflexive ⇒ serial
      ["b", "4", "5"],       // symmetric + transitive ⇒ euclidean
      ["b", "5", "4"],       // symmetric + euclidean ⇒ transitive
      ["t", "5", "b"],       // reflexive + euclidean ⇒ symmetric …
      ["t", "5", "4"],       //                       … and transitive (⇒ S5)
      ["d", "b", "4", "t"],  // serial + symmetric + transitive ⇒ reflexive
    ],
  },
};
// rule shorthand [a, b, …, concl] -> makeRule([a,b,…], concl)
export function buildRules(short) {
  return short.map((r) => makeRule(r.slice(0, -1), r[r.length - 1]));
}

// canonical modal logic names, keyed by closed axiom-set mask (for labels)
export const MODAL_NAMES = (() => {
  const m = {};
  const put = (ax, name) => (m[maskOf(ax)] = name);
  put([], "K"); put(["d"], "D"); put(["t", "d"], "T");
  put(["4"], "K4"); put(["d", "4"], "D4"); put(["t", "d", "4"], "S4");
  put(["b"], "KB"); put(["d", "b"], "DB"); put(["t", "d", "b"], "TB");
  put(["5"], "K5"); put(["d", "5"], "D5"); put(["4", "5"], "K45");
  put(["d", "4", "5"], "D45"); put(["b", "4", "5"], "KB5");
  put(["t", "d", "b", "4", "5"], "S5");
  return m;
})();
