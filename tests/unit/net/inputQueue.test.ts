import { describe, expect, it } from 'vitest';
import { InputQueue } from '../../../server/inputQueue';
import { parseClientMsg } from '../../../server/validate';
import { quantizeMove, toWireAim } from '../../../src/net/wire';

const R = { x: 1, y: 0 };
const L = { x: -1, y: 0 };

describe('InputQueue', () => {
  it('uses one input per tick in order and acks it', () => {
    const q = new InputQueue();
    q.push({ seq: 1, move: R });
    q.push({ seq: 2, move: L });
    expect(q.take().move).toEqual(R);
    expect(q.ack).toBe(1);
    expect(q.take().move).toEqual(L);
    expect(q.ack).toBe(2);
  });

  it('ignores duplicate or old seq', () => {
    const q = new InputQueue();
    expect(q.push({ seq: 5, move: R })).toBe(true);
    expect(q.push({ seq: 5, move: L })).toBe(false);
    expect(q.push({ seq: 3, move: L })).toBe(false);
    expect(q.backlog).toBe(1);
  });

  it('maxBacklog 0 = latest move per tick, without losing one-shot attacks', () => {
    const q = new InputQueue({ maxBacklog: 0 });
    q.push({ seq: 1, move: R, attack: null });
    q.push({ seq: 2, move: L });
    const a = q.take();
    expect(a.move).toEqual(L);
    expect(a.attack).toEqual({ aim: null });
    expect(q.ack).toBe(2);
  });

  it('drops old moves when too far behind, keeping latency bounded', () => {
    const q = new InputQueue({ maxBacklog: 2 });
    for (let s = 1; s <= 10; s++) q.push({ seq: s, move: { x: s / 10, y: 0 } });
    const a = q.take();
    expect(q.backlog).toBe(2);
    expect(a.move.x).toBeCloseTo(0.8);
    expect(q.ack).toBe(8);
  });

  it('keeps every queued attack/super across ticks (one per tick)', () => {
    const q = new InputQueue({ maxBacklog: 0 });
    q.push({ seq: 1, move: R, attack: { x: 0, y: 1 } });
    q.push({ seq: 2, move: R, attack: { x: 1, y: 0 } });
    q.push({ seq: 3, move: R, super: null });
    const t1 = q.take();
    const t2 = q.take();
    const t3 = q.take();
    // 궁극기가 먼저, 그 다음 공격 두 번이 순서대로
    expect(t1.super).toEqual({ aim: null });
    expect(t1.attack).toBeUndefined();
    expect(t2.attack).toEqual({ aim: { x: 0, y: 1 } });
    expect(t3.attack).toEqual({ aim: { x: 1, y: 0 } });
    expect(q.take().attack).toBeUndefined();
  });

  it('holds the last move briefly when inputs stop, then stops', () => {
    const q = new InputQueue({ holdTicks: 3 });
    q.push({ seq: 1, move: R });
    q.take();
    expect(q.take().move).toEqual(R);
    expect(q.take().move).toEqual(R);
    expect(q.take().move).toEqual(R);
    expect(q.take().move).toEqual({ x: 0, y: 0 });
    expect(q.ack).toBe(1);
  });

  it('a held tick is paid back by skipping one late input (same total distance)', () => {
    const q = new InputQueue({ maxBacklog: 2 });
    q.push({ seq: 1, move: R });
    q.take(); // 1
    q.take(); // 2가 늦음: R 유지
    q.push({ seq: 2, move: R });
    q.push({ seq: 3, move: R });
    q.take(); // 밀린 2를 건너뛰고 3
    expect(q.ack).toBe(3);
    expect(q.backlog).toBe(0);
  });

  it('reset accepts seq from 1 again (reconnect)', () => {
    const q = new InputQueue();
    q.push({ seq: 50, move: R });
    q.take();
    q.reset();
    expect(q.ack).toBe(0);
    expect(q.push({ seq: 1, move: L })).toBe(true);
  });
});

describe('message validation and wire helpers', () => {
  it('accepts valid input and rejects bad ones', () => {
    expect(parseClientMsg('{"t":"input","seq":3,"move":{"x":0.5,"y":-0.5},"attack":[0.1,0.2]}')).toEqual({
      t: 'input',
      seq: 3,
      move: { x: 0.5, y: -0.5 },
      attack: [0.1, 0.2],
    });
    // CHAINER 스킬 입력(skill)도 서버에서 버려지지 않고 통과한다
    expect(parseClientMsg('{"t":"input","seq":4,"move":{"x":0,"y":0},"skill":[0.3,0.4]}')).toEqual({
      t: 'input',
      seq: 4,
      move: { x: 0, y: 0 },
      skill: [0.3, 0.4],
    });
    expect(parseClientMsg('{"t":"input","seq":4,"move":{"x":0,"y":0},"skill":"x"}')).toBeNull();
    expect(parseClientMsg('{"t":"input","seq":3,"move":{"x":"a","y":0}}')).toBeNull();
    expect(parseClientMsg('{"t":"input","seq":-1,"move":{"x":0,"y":0}}')).toBeNull();
    expect(parseClientMsg('{"t":"hello","v":1,"name":"A","fighterId":"nobody"}')).toBeNull();
    expect(parseClientMsg('{"t":"setTeam","team":2}')).toBeNull();
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('{"t":"nope"}')).toBeNull();
  });

  it('quantizes moves to length <= 1 and 3 decimals', () => {
    expect(quantizeMove({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(quantizeMove({ x: 0.123456, y: NaN })).toEqual({ x: 0.123, y: 0 });
    expect(toWireAim(null)).toBeNull();
    expect(toWireAim({ x: 0.33333, y: 0 })).toEqual([0.333, 0]);
  });
});
