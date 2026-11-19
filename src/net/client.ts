import type { FighterId } from '../data/fighters';
import type { Team } from '../game/types';
import { getToken } from './account';
import type { OnlineClient, OnlineEvents, OnlineStatus } from './api';
import { OnlineSession, type OnlineSessionOptions, type SessionTransport } from './onlineSession';
import { PROTOCOL_VERSION, type ClientMsg, type MatchStartInfo, type RoomState, type ServerMsg } from './protocol';

/**
 * 온라인 클라이언트(OnlineClient 구현). Network 담당. UI는 createOnlineClient()만 쓴다.
 *
 * - connect: 웹소켓 연결 → hello(로그인했으면 토큰 포함, 서버가 계정 이름을 쓴다) → welcome을 받으면 끝(실패하면 reject, 자동 재시도 안 함).
 * - 연결된 뒤 끊기면 자동 재연결(0.5초~5초 간격, 약 30초). 방에 있었으면 같은 이름으로 그 방에 다시 들어가
 *   같은 자리(playerId)를 이어받고, 경기 중이면 같은 세션으로 다시 맞춘다(resync).
 * - createRoom / joinRoom은 다음 room(성공) 또는 error(실패, OnlineError.code = 서버 오류 코드)로 끝난다.
 *   이렇게 promise로 돌려준 오류는 'error' 이벤트로 또 알리지 않는다.
 * - 핑: 2초마다 ping/pong으로 왕복 지연을 잰다. 6초 동안 아무것도 못 받으면 끊긴 것으로 보고 다시 연결한다.
 */

export class OnlineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OnlineError';
  }
}

type WebSocketCtor = new (url: string) => WebSocket;

export interface OnlineClientOptions {
  /** 기본 globalThis.WebSocket */
  WebSocketImpl?: WebSocketCtor;
  /** 경기 세션 만들기(테스트에서 3D 없이 쓸 때 바꾼다) */
  createSession?: (info: MatchStartInfo, playerId: string, transport: SessionTransport) => OnlineSession;
  sessionOptions?: OnlineSessionOptions;
  pingIntervalMs?: number;
  requestTimeoutMs?: number;
  /** 이 시간(ms) 동안 아무 메시지도 없으면 끊긴 것으로 본다 */
  staleMs?: number;
  /** 재연결 간격(ms). 다 쓰면 포기 */
  reconnectDelaysMs?: number[];
  /** 로그인 토큰(hello에 싣는다). 기본: account.ts의 저장된 토큰. 없으면 게스트 */
  getToken?: () => string | null;
}

type Listeners = { [K in keyof OnlineEvents]?: Set<(v: OnlineEvents[K]) => void> };

