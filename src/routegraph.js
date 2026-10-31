// Road graph used to prove every stage is beatable: nodes = street points (~3 m apart) + junction links + a hub
// for the town square. Barriers block nodes; lag zones make edges slower. planRoute() walks a greedy
// nearest-house tour from the spawn and returns a conservative time estimate (streets only, no shortcuts).

class Heap { // tiny binary min-heap of [key, id]
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, id) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(id);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = id; }
  pop() { const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
    return top; }
}

export class RouteGraph {
  constructor(roads, squareRadius = 24, { step = 2, link = 4.5 } = {}) {
    const X = [], Z = [], R = [], adj = [];
    const add = (x, z, r) => { X.push(x); Z.push(z); R.push(r); adj.push([]); return X.length - 1; };
    const edge = (a, b) => { if (a === b) return; const d = Math.hypot(X[a] - X[b], Z[a] - Z[b]); adj[a].push(b, d); adj[b].push(a, d); };
    roads.forEach((road, ri) => {
      const ids = []; const pts = road.pts;
      for (let i = 0; i < pts.length; i += step) ids.push(add(pts[i].x, pts[i].z, ri));
      if ((pts.length - 1) % step) ids.push(add(pts[pts.length - 1].x, pts[pts.length - 1].z, ri));
      for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i]);
      if (road.closed) edge(ids[ids.length - 1], ids[0]);
    });
    // junctions: points of different streets closer than `link`
    const cell = link, grid = new Map(), key = (i, j) => i * 100003 + j;
    for (let n = 0; n < X.length; n++) { const k = key(Math.floor(X[n] / cell), Math.floor(Z[n] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(n); }
    for (let n = 0; n < X.length; n++) {
      const ci = Math.floor(X[n] / cell), cj = Math.floor(Z[n] / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const m of grid.get(key(ci + di, cj + dj)) || []) {
        if (m <= n || R[m] === R[n]) continue;
        if (Math.hypot(X[m] - X[n], Z[m] - Z[n]) < link) edge(n, m);
      }
    }
    // the square is open ground: a hub joins every street end that touches it
    const hub = add(0, 0, -1);
    for (let n = 0; n < hub; n++) if (Math.hypot(X[n], Z[n]) < squareRadius + 1.5) edge(n, hub);
    this.X = X; this.Z = Z; this.R = R; this.adj = adj; this.n = X.length;
  }
  nearest(x, z, blocked) {
    let best = -1, bd = Infinity;
    for (let n = 0; n < this.n; n++) { if (blocked?.[n]) continue; const d = (this.X[n] - x) ** 2 + (this.Z[n] - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return { node: best, dist: Math.sqrt(bd) };
  }
  /** nodes within r of (x,z) */
  within(x, z, r) { const out = []; for (let n = 0; n < this.n; n++) if ((this.X[n] - x) ** 2 + (this.Z[n] - z) ** 2 < r * r) out.push(n); return out; }
  /** shortest distances (metres, weighted by nodeCost) from src */
  dijkstra(src, blocked, nodeCost) {
    const dist = new Float64Array(this.n).fill(Infinity), h = new Heap(); dist[src] = 0; h.push(0, src);
    while (h.size) {
      const u = h.pop(), du = dist[u];
      const a = this.adj[u];
      for (let i = 0; i < a.length; i += 2) {
        const v = a[i]; if (blocked?.[v]) continue;
        const w = a[i + 1] * (nodeCost ? (nodeCost[u] + nodeCost[v]) / 2 : 1), nd = du + w;
        if (nd < dist[v]) { dist[v] = nd; h.push(nd, v); }
      }
    }
    return dist;
  }
  blockMask(barriers, r = 5) { const m = new Uint8Array(this.n); for (const b of barriers) for (const n of this.within(b.x, b.z, r)) m[n] = 1; return m; }
  costMask(zones, mult) { const c = new Float32Array(this.n).fill(1); for (const z of zones) for (const n of this.within(z.x, z.z, z.r)) c[n] = mult; return c; }
}

/**
 * spawn {x,z}; targets [{x,z,hold}] (hold = seconds spent at that door); opt {blocked, cost, speed}
 * -> {ok, unreachable:[i], order:[i], dist, splits:[seconds elapsed at each delivery], est}
 */
export function planRoute(g, spawn, targets, { blocked = null, cost = null, speed = 9 } = {}) {
  const s = g.nearest(spawn.x, spawn.z, blocked);
  const tn = targets.map(t => g.nearest(t.x, t.z, blocked));
  const reach = g.dijkstra(s.node, blocked, cost);
  const unreachable = targets.map((t, i) => i).filter(i => !Number.isFinite(reach[tn[i].node]));
  if (unreachable.length) return { ok: false, unreachable, order: [], dist: Infinity, splits: [], est: Infinity };
  const left = new Set(targets.map((t, i) => i)), order = [], splits = [];
  let cur = s.node, curOff = s.dist, dist = 0, time = 0, dd = reach;
  while (left.size) {
    let bi = -1, bd = Infinity;
    for (const i of left) { const d = dd[tn[i].node] + tn[i].dist; if (d < bd) { bd = d; bi = i; } }
    left.delete(bi); order.push(bi);
    dist += bd + curOff; time += (bd + curOff) / speed + (targets[bi].hold || 0); splits.push(time);
    cur = tn[bi].node; curOff = tn[bi].dist; dd = g.dijkstra(cur, blocked, cost);
  }
  return { ok: true, unreachable: [], order, dist, splits, est: time };
}
