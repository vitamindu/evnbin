import { describe, expect, it } from 'vitest';
import type { Lob, Projectile } from '../../../src/game/types';
import { OnlineSession } from '../../../src/net/onlineSession';
import { NetSimView } from '../../../src/net/snapshots';

/** 온라인: 내 탄은 그려진(예측한) 내 위치에서 나가는 것처럼 보이게, 멀어질수록 원래 길로 */
const proj = (id: number, ownerId: number, x: number, y: number): Projectile =>
  ({ id, type: 'projectile', ownerId, team: 0, pos: { x, y }, vel: { x: 10, y: 0 }, radius: 0.15, damage: 100, remaining: 5, isSuper: false }) as unknown as Projectile;

describe('own shots follow the predicted me (online)', () => {
  const align = (view: NetSimView, server: { x: number; y: number }, shown: { x: number; y: number }) =>
    (OnlineSession.prototype as unknown as { alignOwnShots: (v: NetSimView, a: unknown, b: unknown) => void }).alignOwnShots.call({ playerId: 1 }, view, server, shown);

  it('shifts my fresh bullets by the prediction gap, fading with distance; others untouched', () => {
    const view = new NetSimView(10, [], [proj(10, 1, 5, 5), proj(11, 1, 6.25, 5), proj(12, 1, 9, 5), proj(13, 2, 5, 5)], [], { mode: 'training', score: [0, 0], targetScore: 0, ticksLeft: 0, winner: null });
    align(view, { x: 5, y: 5 }, { x: 5.6, y: 5.2 }); // 내가 0.6/0.2 앞에 그려져 있다
    const [a, b, c, other] = view.projectiles;
    expect(a!.pos.x).toBeCloseTo(5.6, 6); // 막 나온 탄 = 그려진 내 위치
    expect(a!.pos.y).toBeCloseTo(5.2, 6);
    expect(b!.pos.x).toBeCloseTo(6.25 + 0.6 * 0.5, 6); // 1.25타일 = 절반만
    expect(c!.pos.x).toBe(9); // 2.5타일 넘으면 원래 자리
    expect(other!.pos).toEqual({ x: 5, y: 5 }); // 남의 탄
  });

  it('moves the start of my bombs only (landing point unchanged)', () => {
    const lob = { id: 20, type: 'lob', ownerId: 1, team: 0, from: { x: 5, y: 5 }, to: { x: 9, y: 5 }, startTick: 0, endTick: 30, damage: 1, aoeRadius: 1, isSuper: false, breaksWalls: false } as Lob;
    const view = new NetSimView(10, [], [], [lob], { mode: 'training', score: [0, 0], targetScore: 0, ticksLeft: 0, winner: null });
    align(view, { x: 5, y: 5 }, { x: 5.5, y: 5 });
    expect(view.lobs[0]!.from).toEqual({ x: 5.5, y: 5 });
    expect(view.lobs[0]!.to).toEqual({ x: 9, y: 5 });
  });
});
