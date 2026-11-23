/** 전적 클라이언트(로그인 필요). 서버가 계정마다 최근 30판과 전체 합계를 남긴다 */
import { authed } from './account';
import type { HistoryResponse } from './accountApi';

export type { HistoryResponse, HistoryTotals, MatchRecord } from './accountApi';

export const getHistory = () => authed<HistoryResponse>('GET', '/api/history');
