// Wardrobe catalog: 40 cosmetic items in 8 slots, unlocked by stars / stage clears / lifetime stats (progress.js).
// All looks are procedural (shader recolours of the mascot + small procedural meshes / particle trails) - no new assets.
// Persistence lives in progress.data: unlockedItems (ids, for "new unlock" toasts), equipped {slot: id}, seenItems.
import { progress } from './progress.js?v=1d9e3a63';

export const SLOTS = [
  { id: 'hat', name: 'Hat', icon: '🎅' }, { id: 'topper', name: 'Topper', icon: '👑' }, { id: 'suit', name: 'Suit', icon: '🧥' },
  { id: 'boots', name: 'Boots', icon: '🥾' }, { id: 'flame', name: 'Flame', icon: '🔥' }, { id: 'goggles', name: 'Goggles', icon: '🥽' },
  { id: 'trail', name: 'Trail', icon: '✨' }, { id: 'back', name: 'Back', icon: '🎒' },
];
const F = { t: 'free' };
// sw = swatch shown in the grid (css colour / gradient); c = recolour hex (sRGB); other keys read by costume.js
export const ITEMS = [
  // hat cloth colour
  { id: 'hat_classic', slot: 'hat', name: 'Classic Red', sw: '#c8202a', req: F },
  { id: 'hat_elf', slot: 'hat', name: 'Elf Green', sw: '#1f8a3a', c: 0x1c8a36, req: { t: 'clears', n: 2 } },
  { id: 'hat_frost', slot: 'hat', name: 'Frost Blue', sw: '#3fa2ff', c: 0x2f8cff, req: { t: 'stars', n: 6 } },
  { id: 'hat_violet', slot: 'hat', name: 'Midnight Violet', sw: '#6a35c2', c: 0x5a2ca8, req: { t: 'stage', n: 8 } },
  { id: 'hat_gold', slot: 'hat', name: 'Golden Velvet', sw: 'linear-gradient(135deg,#ffe38a,#c99418)', c: 0xe0a92a, req: { t: 'stars', n: 36 } },
  // topper (procedural accessory on the head bone)
  { id: 'top_none', slot: 'topper', name: 'None', sw: 'none', req: F },
  { id: 'top_holly', slot: 'topper', name: 'Holly Sprig', sw: 'radial-gradient(circle at 60% 40%,#e2283a 18%,#1d7a35 22%)', acc: 'holly', req: { t: 'chimneys', n: 5 } },
  { id: 'top_antlers', slot: 'topper', name: 'Reindeer Antlers', sw: 'linear-gradient(135deg,#a8743f,#5b3a1c)', acc: 'antlers', req: { t: 'gifts', n: 100 } },
  { id: 'top_crown', slot: 'topper', name: 'Golden Crown', sw: 'linear-gradient(135deg,#ffe58a,#d19a16)', acc: 'crown', req: { t: 'three', n: 5 } },
  { id: 'top_halo', slot: 'topper', name: 'Validator Halo', sw: 'radial-gradient(circle,#0000 40%,#fff3b0 45%,#ffcc4d 60%,#0000 66%)', acc: 'halo', req: { t: 'stage', n: 16 } },
  // suit cloth colour
  { id: 'suit_classic', slot: 'suit', name: 'Classic Red', sw: '#c8202a', req: F },
  { id: 'suit_pine', slot: 'suit', name: 'Pine Green', sw: '#1d7a3c', c: 0x1b7a38, req: { t: 'clears', n: 1 } },
  { id: 'suit_azure', slot: 'suit', name: 'Optimum Azure', sw: '#1f6bff', c: 0x1f5fff, req: { t: 'stars', n: 10 } },
  { id: 'suit_royal', slot: 'suit', name: 'Royal Purple', sw: '#6b2bb8', c: 0x6326b0, req: { t: 'combo', n: 5 } },
  { id: 'suit_snow', slot: 'suit', name: 'Snow White', sw: '#eef2f8', c: 0xe6ebf2, req: { t: 'noHit', n: 3 } },
  { id: 'suit_black', slot: 'suit', name: 'Midnight Black', sw: '#1b1c22', c: 0x24252c, req: { t: 'stage', n: 12 } },
  // boots
  { id: 'boots_classic', slot: 'boots', name: 'Classic Black', sw: '#15161b', req: F },
  { id: 'boots_candy', slot: 'boots', name: 'Candy Red', sw: '#d3202e', c: 0xd01c2a, req: { t: 'jumps', n: 50 } },
  { id: 'boots_frost', slot: 'boots', name: 'Frost Blue', sw: '#58b4ff', c: 0x4aa8ff, req: { t: 'clears', n: 4 } },
  { id: 'boots_mint', slot: 'boots', name: 'Mint', sw: '#4fe0b0', c: 0x3fd6a4, req: { t: 'powerups', n: 10 } },
  { id: 'boots_gold', slot: 'boots', name: 'Gold', sw: 'linear-gradient(135deg,#ffe58a,#c48d12)', c: 0xe7b23a, req: { t: 'three', n: 8 } },
  // flame colour
  { id: 'flame_icy', slot: 'flame', name: 'Icy Blue', sw: 'linear-gradient(0deg,#0b2a9a,#5aa8ff,#e8f6ff)', fl: 'icy', req: F },
  { id: 'flame_ember', slot: 'flame', name: 'Ember Orange', sw: 'linear-gradient(0deg,#9a1800,#ff8a18,#fff0c0)', fl: 'ember', req: { t: 'stars', n: 3 } },
  { id: 'flame_aurora', slot: 'flame', name: 'Aurora Green', sw: 'linear-gradient(0deg,#006b33,#28f08c,#e6fff0)', fl: 'aurora', req: { t: 'stage', n: 5 } },
  { id: 'flame_violet', slot: 'flame', name: 'Violet Plasma', sw: 'linear-gradient(0deg,#4a0590,#b45cff,#f6e8ff)', fl: 'violet', req: { t: 'combo', n: 8 } },
  { id: 'flame_gold', slot: 'flame', name: 'Solar Gold', sw: 'linear-gradient(0deg,#8a4a00,#ffc430,#fff6d8)', fl: 'gold', req: { t: 'gifts', n: 300 } },
  { id: 'flame_prism', slot: 'flame', name: 'Prism', sw: 'linear-gradient(135deg,#ff4d6d,#ffd23f,#3dff9a,#3db8ff,#b05cff)', fl: 'prism', req: { t: 'stars', n: 44 } },
  // goggles (finish of the Optimum-icon goggles; the mark itself is never altered)
  { id: 'gog_obsidian', slot: 'goggles', name: 'Obsidian', sw: '#050507', gg: 'obsidian', req: F },
  { id: 'gog_chrome', slot: 'goggles', name: 'Chrome', sw: 'linear-gradient(135deg,#ffffff,#8d97a3,#e8edf2)', gg: 'chrome', req: { t: 'clears', n: 3 } },
  { id: 'gog_ice', slot: 'goggles', name: 'Ice Glass', sw: 'linear-gradient(135deg,#d8f2ff,#5fb8ff)', gg: 'ice', req: { t: 'noHit', n: 1 } },
  { id: 'gog_neon', slot: 'goggles', name: 'Neon Azure', sw: '#1d4dff', gg: 'neon', req: { t: 'speed', n: 3 } },
  { id: 'gog_gold', slot: 'goggles', name: 'Gold', sw: 'linear-gradient(135deg,#fff0a8,#d39b1a)', gg: 'gold', req: { t: 'stars', n: 20 } },
  // trail
  { id: 'trail_none', slot: 'trail', name: 'None', sw: 'none', req: F },
  { id: 'trail_snow', slot: 'trail', name: 'Snow Sparkle', sw: 'radial-gradient(circle,#fff 10%,#9fd4ff 30%,#18305a 70%)', tr: 'snow', req: { t: 'runs', n: 3 } },
  { id: 'trail_coins', slot: 'trail', name: 'Gold Coins', sw: 'radial-gradient(circle,#fff3a8 15%,#e0a21c 45%,#5a3a00 75%)', tr: 'coins', req: { t: 'gifts', n: 200 } },
  { id: 'trail_aurora', slot: 'trail', name: 'Aurora', sw: 'linear-gradient(135deg,#29ff9a,#2fb8ff,#a45cff)', tr: 'aurora', req: { t: 'stars', n: 30 } },
  // back
  { id: 'back_none', slot: 'back', name: 'None', sw: 'none', req: F },
  { id: 'back_cane', slot: 'back', name: 'Candy Cane', sw: 'repeating-linear-gradient(135deg,#fff 0 6px,#e0202e 6px 12px)', acc: 'cane', req: { t: 'chimneys', n: 1 } },
  { id: 'back_sack', slot: 'back', name: 'Toy Sack', sw: 'radial-gradient(circle at 50% 60%,#a8743f,#5b3a1c)', acc: 'sack', req: { t: 'clears', n: 6 } },
  { id: 'back_node', slot: 'back', name: 'Validator Node', sw: 'linear-gradient(180deg,#1a2238 60%,#3fa9ff 60% 68%,#1a2238 68%)', acc: 'node', req: { t: 'three', n: 12 } },
];
export const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const DEFAULT = Object.fromEntries(SLOTS.map(s => [s.id, ITEMS.find(i => i.slot === s.id && i.req.t === 'free').id]));

