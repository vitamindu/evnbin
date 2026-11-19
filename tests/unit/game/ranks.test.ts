import { describe, expect, it } from 'vitest';
import { isRankedMatch, rankLabel, rankOf } from '../../../src/data/ranks';

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
