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
  { id: 'bronze', name: '브론즈', min: 0, divisions: true, colors: { light: '#e0a26b', dark: '#7a4626', gem: '#ffcf9a' } },
  { id: 'silver', name: '실버', min: 400, divisions: true, colors: { light: '#dfe6ee', dark: '#6d7a8a', gem: '#ffffff' } },
  { id: 'gold', name: '골드', min: 800, divisions: true, colors: { light: '#ffe27a', dark: '#b07a12', gem: '#fff6c8' } },
  { id: 'platinum', name: '플래티넘', min: 1200, divisions: true, colors: { light: '#9ff0df', dark: '#2a8a7c', gem: '#e6fffa' } },
  { id: 'diamond', name: '다이아몬드', min: 1600, divisions: true, colors: { light: '#a9c8ff', dark: '#3a4fb8', gem: '#e8f1ff' } },
  { id: 'master', name: '마스터', min: 2000, divisions: false, colors: { light: '#d7a6ff', dark: '#6a2fa8', gem: '#f6e8ff' } },
  { id: 'grandmaster', name: '그랜드마스터', min: 2500, divisions: false, colors: { light: '#ff9a8a', dark: '#a8232c', gem: '#ffe1da' } },
  { id: 'challenger', name: '챌린저', min: 3000, divisions: false, colors: { light: '#bfe9ff', dark: '#1f5fa0', gem: '#ffe680' } },
];

export const DIVISION_POINTS = 100;
export const DIVISION_NAMES = ['IV', 'III', 'II', 'I'] as const;

/** 경기 결과에 따른 점수 변화 폭: 이기면 +MIN~+MAX, 지면 −MIN~−MAX, 비기면 0 */
export const RANK_STEP_MIN = 19;
export const RANK_STEP_MAX = 23;

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

/** 랭크 점수가 바뀌는 경기인가: 양 팀의 사람(봇 제외) 수가 같아야 한다(각 팀 1명 이상) */
export const RANKED_MIN_PER_TEAM = 1;
export function isRankedMatch(humansPerTeam: readonly [number, number]): boolean {
  return humansPerTeam[0] === humansPerTeam[1] && humansPerTeam[0] >= RANKED_MIN_PER_TEAM;
}

/**
 * 점수 변화. place: 팀 안 피해량 순위(0 = 1등), teamSize: 팀 인원(봇 포함), rand: 0 이상 1 미만 난수.
 * 피해량 1등일수록 이기면 +23, 지면 −19 쪽이 나올 확률이 높고, 꼴등일수록 반대(+19 / −23)다.
 */
export function rankDelta(outcome: 'win' | 'loss' | 'draw', place = 0, teamSize = 1, rand: number = Math.random()): number {
  if (outcome === 'draw') return 0;
  const steps = RANK_STEP_MAX - RANK_STEP_MIN; // 4
  // 팀 안에서의 위치 0(꼴등)~1(1등). 혼자면 가운데
  const s = teamSize > 1 ? 1 - Math.min(place, teamSize - 1) / (teamSize - 1) : 0.5;
  // 이기면 높은 순위가 큰 폭, 지면 높은 순위가 작은 폭
  const goodness = outcome === 'win' ? s : 1 - s;
  const target = RANK_STEP_MIN + steps * goodness;
  const weights: number[] = [];
  for (let k = 0; k <= steps; k++) weights.push(Math.exp(-((RANK_STEP_MIN + k - target) ** 2) / 1.2));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand * total;
  let mag = RANK_STEP_MAX;
  for (let k = 0; k <= steps; k++) {
    r -= weights[k]!;
    if (r < 0) {
      mag = RANK_STEP_MIN + k;
      break;
    }
  }
  return outcome === 'win' ? mag : -mag;
}
