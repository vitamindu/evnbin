import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, Room, RoomManager, isValidCode, sanitizeName } from '../../../server/rooms';
import { rosterSpawns } from '../../../src/net/roster';

function roomWith(n: number): Room {
  const r = new Room('ABCD');
  for (let i = 0; i < n; i++) r.add(`p${i}`, `P${i}`, 'rivet', 1000);
  return r;
}

describe('room codes', () => {
  it('are 4 letters without ambiguous letters and unique', () => {
    const m = new RoomManager();
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = m.create().code;
      expect(code).toMatch(/^[A-Z]{4}$/);
      expect(isValidCode(code)).toBe(true);
      for (const bad of 'ILOUV0123456789') expect(code).not.toContain(bad);
      codes.add(code);
    }
    expect(codes.size).toBe(300);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[ILOUV]/);
  });

  it('retries on collision and looks codes up case-insensitively', () => {
    // 같은 코드가 먼저 나오도록 하는 난수
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
    let i = 0;
    const m = new RoomManager(() => seq[i++ % seq.length]!);
    const a = m.create();
    const b = m.create();
    expect(a.code).toBe('AAAA');
    expect(b.code).toBe('BBBB');
    expect(m.get(' bbbb ')).toBe(b);
    m.delete('AAAA');
    expect(m.get('AAAA')).toBeUndefined();
  });
});

describe('room rules', () => {
  it('auto-balances teams and caps at 6 players', () => {
    const r = roomWith(6);
    expect(r.teamCount(0)).toBe(3);
    expect(r.teamCount(1)).toBe(3);
    expect(r.members.map((m) => m.team)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(r.add('p7', 'Late', 'rivet')).toBe('room_full');
  });

  it('first member is host; host is handed over when the host leaves or disconnects', () => {
    const r = roomWith(3);
    expect(r.hostId).toBe('p0');
    expect(r.toState().players.filter((p) => p.host).map((p) => p.id)).toEqual(['p0']);
    r.remove('p0');
    expect(r.hostId).toBe('p1');
    r.setConnected('p1', false, 2000);
    expect(r.hostId).toBe('p2');
    // 혼자 남은 사람이 끊겨도 방장 표시는 남는다(돌아오면 그대로)
    r.setConnected('p2', false, 2000);
    expect(r.hostId).toBe('p2');
  });

  it('team switching respects the team size', () => {
    const r = roomWith(4); // 2 vs 2
    expect(r.setTeam('p0', 1)).toBeNull();
    expect(r.teamCount(1)).toBe(3);
    expect(r.setTeam('p2', 1)).toBe('room_full');
    expect(r.setTeam('p1', 0)).toBeNull();
    expect(r.teamCount(0)).toBe(2);
  });

  it('ready flags, host-only settings and start', () => {
    const r = roomWith(2);
    expect(r.setReady('p1', true)).toBeNull();
    expect(r.toState().players.find((p) => p.id === 'p1')!.ready).toBe(true);
    expect(r.setFillBots('p1', true)).toBe('not_host');
    expect(r.setFillBots('p0', true)).toBeNull();
    expect(r.canStart('p1')).toBe('not_host');
    expect(r.canStart('p0')).toBeNull();
    r.phase = 'playing';
    expect(r.canStart('p0')).toBe('in_progress');
    expect(r.add('p9', 'New', 'rivet')).toBe('in_progress');
    expect(r.setTeam('p0', 1)).toBe('in_progress');
  });

  it('fillBots fills both teams to 3 with bots listed in the room', () => {
    const r = roomWith(2);
    r.setFillBots('p0', true);
    const st = r.toState();
    expect(st.players).toHaveLength(6);
    expect(st.players.filter((p) => p.bot)).toHaveLength(4);
    expect(st.players.filter((p) => p.team === 0)).toHaveLength(3);
    // 명단: 팀0 → 팀1, 사람 먼저
    const seeds = r.rosterSeeds();
    expect(seeds.map((s) => [s.team, s.bot])).toEqual([
      [0, false],
      [0, true],
      [0, true],
      [1, false],
      [1, true],
      [1, true],
    ]);
    // 봇은 같은 팀 사람과 다른 캐릭터부터
    expect(seeds[1]!.fighterId).not.toBe('rivet');
    // 출발 지점은 팀 안 순서
    expect(rosterSpawns(seeds).map((s) => s.spawnIndex)).toEqual([0, 1, 2, 0, 1, 2]);
    r.setFillBots('p0', false);
    expect(r.toState().players).toHaveLength(2);
  });

  it('dedupes names and finds reconnect seats by name', () => {
    const r = new Room('ABCD');
    const a = r.add('a', 'PLAYER', 'rivet');
    const b = r.add('b', 'player', 'rivet');
    expect(typeof a !== 'string' && a.name).toBe('PLAYER');
    expect(typeof b !== 'string' && b.name).toBe('player 2');
    // 로비: 연결된 자리는 재접속 대상이 아니다
    expect(r.findReconnect('PLAYER')).toBeUndefined();
    r.setConnected('a', false, 5000);
    expect(r.findReconnect('player')?.id).toBe('a');
    // 경기 중에는 연결된 것처럼 보이는 자리(끊김을 아직 모름)도 이어받는다
    r.phase = 'playing';
    expect(r.findReconnect('player 2')?.id).toBe('b');
  });

  it('removes long-disconnected members from the lobby only', () => {
    const r = roomWith(2);
    r.setConnected('p1', false, 1000);
    expect(r.sweepDisconnected(5000, 20_000)).toEqual([]);
    expect(r.sweepDisconnected(21_000, 20_000)).toEqual(['p1']);
    expect(r.members).toHaveLength(1);
    r.setConnected('p0', false, 30_000);
    expect(r.emptySince).toBe(30_000);
    r.phase = 'playing';
    expect(r.sweepDisconnected(90_000, 20_000)).toEqual([]);
  });

  it('sanitizes names', () => {
    expect(sanitizeName('  ')).toBe('플레이어');
    expect(sanitizeName('a\u0000b\n  c')).toBe('ab c');
    expect(Array.from(sanitizeName('가'.repeat(40)))).toHaveLength(16);
  });
});
