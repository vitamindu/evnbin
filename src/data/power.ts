/**
 * 캐릭터 레벨(파워) 1~11. 레벨마다 기본 체력·피해량의 POWER_STEP(10%)만큼 똑같이 늘어난다(11레벨 = 기본의 2배).
 * 레벨 업에는 코인이 든다(UPGRADE_COST[현재 레벨]). 관리자 계정은 코인이 들지 않는다(무한).
 */
export const MAX_POWER = 11;
export const POWER_STEP = 0.1;

/** 레벨 → 체력·피해량 배율 */
export function powerMult(level: number | undefined): number {
  const lv = Math.min(MAX_POWER, Math.max(1, Math.floor(level ?? 1)));
  return 1 + POWER_STEP * (lv - 1);
}

/** 레벨 n → n+1 비용(코인). 인덱스 = 지금 레벨 */
export const UPGRADE_COST: readonly number[] = [0, 40, 80, 130, 200, 300, 420, 580, 780, 1050, 1400];

export function upgradeCost(level: number): number | null {
  return level >= 1 && level < MAX_POWER ? UPGRADE_COST[level]! : null;
}
