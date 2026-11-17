/**
 * 캐릭터(파이터) 정의. 전투 로직·UI·3D 모델이 모두 이 데이터를 읽는다.
 * 수치는 FIGHT GUYS 자체 초안 값이며, 전투 단계에서 플레이 테스트로 조정한다.
 * 거리 단위는 타일(1타일 = 월드 1유닛), 시간 단위는 초.
 */

export type FighterId = 'rivet' | 'volley' | 'boulder';
export type Role = 'scatter' | 'marksman' | 'tank';

/** 기본 공격 형태. 새 캐릭터는 가능하면 이 조합으로 표현하고, 부족할 때만 종류를 추가한다. */
export type AttackKind =
  | 'spread' // 부채꼴로 여러 발 동시 발사
  | 'burst' // 같은 방향으로 여러 발을 짧은 간격으로 연사
  | 'melee' // 전방 부채꼴 범위 즉시 판정
  | 'lob' // 지점 조준, 벽을 넘는 포물선
  | 'radial'; // 자기 주변 360도로 발사

export type SuperKind = AttackKind | 'dash';

export interface AttackDef {
  name: string;
  description: string;
  kind: AttackKind;
  /** 투사체(또는 판정) 1개당 피해량 */
  damage: number;
  /** 한 번 공격에 나가는 투사체 수 */
  count: number;
  /** spread/melee: 전체 퍼짐 각도(도) */
  spreadDeg: number;
  /** burst: 발사 간격(초) */
  burstInterval: number;
  /** 최대 사거리(타일) */
  range: number;
  /** 투사체 속도(타일/초). melee는 0 */
  projectileSpeed: number;
  /** 탄창 칸 수 */
  ammo: number;
  /** 1칸 재장전 시간(초) */
  reload: number;
  /** 적중 1회당 궁극기 충전량(0~1). count발 모두 맞으면 count배 */
  superChargePerHit: number;
}

export interface SuperDef {
  name: string;
  description: string;
  kind: SuperKind;
  damage: number;
  count: number;
  range: number;
  /** 벽 파괴 여부 */
  breaksWalls: boolean;
  /** 넉백 거리(타일). 0이면 없음 */
  knockback: number;
}

export interface FighterPalette {
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  dark: string;
}

export interface FighterDef {
  id: FighterId;
  name: string;
  role: Role;
  roleLabel: string;
  tagline: string;
  palette: FighterPalette;
  hp: number;
  /** 이동 속도(타일/초) */
  moveSpeed: number;
  attack: AttackDef;
  super: SuperDef;
}

export const FIGHTERS: readonly FighterDef[] = [
  {
    id: 'rivet',
    name: 'RIVET',
    role: 'scatter',
    roleLabel: 'SCATTER',
    tagline: 'Junkyard mechanic who fixes problems with a rivet cannon.',
    palette: { primary: '#ff8a2a', secondary: '#1aa39a', accent: '#ffd23f', skin: '#f2b48a', dark: '#6b2f0e' },
    hp: 3800,
    moveSpeed: 2.8,
    attack: {
      name: 'Rivet Spray',
      description: 'Fires a wide fan of 5 rivets. Deals the most damage up close.',
      kind: 'spread',
      damage: 320,
      count: 5,
      spreadDeg: 32,
      burstInterval: 0,
      range: 7,
      projectileSpeed: 15,
      ammo: 3,
      reload: 1.6,
      superChargePerHit: 0.045,
    },
    super: {
      name: 'Nail Nova',
      description: 'Blasts 12 rivets in every direction and pushes nearby enemies away.',
      kind: 'radial',
      damage: 380,
      count: 12,
      range: 5,
      breaksWalls: false,
      knockback: 2,
    },
  },
  {
    id: 'volley',
    name: 'VOLLEY',
    role: 'marksman',
    roleLabel: 'MARKSMAN',
    tagline: 'Signal-tower sniper who never misses a beat.',
    palette: { primary: '#2fb8e8', secondary: '#1d2a52', accent: '#7cf3ff', skin: '#c98a5e', dark: '#0e1a3a' },
    hp: 2800,
    moveSpeed: 3.0,
    attack: {
      name: 'Pulse Burst',
      description: 'Fires 4 fast shots in a straight line. Long range, low spread.',
      kind: 'burst',
      damage: 360,
      count: 4,
      spreadDeg: 0,
      burstInterval: 0.09,
      range: 9.5,
      projectileSpeed: 20,
      ammo: 3,
      reload: 1.5,
      superChargePerHit: 0.06,
    },
    super: {
      name: 'Sky Volley',
      description: 'Launches 6 shells over walls onto a target area.',
      kind: 'lob',
      damage: 700,
      count: 6,
      range: 8,
      breaksWalls: true,
      knockback: 0,
    },
  },
  {
    id: 'boulder',
    name: 'BOULDER',
    role: 'tank',
    roleLabel: 'TANK',
    tagline: 'Quarry worker with stone fists and zero brakes.',
    palette: { primary: '#5cb847', secondary: '#8d909c', accent: '#ffcf4a', skin: '#e8a46f', dark: '#24461b' },
    hp: 5600,
    moveSpeed: 3.0,
    attack: {
      name: 'Rock Slam',
      description: 'Smashes the ground in front, hitting everything in a short cone.',
      kind: 'melee',
      damage: 1250,
      count: 1,
      spreadDeg: 80,
      burstInterval: 0,
      range: 2.6,
      projectileSpeed: 0,
      ammo: 3,
      reload: 1.4,
      superChargePerHit: 0.2,
    },
    super: {
      name: 'Avalanche Roll',
      description: 'Curls into a boulder and rolls forward, smashing walls and knocking enemies back.',
      kind: 'dash',
      damage: 1100,
      count: 1,
      range: 7,
      breaksWalls: true,
      knockback: 2.5,
    },
  },
];

export function getFighter(id: FighterId): FighterDef {
  const f = FIGHTERS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fighter: ${id}`);
  return f;
}

/** UI 스탯 막대용 최댓값 */
export const STAT_MAX = {
  hp: 6000,
  damage: 2000, // 한 번 공격(모든 투사체) 기준
  range: 10,
  speed: 3.6,
};
