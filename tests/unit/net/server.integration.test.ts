import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer, type ServerOptions } from '../../../server/app';
import type { Fighter, SimEvent } from '../../../src/game/types';
import type { BattleView } from '../../../src/render/battle/battleView';
import { OnlineClientImpl } from '../../../src/net/client';
import { OnlineSession } from '../../../src/net/onlineSession';
import type { MatchResult, RoomState, ServerMsg, Snapshot } from '../../../src/net/protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: RunningServer | null = null;
const sockets: WebSocket[] = [];
const clients: OnlineClientImpl[] = [];

let dataDir: string | null = null;

async function boot(opts: ServerOptions = {}) {
  dataDir = mkdtempSync(join(tmpdir(), 'fg-net-'));
  server = await startServer({ port: 0, host: '127.0.0.1', startDelayMs: 50, log: () => {}, dataDir, ...opts });
  return `ws://127.0.0.1:${server.port}`;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

/** 원시 웹소켓 가짜 클라이언트 */
class FakeClient {
  readonly ws: WebSocket;
  readonly msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    sockets.push(this.ws);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }
  opened() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  next<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, timeout = 3000) {
    const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
    if (found) return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    return new Promise<Extract<ServerMsg, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }
  snaps(): Snapshot[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap').map((m) => m.snap);
  }
}

async function fake(url: string, name: string): Promise<FakeClient> {
  const c = new FakeClient(url);
  await c.opened();
  c.send({ t: 'hello', v: 2, name, fighterId: 'volley' });
  await c.next('welcome');
  return c;
}

/** 3D 없이 OnlineSession을 돌리기 위한 가짜 화면 */
function fakeView(): BattleView {
  const v = {
    scene: {},
    camera: {},
    events: [] as SimEvent[],
    snapshot() {},
    applyEvents(e: readonly SimEvent[]) {
      v.events.push(...e);
    },
    frame() {},
    resize() {},
    dispose() {},
  };
  return v as unknown as BattleView;
}