interface PendingRequest {
  resolve: (room: RoomState) => void;
  reject: (err: OnlineError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_RECONNECT = [500, 1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class OnlineClientImpl implements OnlineClient {
  status: OnlineStatus = 'disconnected';
  playerId: string | null = null;
  room: RoomState | null = null;
  pingMs = 0;

  private ws: WebSocket | null = null;
  private generation = 0;
  private url = '';
  private name = 'PLAYER';
  private fighterId: FighterId = 'rivet';
  /** 사용자가 연결을 원한다(끊기면 자동 재연결) */
  private wanted = false;
  /** 이번 소켓에서 hello에 대한 welcome을 받았는가 */
  private welcomed = false;
  /** connect() 이후 한 번이라도 연결됐는가(첫 연결 실패는 재시도하지 않는다) */
  private everConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private connectWaiter: { resolve: () => void; reject: (e: OnlineError) => void } | null = null;
  private pending: PendingRequest | null = null;
  /** 재연결 뒤 다시 들어갈 방과, 그 방에서의 내 이름(겹치면 서버가 숫자를 붙인다) */
  private roomCode: string | null = null;
  private roomName: string | null = null;
  private rejoining = false;
  private session: OnlineSession | null = null;
  private readonly listeners: Listeners = {};
  private readonly opts: Required<Omit<OnlineClientOptions, 'WebSocketImpl' | 'createSession' | 'sessionOptions'>> &
    Pick<OnlineClientOptions, 'WebSocketImpl' | 'createSession' | 'sessionOptions'>;


  constructor(opts: OnlineClientOptions = {}) {
    this.opts = {
      pingIntervalMs: 2000,
      requestTimeoutMs: 8000,
      staleMs: 6000,
      reconnectDelaysMs: DEFAULT_RECONNECT,
      getToken,
      ...opts,
    };
  }

  /** 지금 진행 중인 경기 세션(없으면 null) */
  get currentSession(): OnlineSession | null {
    return this.session;
  }

  // ───────────── 연결 ─────────────

  connect(url: string, name: string, fighterId: FighterId): Promise<void> {
    this.shutdownSocket();
    this.clearReconnect();
    this.rejectConnectWaiter(new OnlineError('superseded', 'A new connection was started.'));
    this.url = url;
    this.name = name;
    this.fighterId = fighterId;
    this.wanted = true;
    this.everConnected = false;
    this.reconnectAttempt = 0;
    this.roomCode = null;
    this.roomName = null;
    this.setRoom(null);
    return new Promise<void>((resolve, reject) => {
      this.connectWaiter = { resolve, reject };
      this.open();
    });
  }

  disconnect() {
    this.wanted = false;
    this.clearReconnect();
    this.shutdownSocket();
    this.rejectConnectWaiter(new OnlineError('disconnected', 'Disconnected.'));
    this.rejectPending(new OnlineError('disconnected', 'Disconnected.'));
    this.roomCode = null;
    this.roomName = null;
    this.playerId = null;
    this.session = null;
    this.setRoom(null);
    this.setStatus('disconnected');
  }

  private open() {
    const gen = ++this.generation;
    this.welcomed = false;
    this.setStatus('connecting');
    const Ctor = this.opts.WebSocketImpl ?? (globalThis.WebSocket as WebSocketCtor | undefined);
    let ws: WebSocket;
    try {
      if (!Ctor) throw new Error('WebSocket is not available');
      ws = new Ctor(this.url);
    } catch (err) {
      this.wanted = false;
      this.setStatus('disconnected');
      this.rejectConnectWaiter(new OnlineError('bad_url', `Cannot connect to ${this.url}: ${(err as Error).message}`));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return;
      this.lastMessageAt = now();
      const token = this.opts.getToken();
      this.sendNow({
        t: 'hello',
        v: PROTOCOL_VERSION,
        name: this.roomName ?? this.name,
        fighterId: this.fighterId,
        ...(token ? { token } : {}),
      });
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      this.lastMessageAt = now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (gen !== this.generation) return;
      this.onSocketGone();
    };
    ws.onerror = () => {
      /* onclose가 뒤따른다 */
    };
  }

  /** 소켓을 닫고 이후 이벤트는 무시한다 */
  private shutdownSocket() {
    this.generation++;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* 무시 */
      }
    }
  }

  private onSocketGone() {
    this.shutdownSocket();
    this.rejectPending(new OnlineError('disconnected', 'Connection lost.'));
    if (!this.everConnected) {
      this.wanted = false;
      this.setStatus('disconnected');
      this.rejectConnectWaiter(new OnlineError('connect_failed', `Cannot reach the server (${this.url}).`));
      return;
    }
    if (!this.wanted) {
      this.setStatus('disconnected');
      return;
    }
    const delays = this.opts.reconnectDelaysMs;
    if (this.reconnectAttempt >= delays.length) {
      this.wanted = false;
      this.roomCode = null;
      this.roomName = null;
      this.session = null;
      this.setRoom(null);
      this.setStatus('disconnected');
      this.emit('error', { code: 'connection_lost', message: 'Lost connection to the server.' });
      return;
    }
    this.setStatus('connecting');
    const delay = delays[this.reconnectAttempt++]!;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.open();
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // ───────────── 받기 ─────────────

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome': {
        this.playerId = msg.playerId;
        if (this.welcomed) return; // 재접속으로 자리를 이어받았다(playerId만 바뀐다)
        this.welcomed = true;
        this.everConnected = true;
        this.reconnectAttempt = 0;
        this.setStatus('connected');
        this.startPing();
        const w = this.connectWaiter;
        this.connectWaiter = null;
        w?.resolve();
        if (this.roomCode) {
          this.rejoining = true;
          this.sendNow({ t: 'join', code: this.roomCode });
        }
        return;
      }
      case 'room': {
        this.rejoining = false;
        const me = msg.room.players.find((p) => p.id === this.playerId);
        this.roomCode = msg.room.code;
        if (me) this.roomName = me.name;
        this.setRoom(msg.room);
        const p = this.takePending();
        p?.resolve(msg.room);
        return;
      }
      case 'start':
        this.onStart(msg.match);
        return;
      case 'snap':
        this.session?.receiveSnap(msg.snap);
        return;
      case 'end':
        this.session?.end(msg.result);
        this.emit('matchEnd', msg.result);
        return;
      case 'pong': {
        this.pingMs = Math.max(0, Math.round(now() - msg.at));
        this.emit('ping', this.pingMs);
        return;
      }
      case 'error': {
        const err = new OnlineError(msg.code, msg.message);
        if (msg.code === 'bad_version') this.wanted = false;
        if (this.rejoining) {
          // 재접속했는데 방이 없어졌거나 들어갈 수 없다
          this.rejoining = false;
          this.roomCode = null;
          this.roomName = null;
          this.session = null;
          this.setRoom(null);
        }
        const p = this.takePending();
        if (p) p.reject(err);
        else this.emit('error', { code: msg.code, message: msg.message });
        return;
      }
    }
  }

  private onStart(info: MatchStartInfo) {
    const s = this.session;
    if (s && !s.disposed && sameMatch(s.info, info)) {
      s.resync();
      return;
    }
    const isConnected = () => this.status === 'connected';
    const transport: SessionTransport = {
      send: (m) => this.sendNow(m),
      get connected() {
        return isConnected();
      },
    };
    const playerId = this.playerId ?? '';
    const session = this.opts.createSession
      ? this.opts.createSession(info, playerId, transport)
      : new OnlineSession(info, playerId, transport, this.opts.sessionOptions);
    session.onDispose = () => {
      if (this.session === session) this.session = null;
    };
    this.session = session;
    this.emit('matchStart', { info, session });
  }

  // ───────────── 방 ─────────────

  createRoom(): Promise<RoomState> {
    return this.request({ t: 'create' });
  }

  joinRoom(code: string): Promise<RoomState> {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return Promise.reject(new OnlineError('room_not_found', 'Room codes are 4 letters.'));
    return this.request({ t: 'join', code: c });
  }

  leaveRoom() {
    if (this.status === 'connected') this.sendNow({ t: 'leave' });
    this.roomCode = null;
    this.roomName = null;
    this.session = null;
    this.setRoom(null);
  }

  setFighter(fighterId: FighterId) {
    this.fighterId = fighterId;
    this.sendIfConnected({ t: 'setFighter', fighterId });
  }

  setTeam(team: Team) {
    this.sendIfConnected({ t: 'setTeam', team });
  }

  setFillBots(fill: boolean) {
    this.sendIfConnected({ t: 'setBots', fillBots: fill });
  }

  setReady(ready: boolean) {
    this.sendIfConnected({ t: 'ready', ready });
  }

  startMatch() {
    this.sendIfConnected({ t: 'start' });
  }

  on<K extends keyof OnlineEvents>(event: K, cb: (v: OnlineEvents[K]) => void): () => void {
    let set = this.listeners[event] as Set<(v: OnlineEvents[K]) => void> | undefined;
    if (!set) {
      set = new Set();
      (this.listeners as Record<string, unknown>)[event] = set;
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  // ───────────── 도우미 ─────────────

  private request(msg: ClientMsg): Promise<RoomState> {
    if (this.status !== 'connected') return Promise.reject(new OnlineError('not_connected', 'Not connected to the server.'));
    this.rejectPending(new OnlineError('superseded', 'Another request was made.'));
    return new Promise<RoomState>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return;
        this.pending = null;
        reject(new OnlineError('timeout', 'The server did not answer.'));
      }, this.opts.requestTimeoutMs);
      this.pending = { resolve, reject, timer };
      this.sendNow(msg);
    });
  }

  private takePending(): PendingRequest | null {
    const p = this.pending;
    this.pending = null;
    if (p) clearTimeout(p.timer);
    return p;
  }

  private rejectPending(err: OnlineError) {
    this.takePending()?.reject(err);
  }

  private rejectConnectWaiter(err: OnlineError) {
    const w = this.connectWaiter;
    this.connectWaiter = null;
    w?.reject(err);
  }

  private sendIfConnected(msg: ClientMsg) {
    if (this.status === 'connected') this.sendNow(msg);
  }

  private sendNow(msg: ClientMsg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 끊기는 중 */
    }
  }

  private startPing() {
    this.stopPing();
    const ping = () => {
      if (now() - this.lastMessageAt > this.opts.staleMs) {
        // 반쯤 열린 연결(와이파이 전환 등): 닫힘을 기다리지 않고 바로 다시 연결
        this.onSocketGone();
        return;
      }
      this.sendNow({ t: 'ping', at: now() });
    };
    ping();
    this.pingTimer = setInterval(ping, this.opts.pingIntervalMs);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(s: OnlineStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private setRoom(room: RoomState | null) {
    if (room === null && this.room === null) return;
    this.room = room;
    this.emit('room', room);
  }

  private emit<K extends keyof OnlineEvents>(event: K, v: OnlineEvents[K]) {
    const set = this.listeners[event] as Set<(v: OnlineEvents[K]) => void> | undefined;
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(v);
      } catch (err) {
        console.error(`[online] ${String(event)} listener failed`, err);
      }
    }
  }
}

function sameMatch(a: MatchStartInfo, b: MatchStartInfo): boolean {
  return a.seed === b.seed && a.mapId === b.mapId && a.roster.length === b.roster.length;
}

/** UI가 쓰는 온라인 클라이언트를 만든다 */
export function createOnlineClient(opts: OnlineClientOptions = {}): OnlineClient {
  return new OnlineClientImpl(opts);
}
