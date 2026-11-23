import type { HistoryTotals } from '../../net/accountApi';

/** 몇 분 전 / 몇 시간 전 / 며칠 전 */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/** 합계 → 화면에 쓸 숫자들 */
export function summarize(t: HistoryTotals) {
  const winRate = t.games ? Math.round((t.wins / t.games) * 100) : 0;
  const kd = t.deaths ? t.kills / t.deaths : t.kills;
  return { winRate, kd: Math.round(kd * 100) / 100, avgDamage: t.games ? Math.round(t.damage / t.games) : 0, avgKills: t.games ? Math.round((t.kills / t.games) * 10) / 10 : 0 };
}

