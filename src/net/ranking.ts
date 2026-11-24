/** 랭킹 클라이언트(로그인 필요). 서버 전체, 랭크 점수 순 */
import { authed } from './account';
import type { RankingResponse } from './accountApi';

export type { RankingEntry, RankingResponse } from './accountApi';

export const getRanking = () => authed<RankingResponse>('GET', '/api/ranking');
