// Santa's Block Delivery — leaderboard rules shared by the game client, the Cloudflare Worker,
// the Supabase edge function and the local mock server. Pure ES module, no imports, no secrets.
// Keep STAGES in sync with CONFIG.levels (tools/sync-lb-shared.mjs --check verifies it).
export const RULES_VERSION = 1;

// [houses, base timer (s), route-estimate (s) from __xmas.routeCheck() at normal speed]
export const STAGES = [
  [5, 100, 46.8], [7, 95, 47.1], [8, 120, 67.1], [9, 140, 83.7], [10, 145, 90.7], [10, 155, 99.9], [11, 135, 91.4], [12, 170, 119.8],
  [12, 150, 108.5], [13, 160, 123.9], [13, 135, 108.4], [14, 155, 126.2], [14, 135, 114.1], [15, 120, 109.9], [16, 150, 134.9], [20, 155, 150],
];
export const TARGET_ETH = 3_000_000;
export const ETH_PER_BLOCK = TARGET_ETH / STAGES.reduce((s, x) => s + x[0], 0);
export const TIMER_MULT = { easy: 1.45, normal: 1, hard: 0.78 };
export const TIMER_BONUS = 4; // s per delivered house
const COMBO_STEP = 0.25, COMBO_MAX = 3;
export const NAME_MAX = 16;

/** most ETH a stage can pay: every delivery inside the combo window */
export function maxStageEth(i) {
  let s = 0; for (let k = 1; k <= STAGES[i][0]; k++) s += Math.min(COMBO_MAX, 1 + (k - 1) * COMBO_STEP);
  return s * ETH_PER_BLOCK;
}
export const minStageEth = (i) => STAGES[i][0] * ETH_PER_BLOCK;
/** fastest plausible clear: power-ups make you ~3x faster for a few seconds, so 30 % of the walking estimate */
export const minStageTime = (i) => Math.max(STAGES[i][0] * 1.2, STAGES[i][2] * 0.3);
export const maxStageTime = (i) => STAGES[i][1] * TIMER_MULT.easy + STAGES[i][0] * TIMER_BONUS + 5;

/** plausibility of one cleared run; returns '' when fine, otherwise the reason */
export function checkRun(r) {
  if (!r || typeof r !== 'object') return 'no run';
  const i = r.stage;
  if (!Number.isInteger(i) || i < 0 || i >= STAGES.length) return 'bad stage';
  const H = STAGES[i][0];
  if (r.delivered !== H || r.total !== H) return 'stage not cleared';
  if (!(r.difficulty in TIMER_MULT)) return 'bad difficulty';
  if (![1, 2, 3].includes(r.stars)) return 'bad stars';
  if (!Number.isInteger(r.combo) || r.combo < 1 || r.combo > H) return 'bad combo';
  if (!Number.isInteger(r.hits) || r.hits < 0 || r.hits > 999) return 'bad hits';
  if (typeof r.time !== 'number' || !isFinite(r.time) || r.time < minStageTime(i) || r.time > maxStageTime(i)) return 'implausible time';
  if (typeof r.eth !== 'number' || !isFinite(r.eth) || r.eth < minStageEth(i) * 0.999 || r.eth > maxStageEth(i) * 1.001) return 'implausible eth';
  // a combo of c means at most c deliveries stacked: ETH can't beat the best case for that combo
  let best = 0, k = 0; for (let d = 0; d < H; d++) { k = k >= r.combo ? 1 : k + 1; best += Math.min(COMBO_MAX, 1 + (k - 1) * COMBO_STEP); }
  if (r.combo < H && r.eth > best * ETH_PER_BLOCK * 1.001 + 1) return 'eth above combo';
  if (r.stars === 3 && r.time > STAGES[i][1] * TIMER_MULT.easy * 0.7 + H * TIMER_BONUS) return 'stars vs time';
  return '';
}

// ---- display names: 1-16 chars, letters/digits/space/_-.!', no slurs or swears (en + id), leetspeak folded
const BAD_SUB = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'nigga', 'fagg', 'faggot', 'whore', 'slut', 'rapist', 'pedo', 'porn', 'hitler', 'nazi', 'retard',
  'kontol', 'memek', 'ngentot', 'ngewe', 'bangsat', 'bajingan', 'jancok', 'jancuk', 'pantek', 'pepek', 'goblok', 'tolol', 'anjing', 'lonte', 'perek', 'coli', 'asshole', 'dickhead', 'pussy', 'penis', 'vagina', 'kampret'];
const BAD_WORD = ['ass', 'dick', 'cock', 'cum', 'fag', 'rape', 'sex', 'tit', 'tits', 'babi', 'asu', 'kntl', 'mmk', 'jembut', 'kafir', 'fck', 'fk', 'wtf', 'kkk'];
const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i' };
export function cleanName(raw) {
  let s = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, name: '', why: 'Pick a name' };
  if ([...s].length > NAME_MAX) return { ok: false, name: [...s].slice(0, NAME_MAX).join(''), why: `Max ${NAME_MAX} characters` };
  if (!/^[\p{L}\p{N} _\-.!']+$/u.test(s)) return { ok: false, name: s, why: 'Letters, numbers, space _ - . ! only' };
  const fold = s.toLowerCase().replace(/[0-9@$!|]/g, (c) => LEET[c] || c);
  const flat = fold.replace(/[^\p{L}]/gu, '').replace(/(.)\1+/g, '$1'), flat2 = fold.replace(/[^\p{L}]/gu, '');
  const words = fold.split(/[^\p{L}]+/u).filter(Boolean);
  if (BAD_SUB.some((b) => flat.includes(b.replace(/(.)\1+/g, '$1')) || flat2.includes(b)) || words.some((w) => BAD_WORD.includes(w) || BAD_WORD.includes(w.replace(/(.)\1+/g, '$1'))))
    return { ok: false, name: s, why: 'Please choose a friendlier name' };
  return { ok: true, name: s, why: '' };
}
export const validPid = (p) => typeof p === 'string' && /^p_[0-9a-f]{24}$/.test(p);
