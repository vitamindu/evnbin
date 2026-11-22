import { describe, expect, it } from 'vitest';
import { getFighter, type AttackDef } from '../../../src/data/fighters';
import { resolveLeapAim } from '../../../src/game/aim';
import { botInput } from '../../../src/game/bot';
import { MIN_LEAP_DIST, PROJECTILE_RADIUS, secToTicks } from '../../../src/game/rules';
import type { Fighter, Projectile, SimEvent } from '../../../src/game/types';
import { Tile } from '../../../src/game/world';
import { attack, dummies, fighters, makeSim, ofType, run, superIn, testMap, tick, ticksFor } from './helpers';

const PA = getFighter('prism').attack;
const PS = getFighter('prism').super;
const GA = getFighter('grizzle').attack;
const GS = getFighter('grizzle').super;
const R = PROJECTILE_RADIUS;

/** PRISM 기본 공격 첫 탄을 쏘고, 그 탄이 끝날 때까지(또는 cond) 따라간다 */
function fireFirst(sim: ReturnType<typeof makeSim>, aim: { x: number; y: number }) {
  const p = fighters(sim)[0]!;
  const events: SimEvent[] = [...tick(sim, { [p.id]: attack(aim) })];
  const shot = sim.projectiles[0]!;
  return { p, shot, events };
}

const alive = (sim: ReturnType<typeof makeSim>, s: Projectile) => sim.projectiles.includes(s);

