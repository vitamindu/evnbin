/**
 * 랭크(티어) 규칙. 서버와 클라이언트가 같이 쓴다(DOM import 금지).
 * 브론즈~다이아: 단계 IV→I, 단계마다 100점. 마스터 이상은 점수 문턱(친구끼리라 순위제 대신).
 */
export type TierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master' | 'grandmaster' | 'challenger';

export interface TierDef {
  id: TierId;
  name: string;
  /** 이 티어가 시작하는 점수 */
  min: number;
  /** 단계(IV~I)가 있는가 */
  divisions: boolean;
  /** 문양 색: 밝은 면, 어두운 면, 보석 */
  colors: { light: string; dark: string; gem: string };
}

export const TIERS: readonly TierDef[] = [
  { id: 'bronze', name: 'BRONZE', min: 0, divisions: true, colors: { light: '#e0a26b', dark: '#7a4626', gem: '#ffcf9a' } },
  { id: 'silver', name: 'SILVER', min: 400, divisions: true, colors: { light: '#dfe6ee', dark: '#6d7a8a', gem: '#ffffff' } },
  { id: 'gold', name: 'GOLD', min: 800, divisions: true, colors: { light: '#ffe27a', dark: '#b07a12', gem: '#fff6c8' } },
  { id: 'platinum', name: 'PLATINUM', min: 1200, divisions: true, colors: { light: '#9ff0df', dark: '#2a8a7c', gem: '#e6fffa' } },
  { id: 'diamond', name: 'DIAMOND', min: 1600, divisions: true, colors: { light: '#a9c8ff', dark: '#3a4fb8', gem: '#e8f1ff' } },
  { id: 'master', name: 'MASTER', min: 2000, divisions: false, colors: { light: '#d7a6ff', dark: '#6a2fa8', gem: '#f6e8ff' } },
  { id: 'grandmaster', name: 'GRANDMASTER', min: 2500, divisions: false, colors: { light: '#ff9a8a', dark: '#a8232c', gem: '#ffe1da' } },
  { id: 'challenger', name: 'CHALLENGER', min: 3000, divisions: false, colors: { light: '#bfe9ff', dark: '#1f5fa0', gem: '#ffe680' } },
];

export const DIVISION_POINTS = 100;
export const DIVISION_NAMES = ['IV', 'III', 'II', 'I'] as const;

/** 경기 결과에 따른 점수 변화 */
export const RANK_WIN = 20;
export const RANK_LOSS = -15;
export const RANK_DRAW = 0;

export interface RankInfo {
  tier: TierDef;
  /** 'IV'~'I', 단계가 없는 티어면 null */
  division: (typeof DIVISION_NAMES)[number] | null;
  points: number;
  /** 현재 단계(또는 티어) 안에서의 진행: from 이상 to 미만, to가 null이면 끝없음 */
  from: number;
  to: number | null;
}

export function rankOf(points: number): RankInfo {
  const p = Math.max(0, Math.floor(points));
  let tier = TIERS[0]!;
  for (const t of TIERS) if (p >= t.min) tier = t;
  const idx = TIERS.indexOf(tier);
  const next = TIERS[idx + 1];
  if (tier.divisions) {
    const d = Math.min(3, Math.floor((p - tier.min) / DIVISION_POINTS));
    const from = tier.min + d * DIVISION_POINTS;
    return { tier, division: DIVISION_NAMES[d]!, points: p, from, to: from + DIVISION_POINTS };
  }
  return { tier, division: null, points: p, from: tier.min, to: next ? next.min : null };
}

export function rankLabel(r: RankInfo): string {
  return r.division ? `${r.tier.name} ${r.division}` : r.tier.name;
}

/** 랭크 점수가 바뀌는 경기인가: 양 팀 모두 사람(봇 제외) 3명 이상이고 인원이 같아야 한다 */
export const RANKED_MIN_PER_TEAM = 3;
export function isRankedMatch(humansPerTeam: readonly [number, number]): boolean {
  return humansPerTeam[0] === humansPerTeam[1] && humansPerTeam[0] >= RANKED_MIN_PER_TEAM;
}

export function rankDelta(outcome: 'win' | 'loss' | 'draw'): number {
  return outcome === 'win' ? RANK_WIN : outcome === 'loss' ? RANK_LOSS : RANK_DRAW;
}
