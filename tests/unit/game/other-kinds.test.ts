import { describe, expect, it } from 'vitest';
import { getFighter, type AttackDef } from '../../../src/data/fighters';
import { DEFAULT_LOB_AOE } from '../../../src/game/rules';
import { Tile } from '../../../src/game/world';
import { attack, dummies, fighters, makeSim, ofType, run, testMap, tick } from './helpers';

/**
 * 지금 캐릭터는 쓰지 않는 공격 종류(radial·melee·lob). 데이터만 바꿔서 시뮬레이션이 처리하는지 본다.
 * 데이터는 테스트가 끝나면 원래대로 돌린다.
 */
function withAttack(patch: Partial<AttackDef>, fn: () => void) {
  const def = getFighter('rivet').attack;
  const saved = { ...def };
  Object.assign(def, patch);
  try {
    fn();
  } finally {
    Object.assign(def, saved);
  }
}

describe('그 밖의 공격 종류', () => {
  it('radial: 자기 주변 360도로 균등하게 쏜다', () =>
    withAttack({ kind: 'radial', count: 8 }, () => {
      const sim = makeSim(testMap(20, 12, [[8, 5, 'A']]), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
      const angles = sim.projectiles.map((q) => Math.atan2(q.vel.y, q.vel.x)).map((a) => (a + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
      expect(angles).toHaveLength(8);
      angles.forEach((a, i) => expect(a).toBeCloseTo((i * Math.PI) / 4, 6));
    }));

  it('melee: 전방 부채꼴 안의 적만 즉시 맞고 melee 사건이 나온다', () =>
    withAttack({ kind: 'melee', count: 1, spreadDeg: 90, range: 2 }, () => {
      const sim = makeSim(testMap(20, 9, [[1, 4, 'd'], [3, 4, 'A'], [5, 4, 'd']]), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      const [behind, front] = dummies(sim);
      const events = tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
      expect(ofType(events, 'melee')).toEqual([{ type: 'melee', unitId: p.id, isSuper: false, dir: 0, range: 2, spreadDeg: 90 }]);
      expect(ofType(events, 'hit').map((h) => h.targetId)).toEqual([front!.id]);
      expect(behind!.hp).toBe(behind!.maxHp);
      expect(p.superCharge).toBeCloseTo(getFighter('rivet').attack.superChargePerHit, 9);
    }));

  it('lob: 벽을 넘어 조준 지점에 떨어져 범위 피해', () =>
    withAttack({ kind: 'lob', count: 1, range: 7, projectileSpeed: 8 }, () => {
      const marks: Array<[number, number, string]> = [[2, 4, 'A'], [5, 4, 'd']];
      for (let y = 1; y <= 7; y++) marks.push([4, y, 'X']);
      const sim = makeSim(testMap(20, 9, marks), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      const d = dummies(sim)[0]!;
      tick(sim, { [p.id]: attack({ x: 0.5, y: 0 }) });
      expect(sim.lobs).toHaveLength(1);
      const lob = sim.lobs[0]!;
      expect(lob.to.x).toBeCloseTo(6, 6);
      expect(lob.aoeRadius).toBe(DEFAULT_LOB_AOE);
      expect(lob.endTick - lob.startTick).toBe(Math.round((3.5 / 8) * 30));
      const events = run(sim, lob.endTick - sim.tick);
      expect(sim.lobs).toHaveLength(0);
      expect(ofType(events, 'explode')).toHaveLength(1);
      expect(ofType(events, 'hit').map((h) => h.targetId)).toEqual([d.id]);
      expect(sim.grid.get(4, 4)).toBe(Tile.HardWall);
    }));
});
