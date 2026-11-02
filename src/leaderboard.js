// Global leaderboard behind a pluggable adapter.
//   CONFIG.leaderboard.url = ''                -> LocalAdapter: this device's best runs + "Global leaderboard coming online"
//   CONFIG.leaderboard.url = 'https://…/'      -> HttpAdapter: server/cloudflare (Worker + D1) or server/supabase (edge fn)
// Adapter interface (all async, never throw to the game):
//   startRun(stage)            -> remembers a server-signed run token for this attempt (HMAC secret lives on the server only)
//   submit(run)                -> { rank, players, overallRank, improved } | { error }
//   top(board 'all' | 1..16)   -> { entries:[{rank,name,eth,time,stars,me}], me:{rank,eth,time,stars}|null, players, note? }
//   setName(name)              -> { ok, name } | { ok:false, why }
import { cleanName, checkRun, NAME_MAX } from '../server/shared/rules.js?v=41faccfa';
export { cleanName, NAME_MAX };

const defaultName = (pid) => 'Santa ' + pid.slice(-4).toUpperCase();

export class LocalAdapter {
  constructor(progress, levels) { this.p = progress; this.levels = levels; this.online = false; this.note = 'Global leaderboard coming online — showing this device’s best runs.'; }
  get name() { return this.p.player.name || defaultName(this.p.player.id); }
  async startRun() {}
  async submit(run) { return run.cleared ? { rank: 1, players: 1, local: true } : { error: 'not cleared' }; }
  async setName(n) { const c = cleanName(n); if (c.ok) this.p.setName(c.name); return c.ok ? { ok: true, name: c.name } : { ok: false, why: c.why }; }
  async top(board) {
    const rows = [];
    if (board === 'all') {
      let eth = 0, time = 0, stars = 0, any = false;
      this.levels.forEach((_, i) => { const b = this.p.best(i); if (b?.eth) { any = true; eth += b.eth; time += b.time || 0; stars += b.stars || 0; } });
      if (any) rows.push({ rank: 1, name: this.name, eth: Math.round(eth), time, stars, me: true });
    } else { const b = this.p.best(board - 1); if (b?.eth) rows.push({ rank: 1, name: this.name, eth: Math.round(b.eth), time: b.time, stars: b.stars, me: true }); }
    return { entries: rows, me: rows[0] ? { ...rows[0] } : null, players: rows.length, note: this.note, local: true };
  }
}

export class HttpAdapter {
  constructor(progress, url, timeoutMs = 6000) { this.p = progress; this.url = url.replace(/\/+$/, ''); this.timeout = timeoutMs; this.online = true; this.tokens = new Map(); }
  get name() { return this.p.player.name || defaultName(this.p.player.id); }
  async req(path, body) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), this.timeout);
    try {
      const res = await fetch(this.url + '/v1' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal } : { signal: ac.signal });
      const j = await res.json().catch(() => ({}));
      return res.ok ? j : { error: j.error || `HTTP ${res.status}` };
    } catch (e) { return { error: 'offline' }; } finally { clearTimeout(t); }
  }
  async startRun(stage) {
    const r = await this.req('/session', { pid: this.p.player.id, stage });
    if (r.token) this.tokens.set(stage, r.token);
  }
  async submit(run) {
    if (!run.cleared) return { error: 'not cleared' };
    const token = this.tokens.get(run.stage); if (!token) return { error: 'no run token' };
    this.tokens.delete(run.stage);
    const body = { stage: run.stage, eth: Math.round(run.eth), time: Math.round(run.time * 100) / 100, stars: run.stars, delivered: run.delivered, total: run.total, hits: run.hits, combo: run.combo, difficulty: run.difficulty };
    const why = checkRun(body); if (why) return { error: why }; // don't waste a request on a run the server will refuse
    return this.req('/submit', { pid: this.p.player.id, name: this.name, token, run: body });
  }
  async setName(n) {
    const c = cleanName(n); if (!c.ok) return { ok: false, why: c.why };
    const r = await this.req('/name', { pid: this.p.player.id, name: c.name });
    if (r.error && r.error !== 'offline') return { ok: false, why: r.error };
    this.p.setName(c.name); return { ok: true, name: c.name, offline: !!r.error };
  }
  async top(board) {
    const r = await this.req(`/top?board=${board}&limit=50&pid=${encodeURIComponent(this.p.player.id)}`);
    return r.error ? { entries: [], me: null, players: 0, error: r.error === 'offline' ? 'Leaderboard offline — try again in a moment.' : r.error } : r;
  }
}

/** url: CONFIG.leaderboard.url; QA may override with ?lb=<url> (only together with ?qa=1) */
export function createLeaderboard(cfg, progress, levels) {
  const q = new URLSearchParams(location.search), url = (q.get('qa') === '1' && q.get('lb')) || cfg?.url || '';
  return url ? new HttpAdapter(progress, url, cfg.timeoutMs) : new LocalAdapter(progress, levels);
}
