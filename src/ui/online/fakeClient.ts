import { FIGHTERS, type FighterId } from '../../data/fighters';
import type { Team } from '../../game/types';
import type { OnlineClient, OnlineEvents, OnlineStatus } from '../../net/api';
import type { MatchResult, MatchStartInfo, PlayerStats, RoomPlayer, RoomState } from '../../net/protocol';
import { FakeOnlineSession } from './fakeSession';

/**
 * 메모리 안의 가짜 온라인 서버(주소에 ?fakeonline일 때만, ui/online/clientFactory.ts).
 * 서버 없이 온라인 화면을 모두 열어 보고 스크린샷을 찍기 위한 것이다. 실제 동작 흉내:
 * - 연결 0.6초, 핑 2초마다. 서버 주소에 "fail"이 들어 있으면 연결 실패.
 * - 방 만들기: 친구 둘이 차례로 들어와 잠시 뒤 준비. 코드로 들어가기: "NOPE" → 방 없음, "FULL" → 꽉 참.
 * - 방장 START → 2분 30초 경기(?fakeonline=short 이면 40초) → 결과 → 다시 방.
 * 콘솔/E2E 레버: window.__fgFakeOnline.finishMatch(demo), .dropConnection(), .emitError(code)
 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const FRIENDS: { name: string; fighterId: FighterId }[] = [
  { name: 'MOCHI', fighterId: 'volley' },
  { name: 'PIXEL', fighterId: 'boulder' },
  { name: 'JUNO', fighterId: 'hinako' },
];
const ME = 'me';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Listeners = { [K in keyof OnlineEvents]?: Set<(v: OnlineEvents[K]) => void> };

export interface FakeOnlineClient extends OnlineClient {
  finishMatch(demo?: boolean): void;
  dropConnection(): void;
  emitError(code: string): void;
}

export function createFakeOnlineClient(): FakeOnlineClient {
  let status: OnlineStatus = 'disconnected';
  let room: RoomState | null = null;
  let pingMs = 0;
  let pingTimer = 0;
  let name = 'PLAYER';
  let fighterId: FighterId = 'rivet';
  let session: FakeOnlineSession | null = null;
  const timers = new Set<number>();
  const listeners: Listeners = {};
  const short = new URLSearchParams(location.search).get('fakeonline') === 'short';

  const emit = <K extends keyof OnlineEvents>(k: K, v: OnlineEvents[K]) => {
    for (const cb of [...((listeners[k] as Set<(v: OnlineEvents[K]) => void>) ?? [])]) cb(v);
  };
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const setStatus = (s: OnlineStatus) => {
    status = s;
    emit('status', s);
  };
  const me = () => room?.players.find((p) => p.id === ME) ?? null;
  const publish = () => {
    if (!room) return;
    refillBots(room);
    room = { ...room, players: room.players.map((p) => ({ ...p })) };
    emit('room', room);
  };
  const humans = (r: RoomState, team?: Team) => r.players.filter((p) => !p.bot && (team === undefined || p.team === team));

  /** fillBots면 팀마다 3명이 되도록 봇을 넣고, 아니면 봇을 뺀다 */
  function refillBots(r: RoomState) {
    r.players = r.players.filter((p) => !p.bot);
    if (!r.fillBots) return;
    for (const team of [0, 1] as Team[]) {
      let n = humans(r, team).length;
      let i = 0;
      while (n < 3) {
        const f = FIGHTERS[(team * 2 + i) % FIGHTERS.length]!;
        r.players.push({
          id: `bot-${team}-${i}`,
          name: `봇 ${f.name}`,
          fighterId: f.id,
          team,
          ready: true,
          host: false,
          connected: true,
          bot: true,
        });
        n++;
        i++;
      }
    }
  }

  function friend(i: number, team: Team, host = false, ready = false): RoomPlayer {
    const f = FRIENDS[i]!;
    return { id: `friend-${i}`, name: f.name, fighterId: f.fighterId, team, ready, host, connected: true, bot: false };
  }

  function makeCode() {
    return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  }

  function guard() {
    if (status !== 'connected') throw Object.assign(new Error('not connected'), { code: 'not_connected' });
  }

  function fail(code: string, message: string): never {
    emit('error', { code, message });
    throw Object.assign(new Error(message), { code });
  }

  function startMatch() {
    if (!room) return;
    const r = room;
    room = { ...r, phase: 'playing' };
    emit('room', room);
    const roster = r.players.map((p, i) => ({ playerId: p.id, entityId: i + 1, name: p.name, team: p.team, fighterId: p.fighterId, bot: p.bot }));
    const info: MatchStartInfo = { seed: Math.floor(Math.random() * 1e6), mapId: r.mapId, mode: r.mode, roster, tickRate: 30, snapshotEvery: 2 };
    later(350, () => {
      const mine = roster.find((x) => x.playerId === ME)!;
      const s = new FakeOnlineSession(info, mine.entityId, short ? 40 : 150);
      session = s;
      s.onFinish = (match, stats) => {
        const result: MatchResult = {
          winner: match.winner ?? -1,
          score: [...match.score] as [number, number],
          stats: roster.map<PlayerStats>((x) => ({
            playerId: x.playerId,
            name: x.name,
            fighterId: x.fighterId,
            team: x.team,
            kills: stats.get(x.entityId)?.kills ?? 0,
            deaths: stats.get(x.entityId)?.deaths ?? 0,
            damage: Math.round(stats.get(x.entityId)?.damage ?? 0),
          })),
        };
        later(1500, () => {
          session = null;
          emit('matchEnd', result);
          if (room) {
            room = { ...room, phase: 'lobby', players: room.players.map((p) => ({ ...p, ready: p.bot })) };
            publish();
            // 친구들은 잠시 뒤 다시 준비
            later(2500, () => {
              if (!room) return;
              for (const p of room.players) if (p.id !== ME) p.ready = true;
              publish();
            });
          }
        });
      };
      emit('matchStart', { info, session: s });
    });
  }

  const client: FakeOnlineClient = {
    get status() {
      return status;
    },
    get playerId() {
      return status === 'connected' ? ME : null;
    },
    get room() {
      return room;
    },
    get pingMs() {
      return pingMs;
    },

    async connect(url, n, f) {
      name = n;
      fighterId = f;
      setStatus('connecting');
      await wait(600);
      if (status !== 'connecting') throw new Error('cancelled');
      if (/fail/i.test(url)) {
        setStatus('disconnected');
        throw Object.assign(new Error('could not connect'), { code: 'connect_failed' });
      }
      setStatus('connected');
      pingMs = 38;
      emit('ping', pingMs);
      window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        pingMs = Math.round(30 + Math.random() * 40 + (Math.random() < 0.1 ? 120 : 0));
        emit('ping', pingMs);
      }, 2000);
      // 다시 연결: 방이 남아 있으면 그대로 돌아온다
      const mine = me();
      if (room && mine) {
        mine.connected = true;
        mine.name = name;
        publish();
      }
    },

    disconnect() {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
      window.clearInterval(pingTimer);
      session = null;
      room = null;
      setStatus('disconnected');
      emit('room', null);
    },

    async createRoom() {
      guard();
      await wait(250);
      room = {
        code: makeCode(),
        players: [{ id: ME, name, fighterId, team: 0, ready: false, host: true, connected: true, bot: false }],
        phase: 'lobby',
        mode: 'teamfight',
        mapId: 'blossom-arena',
        fillBots: false,
      };
      publish();
      later(1200, () => {
        if (!room) return;
        room.players.push(friend(0, 1));
        publish();
      });
      later(2200, () => {
        if (!room) return;
        room.players.push(friend(1, 0));
        publish();
      });
      later(3200, () => {
        if (!room) return;
        for (const p of room.players) if (p.id !== ME) p.ready = true;
        publish();
      });
      return room;
    },

    async joinRoom(code) {
      guard();
      await wait(350);
      const c = code.toUpperCase();
      if (c.length !== 4 || c === 'NOPE') fail('room_not_found', 'room not found');
      if (c === 'FULL') fail('room_full', 'room is full');
      room = {
        code: c,
        players: [
          friend(0, 0, true, false),
          friend(2, 1, false, true),
          { id: ME, name, fighterId, team: 1, ready: false, host: false, connected: true, bot: false },
        ],
        phase: 'lobby',
        mode: 'teamfight',
        mapId: 'blossom-arena',
        fillBots: true,
      };
      publish();
      return room;
    },

    leaveRoom() {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
      session = null;
      room = null;
      emit('room', null);
    },

    setFighter(f) {
      fighterId = f;
      const p = me();
      if (p) p.fighterId = f;
      later(60, publish);
    },

    setTeam(team) {
      const p = me();
      if (!room || !p || p.team === team) return;
      if (humans(room, team).length >= 3) return emit('error', { code: 'room_full', message: 'team is full' });
      p.team = team;
      p.ready = false;
      later(60, publish);
    },

    setFillBots(fill) {
      const p = me();
      if (!room || !p?.host) return;
      room.fillBots = fill;
      later(60, publish);
    },

    setMode(mode) {
      const p = me();
      if (!room || !p?.host || room.phase !== 'lobby') return;
      room.mode = mode;
      later(60, publish);
    },

    setReady(ready) {
      const p = me();
      if (!p) return;
      p.ready = ready;
      later(60, publish);
    },

    startMatch() {
      const p = me();
      if (!room || !p) return;
      if (!p.host) return emit('error', { code: 'not_host', message: 'only the host can start' });
      startMatch();
    },

    on(event, cb) {
      let set = listeners[event] as Set<typeof cb> | undefined;
      if (!set) {
        set = new Set();
        (listeners as Record<string, Set<typeof cb>>)[event] = set;
      }
      set.add(cb);
      return () => set.delete(cb);
    },

    finishMatch(demo = false) {
      session?.finish(demo);
    },

    dropConnection() {
      window.clearInterval(pingTimer);
      const p = me();
      if (p) p.connected = false;
      setStatus('disconnected');
    },

    emitError(code) {
      emit('error', { code, message: code });
    },
  };
  return client;
}
