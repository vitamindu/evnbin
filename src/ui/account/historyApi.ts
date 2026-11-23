import * as real from '../../net/history';
import type { HistoryResponse, MatchRecord } from '../../net/accountApi';
import { fakeNet, getAccount, isFakeAccounts } from './accountApi';

export type { HistoryResponse, HistoryTotals, MatchRecord } from '../../net/accountApi';

/**
 * 전적 UI 입구. 진짜는 src/net/history.ts.
 * ?fakeonline이면 localStorage(fg.fakehistory.v1:<아이디>)의 기록을 쓴다(없으면 빈 전적). 화면 확인·E2E용.
 */
const fakeKey = () => `fg.fakehistory.v1:${getAccount()?.username.toLowerCase() ?? ''}`;

async function fakeHistory(): Promise<HistoryResponse> {
  if (!getAccount()) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  await fakeNet();
  let records: MatchRecord[] = [];
  try {
    records = JSON.parse(localStorage.getItem(fakeKey()) ?? '[]') as MatchRecord[];
  } catch {
    records = [];
  }
  const totals = { games: 0, wins: 0, draws: 0, losses: 0, kills: 0, deaths: 0, damage: 0, mvps: 0 };
  for (const r of records) {
    totals.games++;
    if (r.outcome === 'win') totals.wins++;
    else if (r.outcome === 'draw') totals.draws++;
    else totals.losses++;
    totals.kills += r.kills;
    totals.deaths += r.deaths;
    totals.damage += r.damage;
    if (r.mvp) totals.mvps++;
  }
  return { records, totals };
}

export const getHistory = (): Promise<HistoryResponse> => (isFakeAccounts() ? fakeHistory() : real.getHistory());
