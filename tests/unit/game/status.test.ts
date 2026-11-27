import { describe, expect, it } from 'vitest';
import { CC_NAME, ccOf } from '../../../src/game/status';
import type { Fighter, Zone } from '../../../src/game/types';
import { fighters, makeSim, testMap } from './helpers';

const sim = () => makeSim(testMap(14, 9, [[2, 4, 'A'], [8, 4, 'Z']]), [{ id: 'rivet' }, { id: 'rivet', team: 1 }], { dummies: false });
const view = (tick: number, zones: Zone[] = []) => ({ tick, zones });
const zone = (team: 0 | 1, x: number, y: number, radius = 2): Zone => ({ id: 99, type: 'zone', ownerId: 1, team, pos: { x, y }, radius, untilTick: 999, slow: 0.3, dps: 0 });

describe('군중 제어(CC) 표시 판정', () => {
  it('걸린 게 없으면 null, CC 이름은 한국어', () => {
    const [me] = fighters(sim());
    expect(ccOf(view(0), me!)).toBeNull();
    expect(CC_NAME).toEqual({ stun: '기절', knockback: '넉백', slow: '둔화' });
  });

  it('기절: stunnedUntilTick이 지나기 전까지만', () => {
    const [me] = fighters(sim());
    me!.stunnedUntilTick = 30;
    expect(ccOf(view(10), me!)).toBe('stun');
    expect(ccOf(view(30), me!)).toBeNull();
  });

  it('넉백: 밀려나는 동안', () => {
    const [me] = fighters(sim());
    (me as Fighter).action = { kind: 'knockback', vx: 1, vy: 0, untilTick: 20 };
    expect(ccOf(view(5), me!)).toBe('knockback');
  });

  it('둔화: 적 지대 안에서만(우리 팀 지대는 아님)', () => {
    const [me] = fighters(sim());
    const { x, y } = me!.pos;
    expect(ccOf(view(0, [zone(1, x, y)]), me!)).toBe('slow');
    expect(ccOf(view(0, [zone(0, x, y)]), me!)).toBeNull();
    expect(ccOf(view(0, [zone(1, x + 9, y)]), me!)).toBeNull();
  });

  it('겹치면 기절 > 넉백 > 둔화, 죽은 파이터는 null', () => {
    const [me] = fighters(sim());
    const { x, y } = me!.pos;
    (me as Fighter).action = { kind: 'knockback', vx: 1, vy: 0, untilTick: 20 };
    expect(ccOf(view(5, [zone(1, x, y)]), me!)).toBe('knockback');
    me!.stunnedUntilTick = 30;
    expect(ccOf(view(5, [zone(1, x, y)]), me!)).toBe('stun');
    me!.alive = false;
    expect(ccOf(view(5), me!)).toBeNull();
  });
});
