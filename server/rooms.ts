/**
 * 방 규칙(웹소켓과 무관한 순수 로직). Network 담당.
 *
 * - 코드: 대문자 4글자, 헷갈리는 글자(I·L·O·U·V) 제외.
 * - 사람 최대 6명(팀당 3). 들어오면 사람이 적은 팀으로(같으면 팀0).
 * - 방장: 처음 들어온 사람. 방장이 나가거나 연결이 끊기면 가장 먼저 들어온, 연결된 사람에게 넘긴다.
 * - fillBots: 팀마다 3명이 되도록 봇을 채운다(방 목록에 bot=true로 보인다).
 * - 재접속: 같은 이름으로 다시 들어오면 그 자리(같은 playerId)를 이어받는다.
 *   로비에서는 연결이 끊긴 자리만, 경기 중에는 연결된 것처럼 보이는 자리(끊김을 아직 모름)도 이어받는다.
 */
import { randomInt } from 'node:crypto';
import { FIGHTERS, type FighterId } from '../src/data/fighters';
import type { MatchMode, Team } from '../src/game/types';
import type { RoomPlayer, RoomState } from '../src/net/protocol';
import type { Match } from './match';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ';
export const ROOM_CODE_LENGTH = 4;
export const TEAM_SIZE = 3;
export const MAX_PLAYERS = TEAM_SIZE * 2;
export const DEFAULT_MAP_ID = 'blossom-arena';
export const NAME_MAX = 16;

export type RoomError = 'room_full' | 'not_host' | 'in_progress';

export interface Member {
  id: string;
  name: string;
  fighterId: FighterId;
  team: Team;
  ready: boolean;
  connected: boolean;
  /** 들어온 순서(방장 위임 순서) */
  order: number;
  /** 연결이 끊긴 시각(ms). 연결 중이면 null */
  disconnectedAt: number | null;
  /** 로그인한 계정 키(게스트는 null). 재접속은 같은 계정만 이어받는다 */
  account: string | null;
}

/** 경기 명단 재료(서버 Match가 받는다) */
export interface RosterSeed {
  playerId: string;
  name: string;
  team: Team;
  fighterId: FighterId;
  bot: boolean;
  /** 경기 결과를 반영할 계정(게스트·봇은 없음) */
  account?: string | null;
  skin?: string;
}

/** 이름 다듬기: 제어 문자 제거, 공백 정리, 최대 16글자. 비면 '플레이어' */
export function sanitizeName(raw: string): string {
  const s = Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, NAME_MAX)
    .join('')
    .trim();
  return s || '플레이어';
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

const sameName = (a: string, b: string) => a.toLocaleUpperCase() === b.toLocaleUpperCase();

export class Room {
  phase: RoomState['phase'] = 'lobby';
  mode: MatchMode = 'teamfight';
  mapId = DEFAULT_MAP_ID;
  fillBots = false;
  hostId: string | null = null;
  readonly members: Member[] = [];
  match: Match | null = null;
  /** 연결된 사람이 하나도 없게 된 시각(ms). 누군가 연결돼 있으면 null */
  emptySince: number | null = null;
  private order = 0;

  constructor(readonly code: string) {}

