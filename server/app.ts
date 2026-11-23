import { isRankedMatch } from '../src/data/ranks';
/**
 * 게임 서버: HTTP(GET /health) + 같은 포트의 웹소켓. Network 담당.
 * 메시지 형식은 src/net/protocol.ts(계약). 방 규칙은 rooms.ts, 경기는 match.ts.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, type ClientMsg, type MatchResult, type ServerMsg } from '../src/net/protocol';
import type { FighterId } from '../src/data/fighters';
import { AccountStore, RateLimiter, defaultDataDir, type AccountResult } from './accounts';
import { DEFAULT_API_ORIGINS, handleApi } from './api';
import { Match, type MatchConfig } from './match';
import { Room, RoomManager, sanitizeName, type RoomError } from './rooms';
import { parseClientMsg } from './validate';

export interface ServerOptions {
  /** 0이면 빈 포트 아무거나 */
  port?: number;
  host?: string;
  /** 허용할 Origin(브라우저 페이지 주소). 비우면 모두 허용 */
  allowedOrigins?: string[];
  /** 경기 시작 전 준비 시간(ms) */
  startDelayMs?: number;
  /** 로비에서 끊긴 사람을 내보내기까지(ms) */
  lobbyGraceMs?: number;
  /** 경기 중 연결된 사람이 하나도 없을 때 경기를 접기까지(ms) */
  emptyRoomGraceMs?: number;
  /** 이 시간(ms) 동안 아무것도 못 받으면 연결을 끊는다(반쯤 열린 연결 정리) */
  silentMs?: number;
  /** 계정 파일 폴더(기본: DATA_DIR → /data → ./.data) */
  dataDir?: string;
  /** 계정 저장소를 직접 넘길 때(테스트) */
  accounts?: AccountStore;
  /** 계정 API CORS 허용 주소(localhost는 항상 허용). 기본 https://vitamindu.github.io */
  apiOrigins?: string[];
  /** 로그인 실패 제한(테스트용으로 줄일 수 있다) */
  rateLimiter?: RateLimiter;
  /** 웹소켓 압축(permessage-deflate) */
  compress?: boolean;
  /** 경기 설정 덮어쓰기(테스트용: maxTicks 등) */
  match?: Partial<Pick<MatchConfig, 'maxTicks' | 'snapshotEvery' | 'inputQueue'>>;
  log?: (msg: string) => void;
}

export interface RunningServer {
  readonly port: number;
  readonly rooms: RoomManager;
  readonly accounts: AccountStore;
  /** 상태 요약(/health와 같은 값) */
  health(): Record<string, unknown>;
  /** 연결별 보낸 바이트(측정용) */
  traffic(): { playerId: string | null; bytesOut: number; messagesOut: number }[];
  close(): Promise<void>;
}

type ErrorCode = Extract<ServerMsg, { t: 'error' }>['code'];

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_version: 'Client version is not supported. Please refresh the page.',
  room_not_found: 'No room with that code.',
  room_full: 'That room or team is full.',
  not_host: 'Only the host can do that.',
  in_progress: 'A match is in progress.',
  bad_message: 'Bad message.',
};

/** 연결 하나 */
class Conn {
  id: string | null = null;
  name = '플레이어';
  /** 로그인한 계정 키(hello의 토큰으로 확인). 게스트는 null */
  account: string | null = null;
  fighterId: FighterId = 'rivet';
  room: Room | null = null;
  /** 마지막으로 무언가 받은 시각(ms) */
  lastSeen = Date.now();
  bytesOut = 0;
  messagesOut = 0;
  private windowStart = Date.now();
  private windowCount = 0;

  constructor(readonly ws: WebSocket) {}

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ServerMsg) {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(data: string) {
    if (!this.open) return;
    this.bytesOut += Buffer.byteLength(data);
    this.messagesOut++;
    this.ws.send(data);
  }

  error(code: ErrorCode, message = ERROR_TEXT[code]) {
    this.send({ t: 'error', code, message });
  }

  /** 초당 메시지 수 제한(입력 30회/초 + 여유) */
  rateOk(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    return ++this.windowCount <= 120;
  }
}

