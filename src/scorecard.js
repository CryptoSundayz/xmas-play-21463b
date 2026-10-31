// Shareable score card: a 1200x675 PNG drawn on a 2D canvas (mascot portrait captured from the live WebGL view,
// stage + result + stats + equipped cosmetics + date + play URL), with Download / Share / Post on X actions.
import { CONFIG, formatEth } from './config.js?v=9e6ba718';

const W = 1200, H = 675;
const C = { navy: '#050b18', navy2: '#0b1d44', blue: '#51b1fe', blue2: '#8fdcff', red: '#ff4d5e', green: '#3dff9a', gold: '#ffd36b', ink: '#eaf4ff', dim: 'rgba(214,232,255,0.72)' };
let fontsP = null, logoP = null;
function fonts() {
  if (fontsP) return fontsP;
  fontsP = (async () => {
    try { if (![...document.fonts].some(f => f.family === 'IMFellSC')) { const ff = new FontFace('IMFellSC', 'url(assets/fonts/IMFellEnglishSC-Regular.ttf)'); await ff.load(); document.fonts.add(ff); } } catch (e) { /* serif fallback */ }
  })();
  return fontsP;
}
function logo() {
  return logoP ||= new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/brand/optimum-logo-white.svg'; });
}
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }
function star(g, cx, cy, r, fill, stroke) {
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.closePath();
  g.fillStyle = fill; g.fill(); if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); }
}
function flake(g, x, y, r, a) {
  g.save(); g.translate(x, y); g.globalAlpha = a; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, r * 0.16); g.lineCap = 'round';
  for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r); g.moveTo(0, -r * 0.55); g.lineTo(r * 0.28, -r * 0.8); g.moveTo(0, -r * 0.55); g.lineTo(-r * 0.28, -r * 0.8); g.stroke(); }
  g.restore();
}
export const fmtTime = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };

/**
 * info: { result: 'clear'|'over'|'final', stageNo, stageName, stageCount, eth (staked ETH total), stageEth, time, delivered, total,
 *         stars, title, rank, cosmetics: [names], portrait: canvas|null, date, url, combo }
 */
