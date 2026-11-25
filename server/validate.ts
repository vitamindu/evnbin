/**
 * 클라이언트 메시지 검사. 형식이 틀리면 null(→ bad_message). 서버는 이 함수를 통과한 값만 쓴다.
 */
import { FIGHTERS, type FighterId } from '../src/data/fighters';
import type { ClientMsg, WireAim } from '../src/net/protocol';

const FIGHTER_IDS = new Set<string>(FIGHTERS.map((f) => f.id));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isFighter = (v: unknown): v is FighterId => typeof v === 'string' && FIGHTER_IDS.has(v);

function isVec(v: unknown): v is { x: number; y: number } {
  return isObj(v) && isNum(v.x) && isNum(v.y) && Math.abs(v.x) <= 10 && Math.abs(v.y) <= 10;
}

function isAim(v: unknown): v is WireAim {
  return v === null || (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && Math.abs(v[0]) <= 10 && Math.abs(v[1]) <= 10);
}

export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      if (!isNum(m.v) || typeof m.name !== 'string' || m.name.length > 64 || !isFighter(m.fighterId)) return null;
      if (m.token !== undefined && (typeof m.token !== 'string' || m.token.length > 200)) return null;
      return { t: 'hello', v: m.v, name: m.name, fighterId: m.fighterId, ...(typeof m.token === 'string' ? { token: m.token } : {}) };
    case 'create':
      return { t: 'create' };
    case 'join':
      if (typeof m.code !== 'string' || m.code.length > 16) return null;
      return { t: 'join', code: m.code };
    case 'leave':
      return { t: 'leave' };
    case 'setFighter':
      if (!isFighter(m.fighterId)) return null;
      return { t: 'setFighter', fighterId: m.fighterId };
    case 'setTeam':
      if (m.team !== 0 && m.team !== 1) return null;
      return { t: 'setTeam', team: m.team };
    case 'setBots':
      if (typeof m.fillBots !== 'boolean') return null;
      return { t: 'setBots', fillBots: m.fillBots };
    case 'setMode':
      if (m.mode !== 'teamfight' && m.mode !== 'crystal' && m.mode !== 'ball') return null;
      return { t: 'setMode', mode: m.mode };
    case 'setMap':
      if (typeof m.mapId !== 'string' || m.mapId.length > 40) return null;
      return { t: 'setMap', mapId: m.mapId };
    case 'ready':
      if (typeof m.ready !== 'boolean') return null;
      return { t: 'ready', ready: m.ready };
    case 'start':
      return { t: 'start' };
    case 'input': {
      if (!isNum(m.seq) || !Number.isInteger(m.seq) || m.seq < 0 || m.seq > 2 ** 31 || !isVec(m.move)) return null;
      if (m.attack !== undefined && !isAim(m.attack)) return null;
      if (m.super !== undefined && !isAim(m.super)) return null;
      const out: ClientMsg = { t: 'input', seq: m.seq, move: { x: m.move.x, y: m.move.y } };
      if (m.attack !== undefined) out.attack = m.attack as WireAim;
      if (m.super !== undefined) out.super = m.super as WireAim;
      return out;
    }
    case 'ping':
      if (!isNum(m.at)) return null;
      return { t: 'ping', at: m.at };
    default:
      return null;
  }
}