describe('PRISM: 튕기는 탄(bounces)', () => {
  it('데이터의 bounces가 탄에 실린다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A']]), [{ id: 'prism' }], { dummies: false });
    const { shot } = fireFirst(sim, { x: 1, y: 0 });
    expect(shot.bounces).toBe(PA.bounces);
  });

  it('세로 벽에서는 x 성분만, 가로 벽에서는 y 성분만 뒤집힌다', () => {
    // 오른쪽 테두리(세로 벽)로 비스듬히
    const a = makeSim(testMap(8, 12, [[2, 5, 'A']]), [{ id: 'prism' }], { dummies: false });
    const { shot: s1 } = fireFirst(a, { x: 1, y: 0.2 });
    const v1 = { ...s1.vel };
    for (let i = 0; i < 60 && alive(a, s1) && s1.vel.x > 0; i++) tick(a);
    expect(alive(a, s1)).toBe(true);
    expect(s1.vel.x).toBeCloseTo(-v1.x, 9);
    expect(s1.vel.y).toBeCloseTo(v1.y, 9);
    expect(s1.bounces).toBe(PA.bounces! - 1);
    expect(s1.pos.x).toBeLessThan(7 - R + 1e-6);

    // 아래 테두리(가로 벽)로 비스듬히
    const b = makeSim(testMap(12, 8, [[5, 2, 'A']]), [{ id: 'prism' }], { dummies: false });
    const { shot: s2 } = fireFirst(b, { x: 0.2, y: 1 });
    const v2 = { ...s2.vel };
    for (let i = 0; i < 60 && alive(b, s2) && s2.vel.y > 0; i++) tick(b);
    expect(alive(b, s2)).toBe(true);
    expect(s2.vel.x).toBeCloseTo(v2.x, 9);
    expect(s2.vel.y).toBeCloseTo(-v2.y, 9);
    expect(s2.bounces).toBe(PA.bounces! - 1);
  });

  it('바깥 모서리에 비스듬히 맞으면 두 성분이 모두 뒤집힌다', () => {
    // 단단한 벽 한 칸의 왼쪽 위 모서리를 향해 45°로
    const sim = makeSim(testMap(14, 14, [[3, 3, 'A'], [7, 7, 'X']]), [{ id: 'prism' }], { dummies: false });
    const { shot } = fireFirst(sim, { x: 1, y: 1 });
    const v = { ...shot.vel };
    for (let i = 0; i < 60 && alive(sim, shot) && shot.vel.x > 0; i++) tick(sim);
    expect(shot.vel.x).toBeCloseTo(-v.x, 9);
    expect(shot.vel.y).toBeCloseTo(-v.y, 9);
  });

  it('튕김 횟수를 다 쓰면 다음 벽에서 사라진다', () => {
    const def = getFighter('prism').attack as AttackDef;
    const saved = def.bounces;
    def.bounces = 1;
    try {
      // 안쪽 폭 3칸 통로에서 좌우로: 1번 튕기고 두 번째 벽에서 끝
      const sim = makeSim(testMap(5, 9, [[2, 4, 'A']]), [{ id: 'prism' }], { dummies: false });
      const { shot, events } = fireFirst(sim, { x: 1, y: 0 });
      events.push(...run(sim, ticksFor(PA.range, PA.projectileSpeed)));
      const end = ofType(events, 'projectileEnd').find((e) => e.id === shot.id)!;
      expect(end.reason).toBe('wall');
      expect(shot.bounces).toBe(0);
      // 오른쪽 벽에서 튕겨 왼쪽 벽에서 끝(총 1.5−R + 3−2R < 사거리)
      expect(end.pos.x).toBeCloseTo(1 + R, 3);
      expect(shot.remaining).toBeGreaterThan(0.5);
    } finally {
      def.bounces = saved;
    }
  });

  it('튕겨도 총 비행 거리는 사거리까지', () => {
    // 안쪽 폭 5칸: 오른쪽 벽에 한 번 튕긴 뒤 사거리 끝에서 멈춘다
    const sim = makeSim(testMap(7, 9, [[3, 4, 'A']]), [{ id: 'prism' }], { dummies: false });
    const { shot, events } = fireFirst(sim, { x: 1, y: 0 });
    events.push(...run(sim, ticksFor(PA.range, PA.projectileSpeed)));
    const end = ofType(events, 'projectileEnd').find((e) => e.id === shot.id)!;
    expect(end.reason).toBe('range');
    expect(shot.bounces).toBe(PA.bounces! - 1);
    const firstLeg = 6 - R - 3.5;
    expect(end.pos.x).toBeCloseTo(6 - R - (PA.range - firstLeg), 2);
  });

  it('튕긴 탄이 쏜 사람 뒤쪽의 적을 맞힐 수 있다', () => {
    // 궁극기(사거리 더 김): 오른쪽 벽에 튕겨 돌아와 왼쪽 더미를 맞힌다
    const sim = makeSim(testMap(7, 9, [[4, 4, 'A'], [1, 4, 'd']]), [{ id: 'prism' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    p.superCharge = 1;
    const events = [...tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) })];
    events.push(...run(sim, ticksFor(PS.range, PS.projectileSpeed) + secToTicks(PS.burstInterval * PS.count)));
    const hits = ofType(events, 'hit').filter((h) => h.targetId === d.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.isSuper && h.damage === PS.damage)).toBe(true);
  });

  it('결정적: 같은 입력이면 같은 결과', () => {
    const go = () => {
      const sim = makeSim(testMap(10, 10, [[2, 2, 'A'], [5, 5, '#'], [6, 3, 'W']]), [{ id: 'prism' }], { dummies: false });
      const p = fighters(sim)[0]!;
      tick(sim, { [p.id]: attack({ x: 0.7, y: 0.4 }) });
      run(sim, 40);
      return JSON.stringify(sim.projectiles) + p.ammo;
    };
    expect(go()).toBe(go());
  });
});

