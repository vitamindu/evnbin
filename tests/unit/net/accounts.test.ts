import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AccountStore, RateLimiter, TOKEN_TTL_MS } from '../../../server/accounts';
import { startServer, type RunningServer } from '../../../server/app';
import { apiBase } from '../../../src/net/account';
import type { ServerMsg } from '../../../src/net/protocol';
import type { HistoryResponse } from '../../../src/net/accountApi';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'fg-acc-'));
  dirs.push(d);
  return d;
}

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const quiet = () => {};

describe('AccountStore', () => {
  it('signs up and logs in; the file stores only hashes', async () => {
    const dir = tempDir();
    const s = new AccountStore(dir, Date.now, quiet);
    const a = await s.signup('Mina_01', 'secret1', 'Mina');
    expect(a.profile.name).toBe('Mina');
    expect(a.username).toBe('Mina_01');
    expect(a.profile.tag).toMatch(/^[0-9A-Z]{8}$/);
    expect(a.profile.coins).toBe(0);
    expect(s.verify(a.token)).toBe('mina_01');
    const b = await s.login('mina_01', 'secret1');
    expect(b.profile.tag).toBe(a.profile.tag);
    const file = readFileSync(join(dir, 'accounts.json'), 'utf8');
    expect(file).not.toContain('secret1');
    expect(file).not.toContain(a.token);
    expect(file).not.toContain(b.token);
    // 다시 읽어도 그대로
    const s2 = new AccountStore(dir, Date.now, quiet);
    expect(s2.verify(b.token)).toBe('mina_01');
    expect(s2.profile('mina_01')!.tag).toBe(a.profile.tag);
  });

  it('rejects bad passwords, unknown users, duplicates (case-insensitive) and invalid input', async () => {
    const s = new AccountStore(tempDir(), Date.now, quiet);
    await s.signup('하늘Sky', 'password', '하늘');
    await expect(s.login('하늘sky', 'wrongpass')).rejects.toMatchObject({ code: 'bad_credentials' });
    await expect(s.login('nobody', 'password')).rejects.toMatchObject({ code: 'bad_credentials' });
    await expect(s.signup('하늘SKY', 'another1', 'other')).rejects.toMatchObject({ code: 'username_taken' });
    await expect(s.signup('ab', 'password', 'nick')).rejects.toMatchObject({ code: 'invalid_username' });
    await expect(s.signup('thirteen_char', 'password', 'nick')).rejects.toMatchObject({ code: 'invalid_username' });
    await expect(s.signup('bad name', 'password', 'nick')).rejects.toMatchObject({ code: 'invalid_username' });
    await expect(s.signup('okname', '12345', 'okname')).rejects.toMatchObject({ code: 'weak_password' });
    await expect(s.signup(42, 'password', 'nick')).rejects.toMatchObject({ code: 'invalid_username' });
    // 동시에 같은 아이디로 가입해도 하나만
    const r = await Promise.allSettled([s.signup('Twin', 'password', 'Twin1'), s.signup('twin', 'password', 'Twin2')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('tokens expire after 30 days and logout revokes them', async () => {
    let now = 1_000_000;
    const s = new AccountStore(tempDir(), () => now, quiet);
    const { token } = await s.signup('timer', 'password', 'timer');
    now += TOKEN_TTL_MS - 1000;
    expect(s.verify(token)).toBe('timer');
    now += 2000;
    expect(s.verify(token)).toBeNull();
    const t2 = (await s.login('timer', 'password')).token;
    expect(s.logout(t2)).toBe(true);
    expect(s.verify(t2)).toBeNull();
    expect(s.verify('garbage')).toBeNull();
  });

  it('client can change only the selected fighter; match results move trophies and coins', async () => {
    const s = new AccountStore(tempDir(), Date.now, quiet);
    await s.signup('player1', 'password', 'player1');
    expect(s.updateSelected('player1', 'boulder')!.selected).toBe('boulder');
    expect(s.updateSelected('player1', 'nobody')).toBeNull();
    s.applyMatchResults([{ account: 'player1', fighterId: 'boulder', outcome: 'win' }]);
    let p = s.profile('player1')!;
    expect(p.fighters.boulder.trophies).toBe(8);
    expect(p.coins).toBe(20);
    s.applyMatchResults([{ account: 'player1', fighterId: 'boulder', outcome: 'loss' }]);
    s.applyMatchResults([{ account: 'player1', fighterId: 'boulder', outcome: 'loss' }]);
    s.applyMatchResults([{ account: 'player1', fighterId: 'boulder', outcome: 'loss' }]);
    p = s.profile('player1')!;
    expect(p.fighters.boulder.trophies).toBe(0); // 8 − 12 → 0 아래로는 안 내려감
    expect(p.coins).toBe(50);
    s.applyMatchResults([{ account: 'player1', fighterId: 'rivet', outcome: 'draw' }]);
    p = s.profile('player1')!;
    expect(p.fighters.rivet.trophies).toBe(0);
    expect(p.coins).toBe(60);
    // 없는 계정(게스트)은 무시
    s.applyMatchResults([{ account: 'ghost', fighterId: 'rivet', outcome: 'win' }]);
  });
});

describe('RateLimiter', () => {
  it('blocks an IP after 5 failures in 10 minutes and unblocks after the window', () => {
    let now = 0;
    const r = new RateLimiter(5, 600_000, 10, () => now);
    for (let i = 0; i < 5; i++) {
      expect(r.loginBlocked('1.1.1.1')).toBe(false);
      r.loginFailed('1.1.1.1');
    }
    expect(r.loginBlocked('1.1.1.1')).toBe(true);
    expect(r.loginBlocked('2.2.2.2')).toBe(false);
    now += 600_001;
    expect(r.loginBlocked('1.1.1.1')).toBe(false);
    r.loginFailed('1.1.1.1');
    r.loginOk('1.1.1.1');
    expect(r.loginBlocked('1.1.1.1')).toBe(false);
  });
});

describe('account HTTP API', () => {
  async function boot() {
    server = await startServer({ port: 0, host: '127.0.0.1', startDelayMs: 20, log: quiet, dataDir: tempDir(), match: { maxTicks: 20 } });
    return `http://127.0.0.1:${server.port}`;
  }
  const post = (base: string, path: string, body: unknown, token?: string, method = 'POST') =>
    fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('signup / login / me / profile / logout with CORS', async () => {
    const base = await boot();
    expect(apiBase(`ws://127.0.0.1:${server!.port}`)).toBe(base);
    expect(apiBase('wss://game.example.com/')).toBe('https://game.example.com');

    let res = await post(base, '/api/signup', { username: 'Alpha', password: 'password1', nickname: 'Alpha' });
    expect(res.status).toBe(200);
    const { token, profile } = (await res.json()) as { token: string; profile: { name: string } };
    expect(profile.name).toBe('Alpha');

    res = await post(base, '/api/signup', { username: 'ALPHA', password: 'password1', nickname: 'Other' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'username_taken' });

    res = await post(base, '/api/login', { username: 'alpha', password: 'nope-nope' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad_credentials' });

    res = await fetch(base + '/api/me', { headers: { authorization: `Bearer ${token}`, origin: 'https://vitamindu.github.io' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vitamindu.github.io');
    expect(((await res.json()) as { profile: { name: string } }).profile.name).toBe('Alpha');

    res = await fetch(base + '/api/me', { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();

    res = await fetch(base + '/api/login', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');

    // 선택 캐릭터만 바꿀 수 있다
    res = await post(base, '/api/profile', { selected: 'hinako' }, token, 'PUT');
    expect(((await res.json()) as { profile: { selected: string } }).profile.selected).toBe('hinako');
    res = await post(base, '/api/profile', { selected: 'rivet', coins: 99999 }, token, 'PUT');
    expect(res.status).toBe(400);
    res = await post(base, '/api/profile', { selected: 'nobody' }, token, 'PUT');
    expect(res.status).toBe(400);
    res = await post(base, '/api/profile', { selected: 'rivet' }, undefined, 'PUT');
    expect(res.status).toBe(401);
    expect(server!.accounts.profile('alpha')!.coins).toBe(0);

    res = await post(base, '/api/logout', {}, token);
    expect(res.status).toBe(200);
    res = await fetch(base + '/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });

    res = await fetch(base + '/api/signup', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rate-limits repeated failed logins from one IP', async () => {
    const base = await boot();
    await post(base, '/api/signup', { username: 'victim', password: 'password1', nickname: 'victim' });
    for (let i = 0; i < 5; i++) expect((await post(base, '/api/login', { username: 'victim', password: 'wrong' + i })).status).toBe(401);
    const res = await post(base, '/api/login', { username: 'victim', password: 'password1' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('hello with a token uses the account name and the match result is applied to that account only', async () => {
    const base = await boot();
    const { token } = (await (await post(base, '/api/signup', { username: 'hero_id', password: 'password1', nickname: 'Hero' })).json()) as { token: string };
    const ws = (name: string, tok?: string) =>
      new Promise<{ ws: WebSocket; msgs: ServerMsg[] }>((resolve) => {
        const w = new WebSocket(base.replace('http', 'ws'));
        const msgs: ServerMsg[] = [];
        w.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ServerMsg));
        w.on('open', () => {
          w.send(JSON.stringify({ t: 'hello', v: 2, name, fighterId: 'volley', ...(tok ? { token: tok } : {}) }));
          resolve({ ws: w, msgs });
        });
      });
    const wait = async (msgs: ServerMsg[], pred: (m: ServerMsg) => boolean) => {
      for (let i = 0; i < 200 && !msgs.some(pred); i++) await new Promise((r) => setTimeout(r, 20));
      return msgs.find(pred)!;
    };
    const a = await ws('ignored', token);
    const g = await ws('Hero'); // 같은 이름의 게스트
    const bad = await ws('Faker', 'not-a-real-token-xxxxxxxxxxxx'); // 틀린 토큰 → 게스트
    await wait(a.msgs, (m) => m.t === 'welcome');
    a.ws.send(JSON.stringify({ t: 'create' }));
    const room = await wait(a.msgs, (m) => m.t === 'room');
    const code = room.t === 'room' ? room.room.code : '';
    g.ws.send(JSON.stringify({ t: 'join', code }));
    bad.ws.send(JSON.stringify({ t: 'join', code }));
    const full = await wait(a.msgs, (m) => m.t === 'room' && m.room.players.length === 3);
    const names = full.t === 'room' ? full.room.players.map((p) => p.name) : [];
    // 입장 순서는 소켓 연결 순서에 따라 달라질 수 있다
    expect([...names].sort()).toEqual(['Faker', 'Hero', 'Hero 2']);
    a.ws.send(JSON.stringify({ t: 'start' }));
    const end = await wait(a.msgs, (m) => m.t === 'end');
    expect(end.t === 'end' && end.result.winner).toBe(-1); // 20틱 안전 상한 → 0:0 무승부
    await wait(a.msgs, (m) => m.t === 'room' && m.room.phase === 'lobby' && a.msgs.some((x) => x.t === 'end'));
    const me = (await (await fetch(base + '/api/me', { headers: { authorization: `Bearer ${token}` } })).json()) as {
      profile: { coins: number; fighters: Record<string, { trophies: number }> };
    };
    expect(me.profile.coins).toBe(10);
    expect(me.profile.fighters.volley!.trophies).toBe(0);
    expect(server!.accounts.size).toBe(1); // 게스트는 계정이 생기지 않는다
    // 전적: 계정에만 한 판이 남는다(나 + 게스트 2명)
    const hist = (await (await fetch(base + '/api/history', { headers: { authorization: `Bearer ${token}` } })).json()) as HistoryResponse;
    expect(hist.records).toHaveLength(1);
    const rec = hist.records[0]!;
    expect(rec.outcome).toBe('draw');
    expect(rec.mode).toBe('teamfight');
    expect(rec.fighterId).toBe('volley');
    expect(rec.players).toHaveLength(3);
    expect(rec.players.filter((p) => p.me).map((p) => p.name)).toEqual(['Hero']);
    expect(rec.players.every((p) => !p.bot)).toBe(true);
    expect(hist.totals).toMatchObject({ games: 1, draws: 1, wins: 0, losses: 0 });
    for (const c of [a, g, bad]) c.ws.close();
  });
});