describe('game server', () => {
  it('serves /health', async () => {
    const url = await boot();
    const res = await fetch(url.replace('ws', 'http') + '/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocol: number };
    expect(body.ok).toBe(true);
    expect(body.protocol).toBe(2);
  });

  it('rejects a wrong protocol version and unknown rooms', async () => {
    const url = await boot();
    const c = new FakeClient(url);
    await c.opened();
    c.send({ t: 'join', code: 'ABCD' });
    expect((await c.next('error')).code).toBe('bad_message'); // hello 전
    c.send({ t: 'hello', v: 2, name: 'A', fighterId: 'rivet' });
    await c.next('welcome');
    c.send({ t: 'join', code: 'ZZZZ' });
    expect((await c.next('error', (m) => m.code !== 'bad_message')).code).toBe('room_not_found');
    const d = new FakeClient(url);
    await d.opened();
    d.send({ t: 'hello', v: 1, name: 'B', fighterId: 'rivet' });
    expect((await d.next('error')).code).toBe('bad_version');
  });

  it('two clients: create/join, start, snaps with both fighters, input moves the fighter, end returns to lobby', async () => {
    const url = await boot({ match: { maxTicks: 75 } });
    const a = await fake(url, 'Ann');
    const b = await fake(url, 'Bob');
    a.send({ t: 'create' });
    const created = (await a.next('room')).room;
    expect(created.code).toMatch(/^[A-Z]{4}$/);
    b.send({ t: 'join', code: created.code.toLowerCase() });
    const joined = (await b.next('room')).room;
    expect(joined.players.map((p) => [p.name, p.team, p.host])).toEqual([
      ['Ann', 0, true],
      ['Bob', 1, false],
    ]);
    // 방장이 아니면 시작 불가
    b.send({ t: 'start' });
    expect((await b.next('error')).code).toBe('not_host');

    a.send({ t: 'start' });
    const startA = (await a.next('start')).match;
    const startB = (await b.next('start')).match;
    expect(startA.seed).toBe(startB.seed);
    expect(startA.roster).toHaveLength(2);
    expect(startA.snapshotEvery).toBe(2);
    expect(startA.tickRate).toBe(30);
    const bobEntity = startB.roster.find((r) => r.name === 'Bob')!.entityId;

    // Bob: 위(-y)로 이동 입력을 매 틱
    let seq = 0;
    const timer = setInterval(() => b.send({ t: 'input', seq: ++seq, move: { x: 0, y: -1 } }), 1000 / 30);
    await b.next('snap', (m) => m.snap.tick >= 40);
    clearInterval(timer);

    const snaps = b.snaps();
    const first = snaps[0]!;
    const last = snaps[snaps.length - 1]!;
    expect(first.units.filter((u) => u.type === 'fighter')).toHaveLength(2);
    expect(last.units.filter((u) => u.type === 'fighter')).toHaveLength(2);
    // 2틱마다
    expect(snaps[1]!.tick - snaps[0]!.tick).toBe(2);
    const bob0 = first.units.find((u) => u.id === bobEntity)!;
    const bob1 = last.units.find((u) => u.id === bobEntity)!;
    expect(bob1.pos.y).toBeLessThan(bob0.pos.y - 0.5);
    expect(Math.abs(bob1.pos.x - bob0.pos.x)).toBeLessThan(0.05);
    expect(last.ack).toBeGreaterThan(20);
    // Ann은 입력이 없으니 그대로, ack 0
    const annSnaps = a.snaps();
    expect(annSnaps[annSnaps.length - 1]!.ack).toBe(0);

    // 안전 상한(75틱)에서 끝 → end, 방은 lobby로
    const end = (await a.next('end', () => true, 5000)).result;
    expect(end.score).toEqual([0, 0]);
    expect(end.winner).toBe(-1);
    expect(end.stats.map((s) => s.name).sort()).toEqual(['Ann', 'Bob']);
    const lobby = await a.next('room', (m) => m.room.phase === 'lobby' && a.msgs.some((x) => x.t === 'end'));
    expect(lobby.room.players.every((p) => !p.ready)).toBe(true);
  });

  it('OnlineClient + OnlineSession: prediction tracks the server, reconnect resumes the same seat', async () => {
    const url = await boot({ match: { maxTicks: 30 * 30 } });
    const mk = () => {
      const c = new OnlineClientImpl({
        WebSocketImpl: WebSocket as unknown as new (url: string) => globalThis.WebSocket,
        sessionOptions: { createView: () => fakeView() },
        reconnectDelaysMs: [50, 100, 200, 400],
        pingIntervalMs: 200,
        getToken: () => null,
      });
      clients.push(c);
      return c;
    };
    const host = mk();
    const guest = mk();
    await host.connect(url, 'Host', 'rivet');
    await guest.connect(url, 'Guest', 'boulder');
    expect(host.status).toBe('connected');
    const room = await host.createRoom();
    await expect(guest.joinRoom('QQQQ')).rejects.toMatchObject({ code: 'room_not_found' });
    const joined = await guest.joinRoom(room.code);
    expect(joined.players).toHaveLength(2);

    host.setFillBots(true);
    await new Promise<void>((r) => {
      const off = guest.on('room', (st) => {
        if (st && st.players.length === 6) {
          off();
          r();
        }
      });
    });

    const started = new Promise<OnlineSession>((r) => guest.on('matchStart', ({ session }) => r(session as OnlineSession)));
    host.startMatch();
    const session = await started;
    expect(session.kind).toBe('online');
    expect(session.state.units).toHaveLength(6);
    const me0 = { ...session.player.pos };

    // 30fps로 프레임을 돌리며 오른쪽으로 이동(팀1이면 왼쪽)
    const dir = session.player.team === 0 ? 1 : -1;
    session.controls.move = { x: dir, y: 0 };
    let t = 0;
    const frames = async (n: number) => {
      for (let i = 0; i < n; i++) {
        session.update((t += 1 / 30), 1 / 30);
        await sleep(1000 / 30);
      }
    };
    await frames(45);
    session.controls.move = { x: 0, y: 0 };
    await frames(20);
    expect(session.isStarted).toBe(true);
    const shown = session.player.pos;
    expect((shown.x - me0.x) * dir).toBeGreaterThan(0.8);
    // 서버(최신 snap)와 예측 위치가 같다
    const serverMe = guest.currentSession!.stats;
    expect(serverMe.pendingInputs).toBeLessThan(10);
    expect(serverMe.maxCorrection).toBeLessThan(0.35);
    const srv = server!.rooms.get(room.code)!.match!.sim.getUnit(session.playerId) as Fighter;
    expect(Math.hypot(srv.pos.x - shown.x, srv.pos.y - shown.y)).toBeLessThan(0.05);
    // 공격 → 바로 attack 사건(내 동작)
    const evs: SimEvent[] = [];
    session.onEvents = (e) => evs.push(...e);
    session.queueAttack(null);
    await frames(20);
    expect(evs.some((e) => e.type === 'attack' && e.unitId === session.playerId)).toBe(true);

    // 연결 끊기 → 자동 재연결 → 같은 자리, 같은 세션으로 다시 맞춤
    const guestId = guest.playerId;
    const statuses: string[] = [];
    guest.on('status', (s) => statuses.push(s));
    (guest as unknown as { ws: globalThis.WebSocket }).ws.close();
    for (let i = 0; i < 60 && !(statuses.includes('connected') && session.isStarted); i++) await frames(1);
    await frames(15);
    expect(statuses[0]).toBe('connecting');
    expect(statuses).toContain('connected');
    expect(guest.playerId).toBe(guestId);
    expect(guest.currentSession).toBe(session);
    expect(session.isStarted).toBe(true);
    const hostRoom = host.room as RoomState;
    expect(hostRoom.players.find((p) => p.id === guestId)!.connected).toBe(true);
    // 재연결 뒤에도 이동이 서버에 반영된다
    const before = { ...(server!.rooms.get(room.code)!.match!.sim.getUnit(session.playerId) as Fighter).pos };
    session.controls.move = { x: 0, y: 1 };
    await frames(20);
    const after = (server!.rooms.get(room.code)!.match!.sim.getUnit(session.playerId) as Fighter).pos;
    expect(after.y - before.y).toBeGreaterThan(0.3);

    // ping
    expect(guest.pingMs).toBeGreaterThanOrEqual(0);
    const ended = new Promise<MatchResult>((r) => host.on('matchEnd', r));
    void ended;
    session.dispose();
    expect(guest.currentSession).toBeNull();
  }, 20_000);
});
