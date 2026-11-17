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
  /** burst: 탄이 좌우로 번갈아 나가는 옆 간격(타일). 0이면 한 줄 */
  lateralOffset?: number;
}

export interface SuperDef {
  name: string;
  description: string;
  kind: SuperKind;
  damage: number;
  count: number;
  /** spread: 전체 퍼짐 각도(도) */
  spreadDeg: number;
  /** burst: 발사 간격(초) */
  burstInterval: number;
  /** 투사체 속도(타일/초). dash면 돌진 속도 */
  projectileSpeed: number;
  range: number;
  /** 벽 파괴 여부 */
  breaksWalls: boolean;
  /** 넉백 거리(타일). 0이면 없음 */
  knockback: number;
  /** lob/폭발형: 착탄 범위 반지름(타일) */
  aoeRadius?: number;
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
      description: 'Fires a fan of 5 rivets. The closer the target, the more rivets hit.',
      kind: 'spread',
      damage: 300,
      count: 5,
      spreadDeg: 30,
      burstInterval: 0,
      range: 7.5,
      projectileSpeed: 16,
      ammo: 3,
      reload: 1.5,
      superChargePerHit: 0.04,
    },
    super: {
      name: 'Scrap Cannon',
      description: 'Fires a wider, longer fan of 9 heavy rivets that smash walls and knock enemies back.',
      kind: 'spread',
      damage: 320,
      count: 9,
      spreadDeg: 46,
      burstInterval: 0,
      projectileSpeed: 16,
      range: 8.5,
      breaksWalls: true,
      knockback: 2.5,
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
      description: 'Fires 6 quick shots in a straight line, alternating left and right.',
      kind: 'burst',
      damage: 320,
      count: 6,
      spreadDeg: 0,
      burstInterval: 0.08,
      range: 9.5,
      projectileSpeed: 20,
      ammo: 3,
      reload: 1.55,
      superChargePerHit: 0.03,
      lateralOffset: 0.15,
    },
    super: {
      name: 'Overdrive',
      description: 'Unloads a long burst of 12 shots with extra range. Shots smash through walls.',
      kind: 'burst',
      damage: 320,
      count: 12,
      spreadDeg: 0,
      burstInterval: 0.07,
      projectileSpeed: 22,
      range: 11,
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
      name: 'Rock Buster',
      description: 'Blasts 5 stone shards in a short, wide fan. Devastating up close.',
      kind: 'spread',
      damage: 420,
      count: 5,
      spreadDeg: 34,
      burstInterval: 0,
      range: 4,
      projectileSpeed: 14,
      ammo: 3,
      reload: 1.7,
      superChargePerHit: 0.05,
    },
    super: {
      name: 'Avalanche Roll',
      description: 'Charges forward a long way, smashing walls and knocking enemies back.',
      kind: 'dash',
      damage: 900,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 9,
      range: 9,
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
  damage: 2400, // 한 번 공격(모든 투사체) 기준
  range: 10,
  speed: 3.6,
};
