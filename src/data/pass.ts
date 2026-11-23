/**
 * 시즌 패스. 서버가 경험치를 주고 보상을 준다(server/accounts.ts). DOM·Three.js import 금지.
 * - 온라인 경기마다 패스 경험치: 승리 40 / 무승부 25 / 패배 20
 * - 30단계, 단계마다 100 경험치
 * - 무료 보상(누구나)과 프리미엄 보상(다이아로 프리미엄을 산 사람)
 * - 다 받은 단계의 보상은 단계를 눌러 하나씩 받는다
 */
export const SEASON = 1;
export const SEASON_NAME = '시즌 1';
export const PASS_TIERS = 30;
export const XP_PER_TIER = 100;
export const PASS_XP = { win: 40, draw: 25, loss: 20 } as const;
/** 프리미엄 패스 가격(다이아) */
export const PREMIUM_PRICE = 150;

export interface PassReward {
  coins?: number;
  gems?: number;
  boxes?: number;
  /** 스킨 id(이미 가지고 있으면 대신 PASS_SKIN_REFUND 다이아) */
  skin?: string;
}
export const PASS_SKIN_REFUND = 100;

export type PassTrack = 'free' | 'premium';

/** 단계(1~30) → 무료 보상 */
export function freeReward(tier: number): PassReward {
  if (tier % 5 === 0) return { boxes: 1 };
  if (tier % 3 === 0) return { gems: 10 };
  return { coins: 100 + tier * 10 };
}

/** 단계(1~30) → 프리미엄 보상 */
export function premiumReward(tier: number): PassReward {
  if (tier === PASS_TIERS) return { skin: 'hinako_sakura' };
  if (tier % 5 === 0) return { boxes: 2 };
  if (tier % 2 === 0) return { gems: 20 };
  return { coins: 300 };
}

export const rewardOf = (track: PassTrack, tier: number): PassReward => (track === 'free' ? freeReward(tier) : premiumReward(tier));

/** 경험치 → 지금 열린 단계 수(0~30) */
export const tierOf = (xp: number): number => Math.min(PASS_TIERS, Math.floor(Math.max(0, xp) / XP_PER_TIER));

export interface PassState {
  season: number;
  xp: number;
  premium: boolean;
  claimedFree: number[];
  claimedPremium: number[];
}

export const emptyPass = (): PassState => ({ season: SEASON, xp: 0, premium: false, claimedFree: [], claimedPremium: [] });

/** 저장된 값(없거나 지난 시즌)을 이번 시즌 모양으로 */
export function normalizePass(p: Partial<PassState> | undefined): PassState {
  if (!p || p.season !== SEASON) return emptyPass();
  return { season: SEASON, xp: p.xp ?? 0, premium: !!p.premium, claimedFree: [...(p.claimedFree ?? [])], claimedPremium: [...(p.claimedPremium ?? [])] };
}
