import { describe, expect, it } from 'vitest';
import { isRankedMatch, rankDelta, rankLabel, rankOf } from '../../../src/data/ranks';

describe('랭크', () => {
  it('점수 → 티어·단계: 티어마다 100점, 단계마다 25점', () => {
    expect(rankLabel(rankOf(0))).toBe('브론즈 IV');
    expect(rankLabel(rankOf(24))).toBe('브론즈 IV');
    expect(rankLabel(rankOf(25))).toBe('브론즈 III');
    expect(rankLabel(rankOf(50))).toBe('브론즈 II');
    expect(rankLabel(rankOf(99))).toBe('브론즈 I');
    expect(rankLabel(rankOf(100))).toBe('실버 IV');
    expect(rankLabel(rankOf(250))).toBe('골드 II');
    expect(rankLabel(rankOf(399))).toBe('플래티넘 I');
    expect(rankLabel(rankOf(499))).toBe('다이아몬드 I');
    expect(rankLabel(rankOf(500))).toBe('마스터 IV');
    expect(rankLabel(rankOf(675))).toBe('그랜드마스터 I');
    expect(rankLabel(rankOf(700))).toBe('챌린저 IV');
    expect(rankLabel(rankOf(9999))).toBe('챌린저 I');
    expect(rankOf(9999).to).toBeNull();
    expect(rankOf(690)).toMatchObject({ from: 675, to: 700 });
    expect(rankOf(-50).points).toBe(0);
  });
  it('랭크 경기: 양 팀 사람 수가 같을 때만(봇 제외)', () => {
    expect(isRankedMatch([3, 3])).toBe(true);
    expect(isRankedMatch([1, 1])).toBe(true);
    expect(isRankedMatch([2, 2])).toBe(true);
    expect(isRankedMatch([3, 2])).toBe(false);
    expect(isRankedMatch([1, 0])).toBe(false);
    expect(isRankedMatch([0, 0])).toBe(false);
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
