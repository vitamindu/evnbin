import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { SUPER_PROJECTILE_RADIUS } from '../../../src/game/rules';
import { TICK_RATE } from '../../../src/game/types';
import { attack, fighters, makeSim, ofType, run, runUntil, superIn, testMap, tick } from './helpers';

const R = getFighter('reaper');
const F = getFighter('fister');

/** 팀0 (2,4), 팀1 (x,4) 가로 시험 맵 */
const duel = (id: 'reaper' | 'fister', enemyX: number) =>
  makeSim(testMap(20, 9, [[2, 4, 'A'], [enemyX, 4, 'Z']]), [{ id }, { id: 'boulder', team: 1 }], { dummies: false });

describe('REAPER', () => {
  it('기본 공격은 돌진: 지나가며 적을 베고, 공격으로 궁극기가 찬다', () => {
    const sim = duel('reaper', 4);
    const [me, foe] = fighters(sim);
    const x0 = me!.pos.x;
    const ev = [...tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) })];
    expect(me!.action).toMatchObject({ kind: 'dash', isSuper: false });
    ev.push(...runUntil(sim, () => me!.action === null, 60));
    expect(me!.pos.x - x0).toBeGreaterThan(R.attack.range - 0.6);
    const hits = ofType(ev, 'hit').filter((h) => h.targetId === foe!.id);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.isSuper).toBe(false);
    expect(foe!.maxHp - foe!.hp).toBe(R.attack.damage);
    expect(me!.superCharge).toBeCloseTo(R.attack.superChargePerHit, 6);
    expect(me!.ammo).toBeLessThan(me!.maxAmmo);
  });

  it('궁극기: 넓은 관통탄, 준 피해만큼 체력 회복(최대 체력까지)', () => {
    const sim = duel('reaper', 8);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    me!.hp = 1000;
    tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) });
    expect(sim.projectiles[0]!.radius).toBe(R.super.projectileRadius);
    expect(sim.projectiles[0]!.radius).toBeGreaterThan(SUPER_PROJECTILE_RADIUS);
    run(sim, 30);
    const dealt = foe!.maxHp - foe!.hp;
    expect(dealt).toBe(R.super.damage);
    expect(me!.hp).toBe(1000 + Math.round(dealt * R.super.lifesteal!));
  });
});

describe('FISTER', () => {
  it('짧은 2연타, 맞힐 때마다 피해의 25% 회복', () => {
    const sim = duel('fister', 3);
    const [me, foe] = fighters(sim);
    me!.hp = 1000;
    const ev = [...tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) }), ...run(sim, 20)];
    const hits = ofType(ev, 'hit').filter((h) => h.targetId === foe!.id);
    expect(hits).toHaveLength(2);
    expect(me!.hp).toBe(1000 + 2 * Math.round(F.attack.damage * F.attack.lifesteal!));
  });

  it('궁극기는 시간이 지나면 저절로 찬다', () => {
    const sim = duel('fister', 15);
    const me = fighters(sim)[0]!;
    const secs = 1 / F.superChargePerSec!;
    const ev = run(sim, Math.ceil(secs * TICK_RATE) + 1);
    expect(me.superCharge).toBe(1);
    expect(ofType(ev, 'superReady').filter((e) => e.unitId === me.id)).toHaveLength(1);
  });

  it('궁극기 점프: 폭탄·착지 피해 없이 이동만', () => {
    const sim = duel('fister', 15);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    const x0 = me!.pos.x;
    const ev = [...tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) })];
    expect(me!.action?.kind).toBe('leap');
    ev.push(...runUntil(sim, () => me!.action === null, 60));
    expect(me!.pos.x - x0).toBeGreaterThan(2);
    expect(sim.lobs).toHaveLength(0);
    expect(ofType(ev, 'explode')).toHaveLength(0);
    expect(foe!.hp).toBe(foe!.maxHp);
  });
});