const val = (r) => {
  switch (r.t) {
    case 'free': return 1;
    case 'stars': return progress.totalStars();
    case 'clears': return progress.clearedCount();
    case 'stage': return progress.cleared(r.n - 1) ? 1 : 0;
    case 'three': return progress.starsCount(3);
    case 'noHit': return progress.stat('noHitClears');
    case 'speed': return progress.stat('speedClears');
    case 'combo': return progress.stat('bestCombo');
    default: return progress.stat(r.t);
  }
};
const need = (r) => r.t === 'free' || r.t === 'stage' ? 1 : r.n;
const REQ_TXT = {
  stars: n => `Collect ${n}★`, clears: n => `Clear ${n} stage${n > 1 ? 's' : ''}`, stage: n => `Clear stage ${n}`, three: n => `3★ on ${n} stages`,
  noHit: n => n > 1 ? `${n} no-hit clears` : 'A no-hit clear', speed: n => `${n} speed clears`, combo: n => `Reach a x${n} combo`,
  gifts: n => `Deliver ${n} gifts`, jumps: n => `Jump ${n} times`, chimneys: n => n > 1 ? `${n} chimney drops` : 'A chimney drop',
  powerups: n => `Grab ${n} mump2p boosts`, runs: n => `Play ${n} runs`,
};

