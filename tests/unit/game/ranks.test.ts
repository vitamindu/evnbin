import { describe, expect, it } from 'vitest';
import { isRankedMatch, rankDelta, rankLabel, rankOf } from '../../../src/data/ranks';

describe('랭크', () => {
  it('점수 → 티어·단계', () => {
    expect(rankLabel(rankOf(0))).toBe('BRONZE IV');
    expect(rankLabel(rankOf(399))).toBe('BRONZE I');
    expect(rankLabel(rankOf(400))).toBe('SILVER IV');
    expect(rankLabel(rankOf(1999))).toBe('DIAMOND I');
    expect(rankLabel(rankOf(2000))).toBe('MASTER');
    expect(rankLabel(rankOf(2500))).toBe('GRANDMASTER');
    expect(rankLabel(rankOf(9999))).toBe('CHALLENGER');
    expect(rankOf(-50).points).toBe(0);
  });
  it('랭크 경기: 양 팀 사람 3명 이상·동수만', () => {
    expect(isRankedMatch([3, 3])).toBe(true);
    expect(isRankedMatch([4, 4])).toBe(true);
    expect(isRankedMatch([1, 1])).toBe(false);
    expect(isRankedMatch([3, 2])).toBe(false);
    expect(isRankedMatch([2, 2])).toBe(false);
  });
});

describe('점수 변화(피해량 순위 확률)', () => {
  const avg = (outcome: 'win' | 'loss', place: number, n = 2000) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += rankDelta(outcome, place, 3, (i + 0.5) / n);
    return s / n;
  };
  it('항상 19~23 폭, 비기면 0', () => {
    for (let i = 0; i < 100; i++) {
      const w = rankDelta('win', i % 3, 3, i / 100);
      const l = rankDelta('loss', i % 3, 3, i / 100);
      expect(w).toBeGreaterThanOrEqual(19);
      expect(w).toBeLessThanOrEqual(23);
      expect(l).toBeLessThanOrEqual(-19);
      expect(l).toBeGreaterThanOrEqual(-23);
    }
    expect(rankDelta('draw', 0, 3, 0.5)).toBe(0);
  });
  it('이기면 1등이 더 많이, 지면 1등이 덜 잃는다', () => {
    expect(avg('win', 0)).toBeGreaterThan(22);
    expect(avg('win', 2)).toBeLessThan(20);
    expect(avg('loss', 0)).toBeGreaterThan(-20);
    expect(avg('loss', 2)).toBeLessThan(-22);
  });
});
