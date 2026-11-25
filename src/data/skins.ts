import type { FighterDef, FighterId } from './fighters';

/**
 * 스킨: 같은 캐릭터의 다른 외형. 능력·수치는 바뀌지 않는다.
 * - 기본 외형은 스킨이 아니다(skinId 없음 = 기본).
 * - 관리자(admin) 계정은 모든 스킨을 가진다.
 * - SKIN_SHOP_OPEN이 true면 누구나 다이아(price, 프로필의 crystals)로 산다(서버도 이 값을 따른다). false면 관리자 전용.
 * - 다이아는 아직 얻는 방법이 없다(이후 추가).
 */
export const SKIN_SHOP_OPEN = true;

export interface SkinDef {
  id: string;
  fighterId: FighterId;
  name: string;
  /** 다이아 가격(profile.crystals) */
  price: number;
  model: FighterDef['model'];
  /** 등급: 서사(epic) < 전설(legendary). 전설 스킨은 스킬 이펙트까지 바뀐다 */
  rarity: SkinRarity;
  /** 전설 스킨의 이펙트 교체(흑백 이미지 → 팀 색으로 칠한다. 우리 팀 파랑 / 상대 빨강 규칙 유지) */
  effects?: SkinEffects;
}

export type SkinRarity = 'epic' | 'legendary';
export const RARITY_LABEL: Record<SkinRarity, string> = { epic: '서사', legendary: '전설' };
/** 등급별 기본 가격(다이아) */
export const RARITY_PRICE: Record<SkinRarity, number> = { epic: 100, legendary: 1000 };

/** 이펙트 이미지 경로(public/ 기준). 없는 항목은 기본 이펙트 */
export interface SkinEffects {
  attackShot?: string;
  superShot?: string;
  trail?: string;
  hit?: string;
  superCast?: string;
}

export const SKINS: readonly SkinDef[] = [
  {
    id: 'hinako_sakura',
    fighterId: 'hinako',
    name: 'SAKURA HINAKO',
    price: RARITY_PRICE.epic,
    rarity: 'epic',
    model: { type: 'glb', body: 'models/hinako.glb', weapon: 'models/hinako_gun.glb' },
  },
  {
    id: 'reaper_trueform',
    fighterId: 'reaper',
    name: 'TRUE FORM REAPER',
    price: RARITY_PRICE.legendary,
    rarity: 'legendary',
    model: {
      type: 'glb',
      body: 'models/reaper.glb',
      weapon: 'models/reaper_scythe.glb',
      weaponFit: { axis: 'y', length: 1.7, grip: -0.15, hand: [-0.42, 0.85, 0.12], rot: [0.15, 0, 0.12] },
    },
    effects: {
      trail: 'effects/reaper/trail.png',
      superShot: 'effects/reaper/super.png',
      hit: 'effects/reaper/hit.png',
    },
  },
];

export const getSkin = (id: string | null | undefined): SkinDef | undefined => (id ? SKINS.find((s) => s.id === id) : undefined);
export const skinsOf = (fighterId: FighterId): SkinDef[] => SKINS.filter((s) => s.fighterId === fighterId);