export async function drawScoreCard(info) {
  await Promise.all([fonts(), logo()]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const ok = info.result !== 'over';
  // ---- background: deep night navy, Optimum-blue glow behind the mascot, a warm red glow bottom-right
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#071631'); gr.addColorStop(1, C.navy); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gr = g.createRadialGradient(280, 330, 20, 280, 330, 420); gr.addColorStop(0, 'rgba(81,177,254,0.42)'); gr.addColorStop(1, 'rgba(81,177,254,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gr = g.createRadialGradient(1080, 640, 10, 1080, 640, 420); gr.addColorStop(0, 'rgba(255,77,94,0.30)'); gr.addColorStop(1, 'rgba(255,77,94,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const R = rand(info.stageNo * 97 + 13);
  for (let i = 0; i < 70; i++) flake(g, R() * W, R() * H, 3 + R() * 7, 0.08 + R() * 0.22);
  // ---- string lights along the top edge
  g.strokeStyle = 'rgba(20,30,40,0.9)'; g.lineWidth = 2.5; g.beginPath();
  const sag = x => 22 + 14 * Math.abs(Math.sin(x / W * Math.PI * 5));
  for (let x = 0; x <= W; x += 10) g.lineTo(x, sag(x)); g.stroke();
  const bulbC = [C.red, C.gold, C.green, C.blue, '#ff9df0'];
  for (let i = 0; i < 30; i++) {
    const x = 20 + i * 40, y = sag(x) + 8, c = bulbC[i % bulbC.length];
    const bg = g.createRadialGradient(x, y, 1, x, y, 18); bg.addColorStop(0, c); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.55; g.fillStyle = bg; g.fillRect(x - 18, y - 18, 36, 36); g.globalAlpha = 1;
    g.fillStyle = '#223'; g.fillRect(x - 3, y - 10, 6, 5); g.beginPath(); g.ellipse(x, y, 5, 8, 0, 0, 7); g.fillStyle = c; g.fill();
    g.beginPath(); g.ellipse(x - 1.5, y - 2, 1.5, 3, 0, 0, 7); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
  }
  // ---- portrait panel (left)
  const px = 40, py = 64, pw = 470, ph = 571;
  g.save(); rr(g, px, py, pw, ph, 28); g.clip();
  gr = g.createLinearGradient(0, py, 0, py + ph); gr.addColorStop(0, '#13306a'); gr.addColorStop(1, '#081430'); g.fillStyle = gr; g.fillRect(px, py, pw, ph);
  if (info.portrait) {
    const s = info.portrait, sa = s.width / s.height, da = pw / ph;
    let sw = s.width, sh = s.height, sx = 0, sy = 0;
    if (sa > da) { sw = sh * da; sx = (s.width - sw) / 2; } else { sh = sw / da; sy = (s.height - sh) / 2; }
    g.drawImage(s, sx, sy, sw, sh, px, py, pw, ph);
  }
  gr = g.createLinearGradient(0, py + ph - 170, 0, py + ph); gr.addColorStop(0, 'rgba(5,11,24,0)'); gr.addColorStop(1, 'rgba(5,11,24,0.92)'); g.fillStyle = gr; g.fillRect(px, py + ph - 170, pw, 170);
  g.restore();
  g.save(); rr(g, px, py, pw, ph, 28); g.lineWidth = 3; g.strokeStyle = 'rgba(143,220,255,0.65)'; g.shadowColor = C.blue; g.shadowBlur = 24; g.stroke(); g.restore();
  // candy-cane corner ribbon
  g.save(); rr(g, px, py, pw, ph, 28); g.clip(); g.translate(px + pw - 70, py + 40); g.rotate(Math.PI / 4);
  g.fillStyle = '#fff'; g.fillRect(-120, -16, 240, 32); g.fillStyle = C.red; for (let i = -120; i < 120; i += 24) { g.beginPath(); g.moveTo(i, -16); g.lineTo(i + 12, -16); g.lineTo(i + 4, 16); g.lineTo(i - 8, 16); g.fill(); }
  g.restore();
  g.font = '700 22px system-ui, -apple-system, Segoe UI, sans-serif'; g.fillStyle = C.blue2; g.textAlign = 'left';
  g.fillText((CONFIG.character.storyName || 'Santa Optimum').toUpperCase(), px + 26, py + ph - 52);
  g.font = '500 17px system-ui, sans-serif'; g.fillStyle = C.dim;
  const wear = (info.cosmetics || []).filter(Boolean);
  wrapText(g, wear.length ? 'Wearing: ' + wear.join(' · ') : 'Wearing: classic Santa velvet', px + 26, py + ph - 26, pw - 52, 20, 1);
  // ---- right column
  const rx = 560, rw = W - rx - 48;
  const lg = await logo(); if (lg) { const lw = 170, lh = lw * 425 / 2000; g.globalAlpha = 0.95; g.drawImage(lg, W - 48 - lw, 64, lw, lh); g.globalAlpha = 1; }
  g.fillStyle = C.ink; fitText(g, CONFIG.branding.title, rx, 104, rw - 215, 44, '', 'IMFellSC, Georgia, serif');
  g.font = '600 16px system-ui, sans-serif'; g.fillStyle = C.blue2; g.fillText(CONFIG.branding.subtitle.toUpperCase(), rx, 132);
  // stage ribbon
  const tag = info.result === 'final' ? 'FINALE CLEARED' : ok ? 'STAGE CLEARED' : 'SLOT MISSED';
  const rib = `${tag} · STAGE ${info.stageNo}/${info.stageCount}`;
  g.font = '800 19px system-ui, sans-serif'; const tw = g.measureText(rib).width + 40;
  rr(g, rx, 156, tw, 38, 19); g.fillStyle = ok ? C.red : '#7a2330'; g.fill(); g.fillStyle = '#fff'; g.fillText(rib, rx + 20, 182);
  g.font = '700 34px system-ui, sans-serif'; g.fillStyle = C.ink; fitText(g, info.stageName, rx, 238, rw, 34, '700', 'system-ui, sans-serif');
  // big staked ETH
  g.font = '600 18px system-ui, sans-serif'; g.fillStyle = C.dim; g.fillText(CONFIG.branding.scoreLabel.toUpperCase(), rx, 284);
  const big = formatEth(info.eth); g.font = '900 92px system-ui, -apple-system, sans-serif';
  gr = g.createLinearGradient(rx, 300, rx + 420, 380); gr.addColorStop(0, '#7fd0ff'); gr.addColorStop(1, C.green); g.fillStyle = gr;
  g.shadowColor = 'rgba(81,177,254,0.6)'; g.shadowBlur = 26; g.fillText(big, rx, 368); g.shadowBlur = 0;
  const bw = g.measureText(big).width; g.font = '800 34px system-ui, sans-serif'; g.fillStyle = C.ink; g.fillText(CONFIG.branding.scoreUnit, rx + bw + 14, 366);
  g.font = '500 17px system-ui, sans-serif'; g.fillStyle = C.dim;
  g.fillText(`+${formatEth(info.stageEth)} ${CONFIG.branding.scoreUnit} this stage · target ${CONFIG.branding.targetLabel}`, rx, 398);
  // stars + title
  for (let i = 0; i < 3; i++) star(g, rx + 30 + i * 62, 446, 26, i < info.stars ? C.gold : 'rgba(255,255,255,0.12)', i < info.stars ? '#fff3c4' : 'rgba(255,255,255,0.25)');
  g.font = '800 24px system-ui, sans-serif'; g.fillStyle = C.gold; g.fillText(info.title || '', rx + 210, 444);
  g.font = '500 16px system-ui, sans-serif'; g.fillStyle = C.dim; g.fillText(info.rank || '', rx + 210, 468);
  // stat tiles
  const tiles = [['TIME', fmtTime(info.time)], ['HOUSES', `${info.delivered}/${info.total}`], ['BEST COMBO', info.combo > 1 ? `x${info.combo}` : '—']];
  const tW = (rw - 24) / 3;
  tiles.forEach(([k, v], i) => {
    const x = rx + i * (tW + 12), y = 500; rr(g, x, y, tW, 84, 16); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill(); g.strokeStyle = 'rgba(143,220,255,0.25)'; g.lineWidth = 1.5; g.stroke();
    g.font = '700 14px system-ui, sans-serif'; g.fillStyle = C.blue2; g.fillText(k, x + 16, y + 28);
    g.font = '800 32px system-ui, sans-serif'; g.fillStyle = C.ink; g.fillText(v, x + 16, y + 66);
  });
  // footer: date + URL, candy stripe
  g.font = '600 17px system-ui, sans-serif'; g.fillStyle = C.dim; g.fillText(info.date, rx, 622);
  g.textAlign = 'right'; g.fillStyle = C.blue2; g.fillText(info.url.replace(/^https?:\/\//, ''), W - 48, 622); g.textAlign = 'left';
  for (let x = -20; x < W; x += 28) { g.fillStyle = (x / 28) % 2 ? C.red : '#fff'; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 14, H - 8); g.lineTo(x + 28, H - 8); g.lineTo(x + 14, H); g.fill(); }
  return cv;
}
function wrapText(g, text, x, y, maxW, lh, maxLines = 2) {
  const words = text.split(' '); let line = '', n = 0;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { if (++n >= maxLines) { g.fillText(line + ' …', x, y); return; } g.fillText(line, x, y); y += lh; line = w; } else line = t; }
  g.fillText(line, x, y);
}
function fitText(g, text, x, y, maxW, px, weight, fam) { let s = px; do { g.font = `${weight} ${s}px ${fam}`; s -= 2; } while (g.measureText(text).width > maxW && s > 14); g.fillText(text, x, y); }

/** share text for X / clipboard */
export function shareText(info) {
  const st = '★'.repeat(info.stars) + '☆'.repeat(3 - info.stars);
  const url = info.url;
  if (info.result === 'over') return `🎅🔥 I missed the slot on Stage ${info.stageNo} "${info.stageName}" in Santa's Block Delivery — ${info.delivered}/${info.total} validators got the block. ${formatEth(info.eth)} ETH staked so far. Can you deliver them all? #mump2p\n${url}`;
  return `🎅🔥 I delivered every block on Stage ${info.stageNo} "${info.stageName}" in Santa's Block Delivery ${st} in ${fmtTime(info.time)} — ${formatEth(info.eth)} ETH staked with Optimum mump2p. Can you beat it? #mump2p\n${url}`;
}

/** wire the overlay's card block to a freshly drawn card */
export function showCardUI(canvas, info, toast) {
  const $ = id => document.getElementById(id);
  const box = $('ovCard'); if (!box) return;
  const url = canvas.toDataURL('image/png');
  $('ovCardImg').src = url; box.classList.remove('hidden'); $('overlay')?.classList.add('withCard');
  const fname = `santa-block-delivery-stage${info.stageNo}${info.result === 'over' ? '-missed' : ''}.png`;
  const blobP = new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
  const text = shareText(info);
  $('cardDl').onclick = async e => {
    e.stopPropagation(); const b = await blobP; const a = document.createElement('a');
    a.href = b ? URL.createObjectURL(b) : url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    if (b) setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('cardShare').onclick = async e => {
    e.stopPropagation(); const b = await blobP;
    try {
      const file = b && new File([b], fname, { type: 'image/png' });
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, title: CONFIG.branding.title }); return; }
      if (navigator.share) { await navigator.share({ text, title: CONFIG.branding.title, url: info.url }); return; }
    } catch (err) { if (err?.name === 'AbortError') return; }
    // fallback: copy the image (where supported) or the text
    try { if (b && window.ClipboardItem && navigator.clipboard?.write) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast?.('Score card image copied'); return; } } catch (err) { /* text below */ }
    try { await navigator.clipboard.writeText(text); toast?.('Score text + link copied'); } catch (err) { toast?.('Copy blocked — use Download instead'); }
  };
  // a real <a target=_blank> click inside the tap: iOS opens a new tab / the X app and never navigates the game tab away
  // (window.open with features can be turned into a same-tab load in standalone / in-app browsers)
  $('cardX').onclick = e => {
    e.stopPropagation();
    const a = document.createElement('a'); a.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text);
    a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('ovCardImg').onclick = () => { const v = $('cardView'); v.querySelector('img').src = url; v.classList.remove('hidden'); };
  $('cardView').onclick = () => $('cardView').classList.add('hidden');
}
export function hideCardUI() { document.getElementById('ovCard')?.classList.add('hidden'); document.getElementById('overlay')?.classList.remove('withCard'); }
