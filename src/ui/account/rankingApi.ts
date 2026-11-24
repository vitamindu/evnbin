import * as real from '../../net/ranking';
import type { RankingEntry, RankingResponse } from '../../net/accountApi';
import { fakeNet, getAccount, isFakeAccounts } from './accountApi';

export type { RankingEntry, RankingResponse } from '../../net/accountApi';

/** 랭킹 UI 입구. ?fakeonline이면 가짜 사람 12명 + 나(화면 확인·E2E용) */
const FAKE: Omit<RankingEntry, 'rank'>[] = [
  { nickname: '탄탄', rankPoints: 742, fighterId: 'boulder', guild: 'NightOwls' },
  { nickname: '픽셀', rankPoints: 655, fighterId: 'volley', guild: '벚꽃연합' },
  { nickname: '모찌', rankPoints: 655, fighterId: 'hinako', guild: '벚꽃연합' },
  { nickname: '하늘', rankPoints: 512, fighterId: 'prism' },
  { nickname: '주노', rankPoints: 430, fighterId: 'fuse', guild: '벚꽃연합' },
  { nickname: '별빛', rankPoints: 377, fighterId: 'shard' },
  { nickname: '구름', rankPoints: 260, fighterId: 'grizzle' },
  { nickname: '바람', rankPoints: 188, fighterId: 'rivet' },
  { nickname: '파도', rankPoints: 120, fighterId: 'volley' },
  { nickname: '새싹', rankPoints: 64, fighterId: 'hinako' },
  { nickname: '돌멩이', rankPoints: 20, fighterId: 'boulder' },
  { nickname: '초보', rankPoints: 0, fighterId: 'rivet' },
];

async function fakeRanking(): Promise<RankingResponse> {
  const a = getAccount();
  if (!a) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  await fakeNet();
  const me = { nickname: a.profile.name, rankPoints: a.profile.rankPoints ?? 0, fighterId: a.profile.selected, ...(a.profile.avatar ? { avatar: a.profile.avatar } : {}), ...(a.profile.guild ? { guild: a.profile.guild } : {}) };
  const all = [...FAKE, me].sort((x, y) => y.rankPoints - x.rankPoints);
  let rank = 0;
  let prev = -1;
  const top = all.map((e, i) => {
    if (e.rankPoints !== prev) {
      rank = i + 1;
      prev = e.rankPoints;
    }
    return { ...e, rank };
  });
  return { top, me: top.find((e) => e.nickname === me.nickname) ?? null, total: top.length };
}

export const getRanking = (): Promise<RankingResponse> => (isFakeAccounts() ? fakeRanking() : real.getRanking());
