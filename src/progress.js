// Player progress (localStorage): unlocked stages, best result + stars per stage, lifetime stats used by the
// cosmetics unlock rules, and the player's leaderboard identity. Everything is local to this device.
const KEY = 'xmas.progress.v1';
const blank = () => ({
  v: 1, unlocked: 0, best: {}, // best[stageIdx] = { stars, time, eth, delivered, total, hits, combo, date }
  stats: { gifts: 0, clears: 0, runs: 0, fails: 0, jumps: 0, powerups: 0, bestCombo: 0, noHitClears: 0, chimneys: 0, threeStars: 0, speedClears: 0 },
  unlockedItems: [], equipped: {}, seenItems: [],
  player: { id: '', name: '' },
});
let D = null;
function load() {
  if (D) return D;
  try { D = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { D = blank(); }
  D.stats = Object.assign(blank().stats, D.stats || {}); D.player = Object.assign(blank().player, D.player || {});
  if (!D.player.id) { D.player.id = randomId(); save(); }
  return D;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* private mode / quota: progress just won't persist */ } }
function randomId() {
  const a = new Uint8Array(12); (crypto?.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }));
  return 'p_' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

/** stars for a cleared stage: 1 = clear, 2 = >= two2 of the stage clock left, 3 = >= three of it left (ratio of the base timer) */
export function starsFor(L, timeLeft, baseTimer) {
  const r = Math.max(0, timeLeft) / Math.max(1, baseTimer), S = L.stars || { two: 0.15, three: 0.32 };
  return r >= S.three ? 3 : r >= S.two ? 2 : 1;
}
// player title from total stars (score card + stage select)
const TITLES = [[0, 'Genesis Elf'], [6, 'Gossip Courier'], [14, 'Slot Sleigher'], [22, 'Finality Reindeer'], [30, 'Attestation Ace'], [38, 'mump2p Captain'], [44, 'Optimum Santa']];
export function titleFor(stars) { let t = TITLES[0][1]; for (const [n, s] of TITLES) if (stars >= n) t = s; return t; }

export const progress = {
  get data() { return load(); },
  save,
  isUnlocked(i) { return i <= load().unlocked; },
  best(i) { return load().best[i] || null; },
  totalStars() { return Object.values(load().best).reduce((s, b) => s + (b.stars || 0), 0); },
  starsCount(min = 3) { return Object.values(load().best).filter(b => (b.stars || 0) >= min).length; },
  cleared(i) { return !!load().best[i]; },
  clearedCount() { return Object.keys(load().best).length; },
  /** record a run; returns { newBest, prevBest } */
  recordRun(i, r, nStages) {
    const d = load(), S = d.stats; S.runs++;
    S.gifts += r.delivered || 0; S.jumps += r.jumps || 0; S.powerups += r.powerups || 0; S.chimneys += r.chimneys || 0;
    S.bestCombo = Math.max(S.bestCombo, r.combo || 0);
    if (!r.cleared) { S.fails++; save(); return { newBest: false, prevBest: d.best[i] || null }; }
    S.clears++; if (!r.hits) S.noHitClears++; if (r.speedrun) S.speedClears++;
    const prev = d.best[i] || null;
    const better = !prev || r.stars > prev.stars || (r.stars === prev.stars && r.eth > prev.eth) || (r.stars === prev.stars && r.eth === prev.eth && r.time < prev.time);
    if (better) d.best[i] = { stars: r.stars, time: +r.time.toFixed(2), eth: Math.round(r.eth), delivered: r.delivered, total: r.total, hits: r.hits, combo: r.combo, date: new Date().toISOString().slice(0, 10) };
    else if (prev) { prev.time = Math.min(prev.time, +r.time.toFixed(2)); prev.hits = Math.min(prev.hits ?? 99, r.hits); }
    d.unlocked = Math.max(d.unlocked, Math.min(nStages - 1, i + 1));
    S.threeStars = this.starsCount(3);
    save(); return { newBest: better, prevBest: prev };
  },
  stat(k) { return load().stats[k] || 0; },
  bump(k, n = 1) { const d = load(); d.stats[k] = (d.stats[k] || 0) + n; save(); },
  get player() { return load().player; },
  setName(n) { load().player.name = n; save(); },
  reset() { D = blank(); D.player.id = randomId(); save(); },
  unlockAll(n) { const d = load(); d.unlocked = n - 1; save(); }, // QA / debug
};
