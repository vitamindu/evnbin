import type { FighterDef, FighterId } from './fighters';

/**
 * 스킨: 같은 캐릭터의 다른 외형. 능력·수치는 바뀌지 않는다.
 * - 기본 외형은 스킨이 아니다(skinId 없음 = 기본).
 * - 관리자(admin) 계정은 모든 스킨을 가진다.
 * - SKIN_SHOP_OPEN이 true면 누구나 경기에서 번 코인(price)으로 산다(서버도 이 값을 따른다). false면 관리자 전용.
 */
export const SKIN_SHOP_OPEN = true;

export interface SkinDef {
  id: string;
  fighterId: FighterId;
  name: string;
  /** 코인 가격 */
  price: number;
  model: FighterDef['model'];
}

export const SKINS: readonly SkinDef[] = [
  {
    id: 'hinako_sakura',
    fighterId: 'hinako',
    name: 'SAKURA HINAKO',
    price: 500,
    model: { type: 'glb', body: 'models/hinako.glb', weapon: 'models/hinako_gun.glb' },
  },
];

export const getSkin = (id: string | null | undefined): SkinDef | undefined => (id ? SKINS.find((s) => s.id === id) : undefined);
export const skinsOf = (fighterId: FighterId): SkinDef[] => SKINS.filter((s) => s.fighterId === fighterId);