export const cosmetics = {
  isUnlocked(it) { return val(it.req) >= need(it.req); },
  reqText(it) { return it.req.t === 'free' ? 'Starter' : REQ_TXT[it.req.t](it.req.n); },
  reqProgress(it) { const n = need(it.req); return [Math.min(n, val(it.req)), n]; },
  equippedId(slot) { const id = progress.data.equipped[slot]; return id && BY_ID[id] && this.isUnlocked(BY_ID[id]) ? id : DEFAULT[slot]; },
  look() { return Object.fromEntries(SLOTS.map(s => [s.id, BY_ID[this.equippedId(s.id)]])); },
  equip(id) { const it = BY_ID[id]; if (!it || !this.isUnlocked(it)) return false; progress.data.equipped[it.slot] = id; progress.save(); return true; },
  /** newly met unlock rules since the last check (persisted); silent=true just records them */
  check() {
    const d = progress.data, have = new Set(d.unlockedItems), fresh = [];
    for (const it of ITEMS) if (it.req.t !== 'free' && !have.has(it.id) && this.isUnlocked(it)) { d.unlockedItems.push(it.id); fresh.push(it); }
    if (fresh.length) progress.save();
    return fresh;
  },
  isNew(it) { return it.req.t !== 'free' && this.isUnlocked(it) && !progress.data.seenItems.includes(it.id); },
  newCount(slot) { return ITEMS.filter(i => (!slot || i.slot === slot) && this.isNew(i)).length; },
  markSeen(slot) { const d = progress.data; let ch = false; for (const it of ITEMS) if (it.slot === slot && this.isNew(it)) { d.seenItems.push(it.id); ch = true; } if (ch) progress.save(); },
  /** names of non-default equipped items, for the score card */
  names() { return SLOTS.map(s => this.equippedId(s.id)).filter(id => BY_ID[id].req.t !== 'free').map(id => `${BY_ID[id].name} ${SLOTS.find(s => s.id === BY_ID[id].slot).name.toLowerCase()}`); },
  counts() { const u = ITEMS.filter(i => this.isUnlocked(i)).length; return [u, ITEMS.length]; },
};