const newPlayerId = () => 'p' + randomBytes(6).toString('base64url');

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const rooms = new RoomManager();
  const conns = new Set<Conn>();
  const byPlayer = new Map<string, Conn>();
  const startedAt = Date.now();
  const startDelayMs = opts.startDelayMs ?? 1500;
  const lobbyGraceMs = opts.lobbyGraceMs ?? 20_000;
  const emptyRoomGraceMs = opts.emptyRoomGraceMs ?? 30_000;
  const silentMs = opts.silentMs ?? 10_000;
  const allowed = (opts.allowedOrigins ?? []).filter(Boolean);
  const accounts = opts.accounts ?? new AccountStore(opts.dataDir ?? defaultDataDir(), Date.now, log);
  const limiter = opts.rateLimiter ?? new RateLimiter();
  /** 친구 목록용: 계정이 지금 연결돼 있는가, 방에 있는가 */
  const presence = (account: string) => {
    let online = false;
    let inRoom = false;
    for (const c of conns) {
      if (c.account !== account || !c.open) continue;
      online = true;
      if (c.room) inRoom = true;
    }
    return { online, inRoom };
  };
  const apiDeps = { store: accounts, limiter, allowedOrigins: opts.apiOrigins ?? DEFAULT_API_ORIGINS, log, presence };
  log(`accounts: ${accounts.size} in ${accounts.dir}`);

  const health = () => {
    let playing = 0;
    for (const r of rooms.rooms.values()) if (r.phase === 'playing') playing++;
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      rooms: rooms.rooms.size,
      playing,
      connections: conns.size,
      accounts: accounts.size,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
  };

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (handleApi(req, res, apiDeps)) return;
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(health()));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({
    server: http,
    maxPayload: 4096,
    perMessageDeflate: opts.compress === false ? false : { threshold: 512, zlibDeflateOptions: { level: 3 } },
    verifyClient: allowed.length ? (info: { origin: string }) => allowed.includes(info.origin) : undefined,
  });

  // ───────────── 방 도우미 ─────────────

  const isInRoom = (pid: string, room: Room) => {
    const c = byPlayer.get(pid);
    return !!c && c.room === room && c.open;
  };

  const broadcastRoom = (room: Room) => {
    const msg = JSON.stringify({ t: 'room', room: room.toState() } satisfies ServerMsg);
    for (const m of room.members) if (m.connected) byPlayer.get(m.id)?.sendRaw(msg);
  };

  const deleteRoom = (room: Room, why: string) => {
    rooms.delete(room.code);
    log(`room ${room.code} closed (${why})`);
  };

  const sendErr = (c: Conn, e: RoomError | null): boolean => {
    if (!e) return false;
    c.error(e);
    return true;
  };

  /** 로그인한 사람의 트로피·코인 반영(중간에 나간 사람 포함, 게스트·봇 제외) */
  const applyResults = (match: Match | null, result: MatchResult) => {
    if (!match) return;
    const accountOf = new Map<string, string>();
    const list: AccountResult[] = [];
    for (const h of match.humans) {
      const account = match.accounts.get(h.playerId);
      if (!account) continue;
      const outcome = result.winner === -1 ? 'draw' : result.winner === h.team ? 'win' : 'loss';
      const mates = result.stats
        .filter((s) => s.team === h.team)
        .sort((a, b) => b.damage - a.damage || b.kills - a.kills);
      const place = Math.max(0, mates.findIndex((s) => s.playerId === h.playerId));
      list.push({ account, fighterId: h.fighterId, outcome, place, teamSize: mates.length });
      accountOf.set(h.playerId, account);
    }
    try {
      const per: [number, number] = [0, 0];
      for (const h of match.humans) per[h.team]++;
      result.ranked = isRankedMatch(per);
      const ranks = accounts.applyMatchResults(list, result.ranked);
      for (const s of result.stats) {
        const acc = accountOf.get(s.playerId);
        const rk = acc ? ranks.get(acc) : undefined;
        if (rk) Object.assign(s, rk);
      }
    } catch (err) {
      log(`apply results failed: ${(err as Error)?.stack ?? String(err)}`);
    }
  };

  const endMatch = (room: Room, result: MatchResult) => {
    const match = room.match;
    room.match = null;
    applyResults(match, result); // 랭크 점수를 결과에 담은 뒤 보낸다
    const end = JSON.stringify({ t: 'end', result } satisfies ServerMsg);
    for (const m of room.members) if (m.connected) byPlayer.get(m.id)?.sendRaw(end);
    room.phase = 'lobby';
    for (const m of room.members) m.ready = false;
    // 경기 중 끊긴 채 돌아오지 않은 사람은 정리
    for (const m of [...room.members]) if (!m.connected) room.remove(m.id);
    log(`room ${room.code} match end: winner ${result.winner}, score ${result.score.join(':')}, ticks ${match?.sim.tick ?? '?'}`);
    if (room.members.length === 0) {
      deleteRoom(room, 'empty after match');
      return;
    }
    broadcastRoom(room);
  };

  const startMatch = (room: Room) => {
    const seed = randomInt(1, 2 ** 31 - 1);
    const match = new Match(
      { seed, mapId: room.mapId, mode: room.mode, roster: room.rosterSeeds().map((r) => (r.account ? { ...r, skin: accounts.skinFor(r.account, r.fighterId) } : r)), ...opts.match },
      {
        send: (pid, data) => {
          const c = byPlayer.get(pid);
          if (c && c.room === room) c.sendRaw(data);
        },
        isConnected: (pid) => isInRoom(pid, room),
        onEnd: (result) => endMatch(room, result),
        onError: (err) => log(`room ${room.code} tick error: ${(err as Error)?.stack ?? String(err)}`),
      },
    );
    room.match = match;
    room.phase = 'playing';
    const start = JSON.stringify({ t: 'start', match: match.info } satisfies ServerMsg);
    for (const m of room.members) if (m.connected) byPlayer.get(m.id)?.sendRaw(start);
    broadcastRoom(room);
    match.start(startDelayMs);
    log(`room ${room.code} match start: ${match.info.roster.length} fighters (${match.humans.length} human)`);
  };

  const leaveRoom = (c: Conn) => {
    const room = c.room;
    if (!room || !c.id) return;
    c.room = null;
    room.remove(c.id);
    if (room.members.length === 0) {
      deleteRoom(room, 'everyone left');
      return;
    }
    broadcastRoom(room);
  };

  /** 다른 연결(또는 끊긴 자리)의 playerId를 이 연결이 이어받는다 */
  const takeOver = (c: Conn, room: Room, memberId: string) => {
    const old = byPlayer.get(memberId);
    if (old && old !== c) {
      old.room = null;
      old.id = null;
      old.ws.terminate();
    }
    if (c.id && byPlayer.get(c.id) === c) byPlayer.delete(c.id);
    c.id = memberId;
    byPlayer.set(memberId, c);
    c.room = room;
    const m = room.get(memberId)!;
    c.name = m.name;
    room.setConnected(memberId, true);
    c.send({ t: 'welcome', playerId: memberId, v: PROTOCOL_VERSION });
    broadcastRoom(room);
    if (room.phase === 'playing' && room.match) {
      room.match.resetInput(memberId);
      c.send({ t: 'start', match: room.match.info });
    }
    log(`room ${room.code}: ${m.name} reconnected`);
  };

  // ───────────── 메시지 처리 ─────────────

  const handle = (c: Conn, msg: ClientMsg) => {
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        c.error('bad_version');
        c.ws.close(4000, 'bad_version');
        return;
      }
      if (!c.room) {
        c.fighterId = msg.fighterId;
        // 토큰이 맞으면 계정 이름, 아니면(없음·만료) 게스트
        const key = msg.token ? accounts.verify(msg.token) : null;
        c.account = key;
        c.name = key ? (accounts.nickname(key) ?? sanitizeName(msg.name)) : sanitizeName(msg.name);
      }
      if (!c.id) {
        c.id = newPlayerId();
        byPlayer.set(c.id, c);
      }
      c.send({ t: 'welcome', playerId: c.id, v: PROTOCOL_VERSION });
      return;
    }
    if (!c.id) {
      c.error('bad_message', 'Say hello first.');
      return;
    }
    if (msg.t === 'ping') {
      c.send({ t: 'pong', at: msg.at, serverTick: c.room?.match?.sim.tick ?? 0 });
      return;
    }
    if (msg.t === 'input') {
      if (c.room?.match) c.room.match.pushInput(c.id, msg);
      return;
    }
    if (msg.t === 'setFighter' && !c.room) {
      // 방에 들어가기 전에 고른 캐릭터: 다음 create/join에 쓴다
      c.fighterId = msg.fighterId;
      return;
    }
    if (msg.t === 'create') {
      if (c.room) leaveRoom(c);
      const room = rooms.create();
      const m = room.add(c.id, c.name, c.fighterId, Date.now(), c.account);
      if (typeof m === 'string') {
        rooms.delete(room.code);
        c.error(m);
        return;
      }
      c.room = room;
      c.name = m.name;
      log(`room ${room.code} created by ${m.name}`);
      broadcastRoom(room);
      return;
    }
    if (msg.t === 'join') {
      const room = rooms.get(msg.code);
      if (!room) {
        c.error('room_not_found');
        return;
      }
      if (c.room === room && room.get(c.id)) {
        c.send({ t: 'room', room: room.toState() });
        return;
      }
      const again = room.findReconnect(c.name, c.account);
      if (again) {
        if (c.room) leaveRoom(c);
        takeOver(c, room, again.id);
        return;
      }
      const m = room.add(c.id, c.name, c.fighterId, Date.now(), c.account);
      if (typeof m === 'string') {
        c.error(m);
        return;
      }
      if (c.room) leaveRoom(c);
      c.room = room;
      c.name = m.name;
      log(`room ${room.code}: ${m.name} joined (${room.members.length})`);
      broadcastRoom(room);
      return;
    }
    const room = c.room;
    if (!room) {
      c.error('room_not_found', 'You are not in a room.');
      return;
    }
    switch (msg.t) {
      case 'leave':
        leaveRoom(c);
        return;
      case 'setFighter':
        c.fighterId = msg.fighterId;
        if (!sendErr(c, room.setFighter(c.id, msg.fighterId))) broadcastRoom(room);
        return;
      case 'setTeam':
        if (!sendErr(c, room.setTeam(c.id, msg.team))) broadcastRoom(room);
        return;
      case 'setBots':
        if (!sendErr(c, room.setFillBots(c.id, msg.fillBots))) broadcastRoom(room);
        return;
      case 'setMode':
        if (!sendErr(c, room.setMode(c.id, msg.mode))) broadcastRoom(room);
        return;
      case 'ready':
        if (!sendErr(c, room.setReady(c.id, msg.ready))) broadcastRoom(room);
        return;
      case 'start':
        if (!sendErr(c, room.canStart(c.id))) startMatch(room);
        return;
    }
  };

  wss.on('connection', (ws) => {
    const c = new Conn(ws);
    conns.add(c);
    ws.on('pong', () => {
      c.lastSeen = Date.now();
    });
    ws.on('message', (data, isBinary) => {
      c.lastSeen = Date.now();
      if (isBinary || !c.rateOk()) {
        if (!isBinary) ws.close(1008, 'rate limit');
        return;
      }
      const msg = parseClientMsg(data.toString());
      if (!msg) {
        c.error('bad_message');
        return;
      }
      try {
        handle(c, msg);
      } catch (err) {
        log(`handler error: ${(err as Error)?.stack ?? String(err)}`);
      }
    });
    ws.on('close', () => {
      conns.delete(c);
      if (c.id && byPlayer.get(c.id) === c) byPlayer.delete(c.id);
      const room = c.room;
      if (room && c.id) {
        room.setConnected(c.id, false);
        log(`room ${room.code}: ${c.name} disconnected`);
        broadcastRoom(room);
      }
    });
    ws.on('error', () => {
      /* close가 뒤따른다 */
    });
  });

  // 끊긴 연결 감지: silentMs 동안 아무것도(메시지·pong) 없으면 끊는다. 클라이언트는 2초마다 ping을 보낸다
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.lastSeen > silentMs) {
        c.ws.terminate();
        continue;
      }
      try {
        c.ws.ping();
      } catch {
        /* 무시 */
      }
    }
  }, 4_000);
  const sweeper = setInterval(() => {
    const now = Date.now();
    limiter.sweep();
    for (const room of [...rooms.rooms.values()]) {
      const gone = room.sweepDisconnected(now, lobbyGraceMs);
      if (room.members.length === 0) {
        deleteRoom(room, 'everyone disconnected');
        continue;
      }
      if (room.emptySince !== null && now - room.emptySince >= emptyRoomGraceMs) {
        deleteRoom(room, 'nobody connected');
        continue;
      }
      if (gone.length) broadcastRoom(room);
    }
  }, 2_000);

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 8787, opts.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    rooms,
    accounts,
    health,
    traffic: () => [...conns].map((c) => ({ playerId: c.id, bytesOut: c.bytesOut, messagesOut: c.messagesOut })),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        clearInterval(sweeper);
        for (const room of rooms.rooms.values()) room.match?.stop();
        for (const c of conns) c.ws.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
