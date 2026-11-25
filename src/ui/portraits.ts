import type { FighterId } from '../data/fighters';
import { equippedSkin, getProfile } from '../state/profile';
import type { AppContext } from './context';

/** 초상화 이미지: 스킨이 있으면 그 스킨 모델로 그린 것, 없으면 기본 */
export function portraitSrc(ctx: AppContext, id: FighterId, skin?: string): string {
  return (skin && ctx.skinPortraits[skin]) || ctx.portraits[id];
}

/** 내 캐릭터 초상화: 지금 입힌 스킨 기준 */
export function myPortraitSrc(ctx: AppContext, id: FighterId): string {
  return portraitSrc(ctx, id, equippedSkin(getProfile(), id));
}
