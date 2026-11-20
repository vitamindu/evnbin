import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AccountStore } from '../../../server/accounts';
import { startServer, type RunningServer } from '../../../server/app';
import { Match } from '../../../server/match';
import { Room } from '../../../server/rooms';
import { parseClientMsg } from '../../../server/validate';
import type { Crystal, MatchState, Unit } from '../../../src/game/types';
import { isValidNickname } from '../../../src/net/accountApi';
import type { ServerMsg, Snapshot } from '../../../src/net/protocol';
import { SnapshotBuffer } from '../../../src/net/snapshots';

const quiet = () => {};
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'fg-p5-'));
  dirs.push(d);
  return d;
}

let server: RunningServer | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('nicknames', () => {
  it('rules: 2–10 chars of Korean, letters, digits, underscore', () => {
    for (const ok of ['가나', 'Ab', 'a_1', '열글자닉네임입니다', 'ABCDEFGHIJ']) expect(isValidNickname(ok)).toBe(true);
    for (const bad of ['a', 'ABCDEFGHIJK', 'has space', 'dash-x', '', 'ㄱㄴ', 42]) expect(isValidNickname(bad)).toBe(false);
  });

  it('signup needs a unique nickname (case-insensitive), separate from the username', async () => {
    const s = new AccountStore(tempDir(), Date.now, quiet);
    const a = await s.signup('login_a', 'password', 'Sunny');
    expect(a.profile.name).toBe('Sunny');
    expect(a.username).toBe('login_a');
    await expect(s.signup('login_b', 'password', 'SUNNY')).rejects.toMatchObject({ code: 'nickname_taken' });
    await expect(s.signup('login_b', 'password', 'x')).rejects.toMatchObject({ code: 'invalid_nickname' });
    await expect(s.signup('login_b', 'password', undefined)).rejects.toMatchObject({ code: 'invalid_nickname' });
    // 다른 사람의 아이디와 같은 닉네임은 된다
    const b = await s.signup('login_b', 'password', 'login_a');
    expect(b.profile.name).toBe('login_a');
    // 로그인은 아이디로
    expect((await s.login('LOGIN_A', 'password')).profile.name).toBe('Sunny');
    // 동시에 같은 닉네임으로 가입해도 하나만
    const r = await Promise.allSettled([s.signup('twin_1', 'password', 'Twin'), s.signup('twin_2', 'password', 'twin')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('changes the nickname (own case change allowed, taken/invalid rejected)', async () => {
    const s = new AccountStore(tempDir(), Date.now, quiet);
    await s.signup('user_one', 'password', 'One');
    await s.signup('user_two', 'password', 'Two');
    expect(s.changeNickname('user_one', 'Uno').name).toBe('Uno');
    expect(s.findByNickname('uno')).toBe('user_one');
    expect(s.findByNickname('One')).toBeNull();
    expect(s.changeNickname('user_one', 'UNO').name).toBe('UNO');
    expect(() => s.changeNickname('user_one', 'two')).toThrow(expect.objectContaining({ code: 'nickname_taken' }));
    expect(() => s.changeNickname('user_one', 'a b')).toThrow(expect.objectContaining({ code: 'invalid_nickname' }));
    // 바뀐 닉네임은 다시 읽어도 그대로, 예전 닉네임은 다른 사람이 쓸 수 있다
    const s2 = new AccountStore(s.dir, Date.now, quiet);
    expect(s2.profile('user_one')!.name).toBe('UNO');
    await s2.signup('user_three', 'password', 'One');
  });

  it('migrates older accounts: nickname = username (cut to 10, numeric suffix on collision)', async () => {
    const dir = tempDir();
    const s = new AccountStore(dir, Date.now, quiet);
    await s.signup('Mina', 'password', 'Keeper'); // 닉네임 있음(새 형식)
    await s.signup('longusername', 'password', 'tmp1');
    await s.signup('longusernam2', 'password', 'tmp2');
    await s.signup('keeper', 'password', 'tmp3');
    // 예전 형식으로 되돌린다: Mina 말고는 닉네임 필드 없음, profile.name = 아이디
    const file = join(dir, 'accounts.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { users: Record<string, { username: string; nickname?: string; friends?: string[]; profile: { name: string } }> };
    for (const [k, u] of Object.entries(raw.users)) {
      if (k === 'mina') continue;
      delete u.nickname;
      delete u.friends;
      u.profile.name = u.username;
    }
    writeFileSync(file, JSON.stringify(raw));
    const m = new AccountStore(dir, Date.now, quiet);
    expect(m.profile('mina')!.name).toBe('Keeper');
    expect(m.profile('longusername')!.name).toBe('longuserna');
    expect(m.profile('longusernam2')!.name).toBe('longusern2');
    expect(m.profile('keeper')!.name).toBe('keeper2'); // 'Keeper'는 이미 Mina의 닉네임
    expect(m.friends('keeper')).toEqual([]);
    // 옮긴 결과가 파일에 저장됐다
    const again = JSON.parse(readFileSync(file, 'utf8')) as { users: Record<string, { nickname: string }> };
    expect(again.users.keeper!.nickname).toBe('keeper2');
  });
});

describe('friends', () => {
  it('add is mutual; errors not_found / already_friends / self; remove is mutual', async () => {
    const s = new AccountStore(tempDir(), Date.now, quiet);
    await s.signup('id_a', 'password', '사과');
    await s.signup('id_b', 'password', 'Banana');
    s.addFriend('id_a', 'banana');
    expect(s.friends('id_a')).toEqual(['id_b']);
    expect(s.friends('id_b')).toEqual(['id_a']);
    expect(() => s.addFriend('id_b', '사과')).toThrow(expect.objectContaining({ code: 'already_friends' }));
    expect(() => s.addFriend('id_a', '사과')).toThrow(expect.objectContaining({ code: 'self' }));
    expect(() => s.addFriend('id_a', 'nobody')).toThrow(expect.objectContaining({ code: 'not_found' }));
    s.removeFriend('id_b', '사과');
    expect(s.friends('id_a')).toEqual([]);
    expect(s.friends('id_b')).toEqual([]);
    expect(() => s.removeFriend('id_b', '사과')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});

describe('phase 5 over HTTP and websocket', () => {
  async function boot() {
    server = await startServer({ port: 0, host: '127.0.0.1', startDelayMs: 20, log: quiet, dataDir: tempDir() });
    return `http://127.0.0.1:${server.port}`;
  }
  const req = async (base: string, method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const signup = async (base: string, username: string, nickname: string) =>
    (await req(base, 'POST', '/api/signup', { username, password: 'password1', nickname })).body as { token: string; username: string };

  function connect(base: string, token?: string) {
    const ws = new WebSocket(base.replace('http', 'ws'));
    sockets.push(ws);
    const msgs: ServerMsg[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ServerMsg));
    const opened = new Promise<void>((r) => ws.on('open', () => r()));
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const wait = async <T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true) => {
      for (let i = 0; i < 300; i++) {
        const m = msgs.find((x) => x.t === t && pred(x as Extract<ServerMsg, { t: T }>));
        if (m) return m as Extract<ServerMsg, { t: T }>;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timeout waiting for ${t}`);
    };
    return {
      ws,
      msgs,
      send,
      wait,
      hello: async () => {
        await opened;
        send({ t: 'hello', v: 2, name: 'guest', fighterId: 'rivet', ...(token ? { token } : {}) });
        await wait('welcome');
      },
    };
  }

  it('signup/nickname endpoints and the in-room name is the nickname', async () => {
    const base = await boot();
    let r = await req(base, 'POST', '/api/signup', { username: 'idname', password: 'password1' });
    expect(r).toEqual({ status: 400, body: { error: 'invalid_nickname' } });
    const a = await signup(base, 'idname', 'Nick');
    expect(a.username).toBe('idname');
    r = await req(base, 'POST', '/api/signup', { username: 'other1', password: 'password1', nickname: 'NICK' });
    expect(r).toEqual({ status: 409, body: { error: 'nickname_taken' } });
    r = await req(base, 'PUT', '/api/nickname', { nickname: '새이름' }, a.token);
    expect(r.status).toBe(200);
    expect((r.body.profile as { name: string }).name).toBe('새이름');
    expect(r.body.username).toBe('idname');
    r = await req(base, 'PUT', '/api/nickname', { nickname: 'x' }, a.token);
    expect(r).toEqual({ status: 400, body: { error: 'invalid_nickname' } });
    r = await req(base, 'PUT', '/api/nickname', { nickname: 'abc' });
    expect(r.status).toBe(401);
    r = await req(base, 'GET', '/api/me', undefined, a.token);
    expect(r.body.username).toBe('idname');

    const c = connect(base, a.token);
    await c.hello();
    c.send({ t: 'create' });
    const room = await c.wait('room');
    expect(room.room.players[0]!.name).toBe('새이름');
  });

  it('friends API with online / inRoom presence', async () => {
    const base = await boot();
    const a = await signup(base, 'alice_id', 'Alice');
    const b = await signup(base, 'bob_id', '바나나');
    let r = await req(base, 'POST', '/api/friends', { nickname: '바나나' }, a.token);
    expect(r.status).toBe(200);
    expect(r.body.friends).toEqual([{ nickname: '바나나', online: false, rankPoints: 0, inRoom: false }]);
    r = await req(base, 'GET', '/api/friends', undefined, b.token);
    expect(r.body.friends).toEqual([{ nickname: 'Alice', online: false, rankPoints: 0, inRoom: false }]);
    expect((await req(base, 'POST', '/api/friends', { nickname: 'alice' }, b.token)).body).toEqual({ error: 'already_friends' });
    expect((await req(base, 'POST', '/api/friends', { nickname: 'bob_id' }, a.token))).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await req(base, 'POST', '/api/friends', { nickname: 'Alice' }, a.token)).body).toEqual({ error: 'self' });
    expect((await req(base, 'GET', '/api/friends')).status).toBe(401);

    // 밥이 접속 → online, 방을 만들면 inRoom
    const cb = connect(base, b.token);
    await cb.hello();
    r = await req(base, 'GET', '/api/friends', undefined, a.token);
    expect(r.body.friends).toEqual([{ nickname: '바나나', online: true, rankPoints: 0, inRoom: false }]);
    cb.send({ t: 'create' });
    await cb.wait('room');
    r = await req(base, 'GET', '/api/friends', undefined, a.token);
    expect((r.body.friends as { inRoom: boolean }[])[0]!.inRoom).toBe(true);
    // 게스트 연결은 계정 접속으로 치지 않는다
    cb.ws.close();
    await new Promise((res) => setTimeout(res, 50));
    r = await req(base, 'GET', '/api/friends', undefined, a.token);
    expect((r.body.friends as { online: boolean }[])[0]!.online).toBe(false);

    // 삭제(URL 인코딩한 한글 닉네임) → 서로 사라짐
    r = await req(base, 'DELETE', `/api/friends/${encodeURIComponent('바나나')}`, undefined, a.token);
    expect(r).toEqual({ status: 200, body: { friends: [] } });
    expect((await req(base, 'GET', '/api/friends', undefined, b.token)).body.friends).toEqual([]);
    expect((await req(base, 'DELETE', `/api/friends/${encodeURIComponent('바나나')}`, undefined, a.token)).status).toBe(404);
  });

  it('setMode is host-only and the match starts in that mode with crystals in snaps', async () => {
    const base = await boot();
    const h = connect(base);
    const g = connect(base);
    await h.hello();
    await g.hello();
    h.send({ t: 'create' });
    const code = (await h.wait('room')).room.code;
    g.send({ t: 'join', code });
    await g.wait('room');
    g.send({ t: 'setMode', mode: 'crystal' });
    expect((await g.wait('error')).code).toBe('not_host');
    h.send({ t: 'setMode', mode: 'crystal' });
    await g.wait('room', (m) => m.room.mode === 'crystal');
    h.send({ t: 'start' });
    const start = await g.wait('start');
    expect(start.match.mode).toBe('crystal');
    const snap = (await g.wait('snap')).snap;
    expect(Array.isArray(snap.crystals)).toBe(true);
    expect(server!.rooms.get(code)!.match!.sim.match.mode).toBe('crystal');
  });
});

describe('room mode and crystals in snapshots', () => {
  it('Room.setMode: host only, lobby only, known modes only', () => {
    const r = new Room('ABCD');
    r.add('h', 'Host', 'rivet');
    r.add('g', 'Guest', 'rivet');
    expect(r.toState().mode).toBe('teamfight');
    expect(r.setMode('g', 'crystal')).toBe('not_host');
    expect(r.setMode('h', 'crystal')).toBeNull();
    expect(r.toState().mode).toBe('crystal');
    r.phase = 'playing';
    expect(r.setMode('h', 'teamfight')).toBe('in_progress');
    expect(parseClientMsg('{"t":"setMode","mode":"crystal"}')).toEqual({ t: 'setMode', mode: 'crystal' });
    expect(parseClientMsg('{"t":"setMode","mode":"training"}')).toBeNull();
  });

  it('server snaps carry sim.crystals and the client view uses the later snap', () => {
    const sent: string[] = [];
    const m = new Match(
      {
        seed: 3,
        mapId: 'blossom-arena',
        mode: 'crystal',
        roster: [{ playerId: 'a', name: 'A', team: 0, fighterId: 'rivet', bot: false }],
      },
      { send: (_p, d) => sent.push(d), isConnected: () => true, onEnd: () => {} },
    );
    const gem: Crystal = { id: 999, type: 'crystal', pos: { x: 16.5, y: 9.5 } };
    m.sim.crystals.push(gem);
    m.step();
    m.step();
    const snap = (JSON.parse(sent[0]!) as { snap: Snapshot }).snap;
    expect(snap.crystals).toEqual([gem]);

    const match: MatchState = { mode: 'crystal', score: [0, 0], targetScore: 0, ticksLeft: -1, winner: null };
    const units: Unit[] = [];
    const b = new SnapshotBuffer();
    b.push({ tick: 10, units, projectiles: [], lobs: [], crystals: [gem], match, events: [] });
    b.push({ tick: 12, units, projectiles: [], lobs: [], crystals: [], match, events: [] });
    expect(b.sample(10)!.crystals).toEqual([gem]);
    expect(b.sample(11)!.crystals).toEqual([]);
    expect(b.sample(14)!.crystals).toEqual([]);
  });
});