  get(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  teamCount(team: Team): number {
    return this.members.filter((m) => m.team === team).length;
  }

  get connectedCount(): number {
    return this.members.filter((m) => m.connected).length;
  }

  /** 새 플레이어 입장. 팀은 자동 배정, 이름이 겹치면 뒤에 숫자를 붙인다 */
  add(id: string, name: string, fighterId: FighterId, now = Date.now(), account: string | null = null): Member | RoomError {
    if (this.phase !== 'lobby') return 'in_progress';
    if (this.members.length >= MAX_PLAYERS) return 'room_full';
    const c0 = this.teamCount(0);
    const c1 = this.teamCount(1);
    const team: Team = c0 <= c1 ? 0 : 1;
    const m: Member = {
      id,
      name: this.uniqueName(sanitizeName(name)),
      fighterId,
      team,
      ready: false,
      connected: true,
      order: this.order++,
      disconnectedAt: null,
      account,
    };
    this.members.push(m);
    this.touch(now);
    this.ensureHost();
    return m;
  }

  /**
   * 재접속 대상 자리. 로비: 끊긴 자리만, 경기 중: 연결 여부와 상관없이.
   * 계정 자리는 같은 계정만, 연결 여부와 상관없이(토큰으로 확인했으므로 다른 탭·반쯤 열린 연결을 대신한다).
   * 게스트 자리는 같은 이름의 게스트만(이름만 같은 게스트가 계정 자리를 가로챌 수 없다).
   */
  findReconnect(name: string, account: string | null = null): Member | undefined {
    if (account) return this.members.find((m) => m.account === account);
    const n = sanitizeName(name);
    return this.members.find((m) => m.account === null && sameName(m.name, n) && (!m.connected || this.phase !== 'lobby'));
  }

  remove(id: string, now = Date.now()): boolean {
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return false;
    this.members.splice(i, 1);
    if (this.hostId === id) this.hostId = null;
    this.touch(now);
    this.ensureHost();
    return true;
  }

  setConnected(id: string, connected: boolean, now = Date.now()) {
    const m = this.get(id);
    if (!m) return;
    m.connected = connected;
    m.disconnectedAt = connected ? null : now;
    if (!connected) m.ready = false;
    this.touch(now);
    this.ensureHost();
  }

  setTeam(id: string, team: Team): RoomError | null {
    const m = this.get(id);
    if (!m) return null;
    if (this.phase !== 'lobby') return 'in_progress';
    if (m.team === team) return null;
    if (this.teamCount(team) >= TEAM_SIZE) return 'room_full';
    m.team = team;
    m.ready = false;
    return null;
  }

  setFighter(id: string, fighterId: FighterId): RoomError | null {
    const m = this.get(id);
    if (!m) return null;
    if (this.phase !== 'lobby') return 'in_progress';
    m.fighterId = fighterId;
    return null;
  }

  setReady(id: string, ready: boolean): RoomError | null {
    const m = this.get(id);
    if (!m) return null;
    if (this.phase !== 'lobby') return 'in_progress';
    m.ready = ready;
    return null;
  }

  /** 방장만: 경기 방식(teamfight | crystal) */
  setMode(id: string, mode: MatchMode): RoomError | null {
    if (id !== this.hostId) return 'not_host';
    if (this.phase !== 'lobby') return 'in_progress';
    if (mode !== 'teamfight' && mode !== 'crystal') return null;
    this.mode = mode;
    return null;
  }

  setFillBots(id: string, fill: boolean): RoomError | null {
    if (id !== this.hostId) return 'not_host';
    if (this.phase !== 'lobby') return 'in_progress';
    this.fillBots = fill;
    return null;
  }

  /** 방장이 시작할 수 있는가(준비 표시는 방장이 참고만 한다) */
  canStart(id: string): RoomError | null {
    if (id !== this.hostId) return 'not_host';
    if (this.phase !== 'lobby') return 'in_progress';
    return null;
  }

  /** 방장이 없거나 연결이 끊겼으면 가장 먼저 들어온, 연결된 사람에게 넘긴다 */
  ensureHost() {
    const host = this.hostId ? this.get(this.hostId) : undefined;
    if (host && host.connected) return;
    const next = [...this.members].filter((m) => m.connected).sort((a, b) => a.order - b.order)[0];
    if (next) this.hostId = next.id;
    else if (!host) this.hostId = null;
  }

  /** 빈자리를 채울 봇(fillBots일 때). 같은 팀 사람과 겹치지 않는 캐릭터부터 고른다 */
  bots(): RosterSeed[] {
    if (!this.fillBots) return [];
    const out: RosterSeed[] = [];
    let n = 1;
    for (const team of [0, 1] as const) {
      const used = new Set<FighterId>(this.members.filter((m) => m.team === team).map((m) => m.fighterId));
      const free = this.members.filter((m) => m.team === team).length;
      for (let slot = free; slot < TEAM_SIZE; slot++) {
        const pick = FIGHTERS.find((f) => !used.has(f.id)) ?? FIGHTERS[(slot + team) % FIGHTERS.length]!;
        used.add(pick.id);
        out.push({ playerId: `bot-${team}-${slot}`, name: `봇 ${n++}`, team, fighterId: pick.id, bot: true });
      }
    }
    return out;
  }

  /** 경기 명단 재료: 팀0 → 팀1, 팀 안에서는 사람(들어온 순서) → 봇 */
  rosterSeeds(): RosterSeed[] {
    const humans = [...this.members].sort((a, b) => a.order - b.order);
    const bots = this.bots();
    const out: RosterSeed[] = [];
    for (const team of [0, 1] as const) {
      for (const m of humans) {
        if (m.team === team) out.push({ playerId: m.id, name: m.name, team, fighterId: m.fighterId, bot: false, account: m.account });
      }
      for (const b of bots) if (b.team === team) out.push(b);
    }
    return out;
  }

  toState(): RoomState {
    const players: RoomPlayer[] = [...this.members]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        id: m.id,
        name: m.name,
        fighterId: m.fighterId,
        team: m.team,
        ready: m.ready,
        host: m.id === this.hostId,
        connected: m.connected,
        bot: false,
      }));
    for (const b of this.bots()) {
      players.push({ id: b.playerId, name: b.name, fighterId: b.fighterId, team: b.team, ready: true, host: false, connected: true, bot: true });
    }
    return { code: this.code, players, phase: this.phase, mode: this.mode, mapId: this.mapId, fillBots: this.fillBots };
  }

  /** 로비에서 오래 끊긴 사람을 내보낸다. 내보낸 id 목록 */
  sweepDisconnected(now: number, graceMs: number): string[] {
    if (this.phase !== 'lobby') return [];
    const gone = this.members.filter((m) => !m.connected && m.disconnectedAt !== null && now - m.disconnectedAt >= graceMs).map((m) => m.id);
    for (const id of gone) this.remove(id, now);
    return gone;
  }

  private uniqueName(name: string): string {
    const taken = (n: string) => this.members.some((m) => sameName(m.name, n));
    if (!taken(name)) return name;
    for (let i = 2; ; i++) {
      const suffix = ` ${i}`;
      const base = Array.from(name).slice(0, NAME_MAX - suffix.length).join('').trimEnd();
      if (!taken(base + suffix)) return base + suffix;
    }
  }

  private touch(now: number) {
    this.emptySince = this.connectedCount > 0 ? null : (this.emptySince ?? now);
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private readonly random: (n: number) => number = (n) => randomInt(n)) {}

  create(): Room {
    for (let attempt = 0; attempt < 10000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.random(ROOM_CODE_ALPHABET.length)];
      if (this.rooms.has(code)) continue;
      const room = new Room(code);
      this.rooms.set(code, room);
      return room;
    }
    throw new Error('No free room code');
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  delete(code: string) {
    const room = this.rooms.get(code);
    room?.match?.stop();
    this.rooms.delete(code);
  }
}
