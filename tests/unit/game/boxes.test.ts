import { describe, expect, it } from 'vitest';
import { COIN_MAX, COIN_MIN, COIN_STEP, GEM_MAX, GEM_MIN, ITEM_COUNT_ODDS, boxTotals, rollFighterBox } from '../../../src/data/boxes';
import { Rng } from '../../../src/game/rng';

describe('fighter box', () => {
  it('item-count odds add up to exactly 100%', () => {
    expect(ITEM_COUNT_ODDS.reduce((s, [, p]) => s + p, 0)).toBeCloseTo(100, 9);
    expect(ITEM_COUNT_ODDS.map(([n]) => n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('over many boxes: counts follow the table, every item is in range', { timeout: 20_000 }, () => {
    const rng = new Rng(12345);
    const rand = () => rng.next();
    const N = 100_000;
    const seen = new Map<number, number>();
    let coins = 0;
    let gems = 0;
    let bad = 0;
    for (let i = 0; i < N; i++) {
      const items = rollFighterBox(rand);
      seen.set(items.length, (seen.get(items.length) ?? 0) + 1);
      for (const it of items) {
        if (it.kind === 'coins') {
          coins++;
          if (it.amount < COIN_MIN || it.amount > COIN_MAX || it.amount % COIN_STEP) bad++;
        } else {
          gems++;
          if (it.amount < GEM_MIN || it.amount > GEM_MAX) bad++;
        }
      }
    }
    expect(bad).toBe(0);
    for (const [n, pct] of ITEM_COUNT_ODDS) {
      const got = ((seen.get(n) ?? 0) / N) * 100;
      // 표준오차의 약 5배 안
      const tol = 5 * Math.sqrt((pct * (100 - pct)) / N) + 0.02;
      expect(Math.abs(got - pct), `${n} items: ${got.toFixed(3)}% vs ${pct}%`).toBeLessThan(tol);
    }
    expect(coins / (coins + gems)).toBeCloseTo(0.85, 2);
  });

  it('totals add each kind', () => {
    expect(boxTotals([{ kind: 'coins', amount: 120 }, { kind: 'gems', amount: 9 }, { kind: 'coins', amount: 300 }])).toEqual({ coins: 420, gems: 9 });
  });
});
