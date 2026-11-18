import { describe, expect, it } from 'vitest';
import { Match } from '../../../server/match';
import type { SimEvent } from '../../../src/game/types';
import type { MatchResult, ServerMsg, Snapshot } from '../../../src/net/protocol';

function setup(maxTicks?: number) {
  const sent: Record<string, string[]> = { a: [], b: [] };
  const connected = new Set(['a', 'b']);
  let ended: MatchResult | null = null;
  const m = new Match(
    {
      seed: 7,
      mapId: 'blossom-arena',
      mode: 'teamfight',
      maxTicks,
      roster: [
        { playerId: 'a', name: 'A', team: 0, fighterId: 'rivet', bot: false },
        { playerId: 'x', name: 'BOT 1', team: 0, fighterId: 'volley', bot: true },
        { playerId: 'b', name: 'B', team: 1, fighterId: 'boulder', bot: false },
      ],
    },
    {
      send: (pid, data) => sent[pid]!.push(data),
      isConnected: (pid) => connected.has(pid),
      onEnd: (r) => (ended = r),
    },
  );
  const snaps = (pid: string): Snapshot[] =>
    sent[pid]!.map((s) => JSON.parse(s) as ServerMsg).flatMap((msg) => (msg.t === 'snap' ? [msg.snap] : []));
  return { m, sent, connected, snaps, ended: () => ended };
}

describe('Match', () => {
  it('builds the roster in order with spawn points per team and sends snaps every 2 ticks with per-client ack', () => {
    const { m, snaps } = setup();
    expect(m.info.roster.map((r) => [r.playerId, r.entityId])).toEqual([
      ['a', 1],
      ['x', 2],
      ['b', 3],
    ]);
    const units = m.sim.units;
    expect(units[0]!.pos).not.toEqual(units[1]!.pos); // 팀0 두 명은 다른 출발 지점
    m.pushInput('a', { t: 'input', seq: 1, move: { x: 1, y: 0 } });
    m.pushInput('a', { t: 'input', seq: 2, move: { x: 1, y: 0 } });
    for (let i = 0; i < 4; i++) m.step();
    const sa = snaps('a');
    expect(sa.map((s) => s.tick)).toEqual([2, 4]);
    expect(sa[1]!.ack).toBe(2);
    expect(snaps('b')[1]!.ack).toBe(0);
    expect(sa[1]!.units).toHaveLength(3);
    // 숫자는 소수 셋째 자리까지
    const raw = JSON.stringify(sa[1]!.units[0]!.pos);
    expect(raw).toMatch(/^\{"x":-?\d+(\.\d{1,3})?,"y":-?\d+(\.\d{1,3})?\}$/);
  });

  it('a disconnected player gets no snaps and is driven by the bot', () => {
    const { m, connected, sent } = setup();
    connected.delete('b');
    for (let i = 0; i < 4; i++) m.step();
    expect(sent.b).toHaveLength(0);
    expect(sent.a).toHaveLength(2);
  });

  it('tracks damage, kills and deaths per player and ends at the safety cap', () => {
    const { m, ended } = setup(6);
    const track = (m as unknown as { track(e: SimEvent[]): void }).track.bind(m);
    track([
      { type: 'hit', targetId: 3, sourceId: 1, damage: 400, pos: { x: 0, y: 0 }, isSuper: false, killed: false },
      { type: 'hit', targetId: 3, sourceId: 1, damage: 300, pos: { x: 0, y: 0 }, isSuper: false, killed: true },
    ]);
    for (let i = 0; i < 10; i++) m.step();
    const r = ended()!;
    expect(r).not.toBeNull();
    expect(m.sim.tick).toBe(6);
    expect(r.winner).toBe(-1);
    const a = r.stats.find((s) => s.playerId === 'a')!;
    const b = r.stats.find((s) => s.playerId === 'b')!;
    expect([a.damage, a.kills, a.deaths]).toEqual([700, 1, 0]);
    expect([b.damage, b.kills, b.deaths]).toEqual([0, 0, 1]);
    expect(r.stats).toHaveLength(3);
  });

  it('a reconnecting player receives all walls broken so far in the next snap', () => {
    const { m, snaps } = setup();
    const track = (m as unknown as { track(e: SimEvent[]): void }).track.bind(m);
    track([{ type: 'wallsBroken', tiles: [{ x: 12, y: 3 }] }]);
    m.resetInput('b');
    m.step();
    m.step();
    const sb = snaps('b');
    const sa = snaps('a');
    expect(sb[0]!.events[0]).toEqual({ type: 'wallsBroken', tiles: [{ x: 12, y: 3 }] });
    expect(sa[0]!.events.some((e) => e.type === 'wallsBroken')).toBe(false);
    m.step();
    m.step();
    expect(snaps('b')[1]!.events.some((e) => e.type === 'wallsBroken')).toBe(false);
  });
});
