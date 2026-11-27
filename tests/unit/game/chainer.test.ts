import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { attack, fighters, makeSim, ofType, run, runUntil, testMap, tick } from './helpers';

const CHAINER = getFighter('chainer');
const Q = CHAINER.attack;
const KIT = CHAINER.chainKit!;

const duel = (distance: number, enemy: 'rivet' | 'boulder' = 'rivet') =>
  makeSim(testMap(Math.max(14, distance + 6), 9, [[2, 4, 'A'], [distance + 2, 4, 'Z']]), [
    { id: 'chainer' }, { id: enemy, team: 1 },
  ], { dummies: false });

describe('CHAINER', () => {
  const SLAM = Q.chainSlam!;
  const TOTAL_Q = SLAM.chainDamage + Q.damage;

  it('Q는 조준한 바닥을 내리친다: 사슬 피해 → 0.5초 뒤 폭발 피해(투사체 없음)', () => {
    const sim = duel(3);
    const [me, foe] = fighters(sim);
    const events = [...tick(sim, { [me!.id]: attack({ x: 3 / Q.range, y: 0 }) })]; // 3타일 앞 바닥
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.lobs).toHaveLength(1);
    expect(sim.lobs[0]).toMatchObject({ slam: true, damage: Q.damage, chainDamage: SLAM.chainDamage, aoeRadius: SLAM.radius });
    expect(foe!.hp).toBe(foe!.maxHp); // 아직 맞지 않았다
    events.push(...run(sim, 10)); // 사슬이 다 뻗은 뒤
    expect(foe!.maxHp - foe!.hp).toBe(SLAM.chainDamage); // 사슬 피해만
    expect(ofType(events, 'explode')).toHaveLength(0);
    events.push(...run(sim, 30));
    expect(foe!.maxHp - foe!.hp).toBe(TOTAL_Q); // 사슬 + 폭발
    expect(ofType(events, 'explode')).toHaveLength(1);
    expect(me!.ammo).toBeLessThan(me!.maxAmmo);
  });

  it('Q: 폭발 반지름은 작다(0.65). 사슬만 스친 적은 사슬 피해만, 폭발 원 밖은 안 맞는다', () => {
    expect(SLAM.radius).toBe(0.65);
    const sim = duel(3, 'rivet');
    const [me, foe] = fighters(sim);
    // 조준 지점은 5.5(3타일 앞). 적은 사슬 길 위 4.0 부근에 선다: 사슬엔 닿고 폭발 원에서는 멀다
    me!.pos = { x: 2.5, y: 4.5 };
    foe!.pos = { x: 4.0, y: 4.1 };
    tick(sim, { [me!.id]: attack({ x: 3 / Q.range, y: 0 }) });
    run(sim, 40);
    expect(foe!.maxHp - foe!.hp).toBe(SLAM.chainDamage);
  });

  it('Q: 원 안의 모든 적이 같은 틱에 폭발 피해를 받고(사슬 피해 포함 합계), 원 밖은 안 맞는다', () => {
    const sim = makeSim(testMap(16, 9, [[2, 4, 'A'], [14, 1, 'Z'], [14, 7, 'Z'], [8, 5, 'X'], [8, 3, 'X']]), [
      { id: 'chainer' }, { id: 'rivet', team: 1 }, { id: 'rivet', team: 1 }, { id: 'rivet', team: 1 },
    ], { dummies: false });
    const [me, a, b, c] = fighters(sim);
    me!.pos = { x: 2.5, y: 4.5 };
    // 조준 지점 = 내 위치에서 3타일 앞 → (5.5, 4.5)
    a!.pos = { x: 5.5, y: 4.2 };
    b!.pos = { x: 5.5, y: 4.8 };
    c!.pos = { x: 5.5, y: 7.4 }; // 원 밖
    tick(sim, { [me!.id]: attack({ x: 3 / Q.range, y: 0 }) });
    const blasts: Array<{ target: number; tick: number }> = [];
    for (let i = 0; i < 40; i++) {
      const t = sim.tick;
      for (const e of ofType(tick(sim), 'hit')) if (e.damage === Q.damage) blasts.push({ target: e.targetId, tick: t });
    }
    expect(blasts.map((h) => h.target).sort()).toEqual([a!.id, b!.id].sort());
    expect(new Set(blasts.map((h) => h.tick)).size).toBe(1); // 같은 틱
    expect(a!.maxHp - a!.hp).toBe(TOTAL_Q);
    expect(b!.maxHp - b!.hp).toBe(TOTAL_Q);
    expect(c!.hp).toBe(c!.maxHp);
  });

  const skill = (id: number) => ({ [id]: { move: { x: 0, y: 0 }, skill: { aim: { x: 1, y: 0 } } } });
  const SEC = 30;

  it('E1: 짧게 돌진하고(스택 +1) E2 대기로 넘어간다, E2·W는 제한 시간(comboWindow)이 있다', () => {
    const sim = duel(10);
    const [me] = fighters(sim);
    const x0 = me!.pos.x;
    tick(sim, skill(me!.id));
    expect(me!.chainSkillPhase).toBe('chain');
    expect(me!.passiveStacks).toBe(1);
    expect(me!.action?.kind).toBe('chainDash');
    runUntil(sim, () => me!.action === null, 30);
    expect(me!.pos.x - x0).toBeCloseTo(KIT.dashRange, 1);
    expect(me!.chainSkillUntilTick! - sim.tick).toBeGreaterThan((KIT.comboWindow - 0.5) * SEC);
  });

  it('E2를 5초 안에 못 쓰면 콤보가 끝나고 그 순간부터 E1 재사용 대기시간 7초', () => {
    const sim = duel(10);
    const [me] = fighters(sim);
    tick(sim, skill(me!.id));
    const startTick = sim.tick;
    run(sim, KIT.comboWindow * SEC - 3);
    expect(me!.chainSkillPhase).toBe('chain'); // 아직 E2 가능
    run(sim, 6);
    expect(me!.chainSkillPhase).toBeUndefined();
    const ended = me!.chainSkillReadyTick! - KIT.skillCooldown * SEC;
    expect(ended).toBeGreaterThanOrEqual(startTick + KIT.comboWindow * SEC);
    expect(ended).toBeLessThanOrEqual(sim.tick);
    // 대기시간 중에는 E1을 못 쓴다
    tick(sim, skill(me!.id));
    expect(me!.chainSkillPhase).toBeUndefined();
    runUntil(sim, () => sim.tick >= me!.chainSkillReadyTick!, 400);
    tick(sim, skill(me!.id));
    expect(me!.chainSkillPhase).toBe('chain');
  });

  it('E2를 못 맞히면 곧바로 E1 대기시간 7초 단계(날아가지 않는다)', () => {
    const sim = duel(10);
    const [me] = fighters(sim);
    tick(sim, skill(me!.id));
    runUntil(sim, () => me!.action === null, 30);
    const x1 = me!.pos.x;
    tick(sim, skill(me!.id)); // E2: 맞을 상대가 없다
    expect(sim.projectiles).toHaveLength(1);
    expect(me!.chainSkillPhase).toBe('chainFlight');
    run(sim, 30);
    expect(me!.pos.x).toBeCloseTo(x1, 5);
    expect(me!.chainSkillPhase).toBeUndefined();
    expect(me!.chainSkillReadyTick! - sim.tick).toBeGreaterThan((KIT.skillCooldown - 1.2) * SEC);
  });

  it('E2를 맞히면 내가 대상에게 날아가고(기절) W 대기 5초, 이어서 W로 최대 체력 비율 피해+회복 뒤 E1 대기시간', () => {
    const sim = duel(5); // E1 돌진 뒤 E2 사거리 안
    const [me, foe] = fighters(sim);
    me!.hp = 1000;
    tick(sim, skill(me!.id)); // E1
    runUntil(sim, () => me!.action === null, 30);
    const x1 = me!.pos.x;
    tick(sim, skill(me!.id)); // E2
    expect(sim.projectiles[0]).toMatchObject({ chainSkill: true, damage: KIT.chainDamage });
    const events = runUntil(sim, () => me!.chainSkillPhase === 'w', 40);
    expect(foe!.maxHp - foe!.hp).toBe(KIT.chainDamage);
    expect(ofType(events, 'stun')).toHaveLength(1);
    expect(me!.action?.kind).toBe('chainDash'); // 대상에게 날아간다
    runUntil(sim, () => me!.action === null, 30);
    expect(me!.pos.x).toBeGreaterThan(x1 + 1);
    expect(Math.hypot(foe!.pos.x - me!.pos.x, foe!.pos.y - me!.pos.y)).toBeLessThan(me!.radius + foe!.radius + 0.2);
    expect(me!.chainSkillUntilTick! - sim.tick).toBeLessThanOrEqual(KIT.comboWindow * SEC);

    const beforeFoe = foe!.hp;
    const beforeMe = me!.hp;
    const wEvents = tick(sim, skill(me!.id)); // W
    const damage = Math.round(foe!.maxHp * KIT.wMaxHpDamage);
    expect(beforeFoe - foe!.hp).toBe(damage);
    expect(me!.hp - beforeMe).toBe(damage);
    expect(ofType(wEvents, 'heal')).toEqual([expect.objectContaining({ targetId: me!.id, amount: damage })]);
    // W 이펙트는 맞은 대상의 위치에 겹쳐 그린다(스킨 충격파)
    expect(ofType(wEvents, 'melee')).toEqual([expect.objectContaining({ unitId: me!.id, at: { x: foe!.pos.x, y: foe!.pos.y } })]);
    expect(me!.passiveStacks).toBe(2);
    expect(me!.chainSkillPhase).toBeUndefined();
    expect(me!.chainSkillReadyTick! - sim.tick).toBeGreaterThan((KIT.skillCooldown - 0.2) * SEC);

    // 패시브 평타: 중첩이 있으면 Q 내리치기는 나가지 않고, 주변 원형 타격만 나간다
    const hpBeforeAttack = foe!.hp;
    run(sim, 20);
    const ev = [...tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) }), ...run(sim, 20)];
    expect(sim.lobs).toHaveLength(0);
    expect(me!.passiveStacks).toBe(1);
    expect(ofType(ev, 'melee')).toEqual([expect.objectContaining({ unitId: me!.id, spreadDeg: 360, range: KIT.passiveRadius })]);
    expect(hpBeforeAttack - foe!.hp).toBe(KIT.passiveDamage);
    expect(me!.ammo).toBeLessThan(me!.maxAmmo); // 평타 탄 하나는 쓴다
  });

  it('W는 대상 최대 체력 비율 피해라서 캐릭터 레벨 배율을 곱하지 않는다(레벨 11도 같음)', () => {
    const wDamage = (power: number) => {
      const sim = duel(5, 'boulder');
      const [me, foe] = fighters(sim);
      (me as { power?: number }).power = power;
      tick(sim, skill(me!.id));
      runUntil(sim, () => me!.action === null, 30);
      tick(sim, skill(me!.id));
      runUntil(sim, () => me!.chainSkillPhase === 'w', 40);
      runUntil(sim, () => me!.action === null, 30);
      const before = foe!.hp;
      tick(sim, skill(me!.id));
      return before - foe!.hp;
    };
    expect(wDamage(1)).toBe(Math.round(5600 * KIT.wMaxHpDamage));
    expect(wDamage(11)).toBe(wDamage(1));
  });

  it('W를 5초 안에 안 쓰면 콤보가 끝나고 E1 대기시간 7초', () => {
    const sim = duel(5);
    const [me] = fighters(sim);
    tick(sim, skill(me!.id));
    runUntil(sim, () => me!.action === null, 30);
    tick(sim, skill(me!.id));
    runUntil(sim, () => me!.chainSkillPhase === 'w', 40);
    runUntil(sim, () => me!.action === null, 30);
    const until = me!.chainSkillUntilTick!;
    run(sim, until - sim.tick - 3);
    expect(me!.chainSkillPhase).toBe('w'); // 5초가 다 되기 직전까지는 W 가능
    run(sim, 6);
    expect(me!.chainSkillPhase).toBeUndefined();
    expect(me!.chainSkillReadyTick! - sim.tick).toBeGreaterThan((KIT.skillCooldown - 0.5) * SEC);
  });

  it('R: 같은 CHAINER에게 쓰면 무효(복사 없음, 게이지는 이미 쓴 상태)', () => {
    const sim = makeSim(testMap(14, 9, [[2, 4, 'A'], [7, 4, 'Z']]), [{ id: 'chainer' }, { id: 'chainer', team: 1 }], { dummies: false });
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    const events = [...tick(sim, { [me!.id]: { move: { x: 0, y: 0 }, super: { aim: { x: 1, y: 0 } } } }), ...run(sim, 60)];
    expect(me!.copiedSuperId).toBeUndefined();
    expect(ofType(events, 'superCopied')).toHaveLength(0);
    expect(me!.superCharge).toBe(0);
    expect(foe!.hp).toBe(foe!.maxHp);
  });

  it('R은 첫 파이터의 궁극기를 한 번 복사하고 15초 뒤 미사용 복사본과 게이지를 지운다', () => {
    const sim = duel(5, 'boulder');
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    tick(sim, { [me!.id]: { move: { x: 0, y: 0 }, super: { aim: { x: 1, y: 0 } } } });
    const events = runUntil(sim, () => !!me!.copiedSuperId, 60);
    expect(me!.copiedSuperId).toBe(foe!.fighterId);
    expect(ofType(events, 'superCopied')).toHaveLength(1);
    expect(me!.superCharge).toBe(1);
    run(sim, 15 * 30);
    expect(me!.copiedSuperId).toBeUndefined();
    expect(me!.superCharge).toBe(0);
  });
});
