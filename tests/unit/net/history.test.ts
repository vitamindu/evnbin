import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { HISTORY_KEEP, type MatchRecord } from '../../../src/net/accountApi';
import { summarize, timeAgo } from '../../../src/ui/overlays/historyMath';

const dirs: string[] = [];
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-hist-'));
  dirs.push(d);
  return { d, s: new AccountStore(d, Date.now, () => {}) };
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const rec = (i: number, outcome: MatchRecord['outcome']): MatchRecord => ({
  at: 1000 + i,
  mode: 'teamfight',
  mapId: 'arena',
  outcome,
  score: [outcome === 'win' ? 10 : 3, outcome === 'win' ? 3 : 10],
  fighterId: 'rivet',
  kills: 2,
  deaths: 1,
  damage: 5000,
  ranked: false,
  mvp: i % 5 === 0,
  players: [],
});

describe('match history', () => {
  it(`keeps the newest ${HISTORY_KEEP}, totals count every game, survives restart`, async () => {
    const { s, d } = mk();
    await s.signup('hist1', 'secret1', '기록');
    for (let i = 0; i < HISTORY_KEEP + 5; i++) s.recordMatch('hist1', rec(i, i % 3 === 0 ? 'loss' : 'win'));
    const h = s.history('hist1');
    expect(h.records).toHaveLength(HISTORY_KEEP);
    expect(h.records[0]!.at).toBe(1000 + HISTORY_KEEP + 4); // 새 것이 앞
    expect(h.totals.games).toBe(HISTORY_KEEP + 5);
    expect(h.totals.losses).toBe(12);
    expect(h.totals.wins).toBe(23);
    expect(h.totals.kills).toBe(2 * (HISTORY_KEEP + 5));
    expect(h.totals.mvps).toBe(7);
    const again = new AccountStore(d, Date.now, () => {});
    expect(again.history('hist1').totals.games).toBe(HISTORY_KEEP + 5);
    expect(again.history('nobody').records).toEqual([]);
  });

  it('summary math', () => {
    expect(summarize({ games: 4, wins: 3, draws: 0, losses: 1, kills: 9, deaths: 4, damage: 10000, mvps: 1 })).toEqual({ winRate: 75, kd: 2.25, avgDamage: 2500, avgKills: 2.3 });
    expect(summarize({ games: 0, wins: 0, draws: 0, losses: 0, kills: 0, deaths: 0, damage: 0, mvps: 0 })).toEqual({ winRate: 0, kd: 0, avgDamage: 0, avgKills: 0 });
    expect(timeAgo(0, 30_000)).toBe('방금');
    expect(timeAgo(0, 5 * 60_000)).toBe('5분 전');
    expect(timeAgo(0, 3 * 3600_000)).toBe('3시간 전');
    expect(timeAgo(0, 2 * 86400_000)).toBe('2일 전');
  });
});