describe('GRIZZLE', () => {
  it('기본 공격: 4발 연사, 가까운 적에게 모두 맞는다', () => {
    const sim = makeSim(testMap(14, 9, [[3, 4, 'A'], [5, 4, 'd']]), [{ id: 'grizzle' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) })];
    events.push(...run(sim, ticksFor(GA.range, GA.projectileSpeed) + secToTicks(GA.burstInterval * GA.count)));
    const hits = ofType(events, 'hit').filter((h) => h.targetId === d.id);
    expect(hits).toHaveLength(GA.count);
    expect(hits.every((h) => h.damage === GA.damage)).toBe(true);
  });

  type Leap = Extract<NonNullable<Fighter['action']>, { kind: 'leap' }>;
  const LEAP_TICKS = secToTicks(GS.leapTime!);
  const AOE = GS.aoeRadius!;

  it('내려찍기: 폭탄 없이 착지 순간 둘레 적에게 피해 + 넉백 한 번 + 벽 파괴, explode 사건', () => {
    // 왼쪽(3,6)에서 오른쪽으로 사거리 끝까지. 착지 지점 바로 오른쪽에 더미, 위에 부서지는 벽
    const fx = 3;
    const land = { x: fx + 0.5 + GS.range, y: 6.5 };
    const dx = Math.floor(land.x + 0.8);
    const wallX = Math.floor(land.x);
    const sim = makeSim(testMap(fx + Math.ceil(GS.range) + 8, 13, [[fx, 6, 'A'], [dx, 6, 'd'], [wallX, 4, '#']]), [{ id: 'grizzle' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    p.superCharge = 1;
    tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) });
    const act = p.action as Leap;
    expect(act.kind).toBe('leap');
    expect(act.to.x).toBeCloseTo(land.x, 9);
    expect(sim.lobs).toHaveLength(0);

    const mid = run(sim, LEAP_TICKS - 1);
    expect(ofType(mid, 'hit')).toHaveLength(0);
    expect(ofType(mid, 'explode')).toHaveLength(0);
    const hp0 = d.hp;
    const landing = tick(sim);
    expect(p.action).toBeNull();
    expect(p.pos).toEqual(act.to);
    expect(ofType(landing, 'explode')).toEqual([{ type: 'explode', pos: act.to, radius: AOE, isSuper: true }]);
    const hits = ofType(landing, 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ targetId: d.id, sourceId: p.id, damage: GS.damage, isSuper: true });
    expect(d.hp).toBe(hp0 - GS.damage);
    const knock = (d as unknown as { knock: { vx: number; vy: number } | null }).knock;
    expect(knock).not.toBeNull();
    expect(knock!.vx).toBeGreaterThan(0); // 착지 지점에서 멀어지는 쪽
    expect(Math.abs(knock!.vy)).toBeLessThan(knock!.vx * 0.3);
    expect(sim.grid.get(wallX, 4)).toBe(Tile.Floor);
    const broken = ofType(landing, 'wallsBroken');
    expect(broken.some((e) => e.tiles.some((t) => t.x === wallX && t.y === 4))).toBe(true);
    expect(p.superCharge).toBe(0);

    // 그 뒤로 폭탄이나 추가 피해는 없다
    const after = run(sim, 60);
    expect(ofType(after, 'explode')).toHaveLength(0);
    expect(ofType(after, 'hit')).toHaveLength(0);
  });

  it('둘레 밖의 적은 맞지 않는다', () => {
    const sim = makeSim(testMap(20, 13, [[3, 6, 'A'], [3 + Math.ceil(GS.range + AOE) + 2, 6, 'd']]), [{ id: 'grizzle' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) });
    expect(ofType(run(sim, LEAP_TICKS + 2), 'hit')).toHaveLength(0);
  });

  it('자동 조준: 가장 가까운 보이는 적 쪽으로, 거리만큼(사거리까지) 뛴다', () => {
    const sim = makeSim(testMap(16, 13, [[3, 6, 'A'], [6, 9, 'd']]), [{ id: 'grizzle' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    const r = resolveLeapAim(sim, p, null, GS.range);
    expect(r.target?.id).toBe(d.id);
    expect(r.dir).toBeCloseTo(Math.atan2(3, 3), 9);
    p.superCharge = 1;
    tick(sim, { [p.id]: superIn(null) });
    const act = p.action as Leap;
    const want = Math.max(MIN_LEAP_DIST, Math.hypot(3, 3));
    expect(act.to.x).toBeCloseTo(act.from.x + Math.cos(r.dir) * want, 9);
    expect(act.to.y).toBeCloseTo(act.from.y + Math.sin(r.dir) * want, 9);
  });

  it('봇: 게이지가 차고 표적이 궁극기 사거리 안이면 표적 쪽으로 내려찍는다', () => {
    const sim = makeSim(testMap(16, 13, [[3, 6, 'A'], [7, 6, 'd']]), [{ id: 'grizzle' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    let input = botInput(sim, p.id);
    for (let i = 0; i < 30 && !input.super; i++) {
      tick(sim);
      p.pos = { x: 3.5, y: 6.5 };
      input = botInput(sim, p.id);
    }
    expect(input.super).toBeDefined();
    const aim = input.super!.aim!;
    expect(aim.x).toBeGreaterThan(0);
    expect(Math.abs(aim.y)).toBeLessThan(0.2 * aim.x);
  });
});
