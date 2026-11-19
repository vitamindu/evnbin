/**
 * 캐릭터(파이터) 정의. 전투 로직·UI·3D 모델이 모두 이 데이터를 읽는다.
 * 수치는 FIGHT GUYS 자체 초안 값이며, 전투 단계에서 플레이 테스트로 조정한다.
 * 거리 단위는 타일(1타일 = 월드 1유닛), 시간 단위는 초.
 */

export type FighterId = 'rivet' | 'volley' | 'boulder' | 'hinako';
export type Role = 'scatter' | 'marksman' | 'tank' | 'sniper';

/** 기본 공격 형태. 새 캐릭터는 가능하면 이 조합으로 표현하고, 부족할 때만 종류를 추가한다. */
export type AttackKind =
  | 'spread' // 부채꼴로 여러 발 동시 발사
  | 'burst' // 같은 방향으로 여러 발을 짧은 간격으로 연사
  | 'melee' // 전방 부채꼴 범위 즉시 판정
  | 'lob' // 지점 조준, 벽을 넘는 포물선
  | 'radial'; // 자기 주변 360도로 발사

export type SuperKind =
  | AttackKind
  | 'dash' // 조준 방향으로 긴 돌진
  | 'leap'; // 조준 지점으로 높이 뛰어 벽을 넘어 이동, 뛴 자리에 폭탄을 떨어뜨림

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
  /** spread: 탄마다 속도를 ±이 비율만큼 다르게 해서 흩어져 날아가게 한다(0이면 모두 같은 속도) */
  speedJitter?: number;
  /** true면 탄이 모든 대상을 관통한다 */
  pierce?: boolean;
  /** burst: 탄이 좌우로 번갈아 나가는 옆 간격(타일). 0이면 한 줄 */
  lateralOffset?: number;
  /** lob: 착탄 범위 반지름(타일) */
  aoeRadius?: number;
  /** 거리 비례 피해: 사거리 끝까지 날아갔을 때의 피해량(가까울수록 damage에 가깝다) */
  damageFar?: number;
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
  /** burst: 탄이 좌우로 번갈아 나가는 옆 간격(타일) */
  lateralOffset?: number;
  /** spread: 탄마다 속도를 ±이 비율만큼 다르게 해서 흩어져 날아가게 한다(0이면 모두 같은 속도) */
  speedJitter?: number;
  /** true면 탄이 모든 대상을 관통한다(맞힌 대상마다 한 번씩 피해) */
  pierce?: boolean;
  /** leap: 공중에 떠 있는 시간(초) */
  leapTime?: number;
  /** leap: 폭탄이 떨어져 터지기까지의 시간(초) */
  fuse?: number;
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
  /** 3D 모델: 기본 도형으로 만든 임시 모델 또는 glb 파일(public/models/) */
  model: { type: 'primitive' } | { type: 'glb'; body: string; weapon?: string };
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
    model: { type: 'primitive' },
    name: 'RIVET',
    role: 'scatter',
    roleLabel: '산탄형',
    tagline: '고물상 정비공. 모든 문제를 리벳 대포로 해결한다.',
    palette: { primary: '#ff8a2a', secondary: '#1aa39a', accent: '#ffd23f', skin: '#f2b48a', dark: '#6b2f0e' },
    hp: 3800,
    moveSpeed: 2.28,
    attack: {
      name: 'Rivet Spray',
      description: '리벳 5발을 부채꼴로 쏜다. 가까울수록 많이 맞는다.',
      kind: 'spread',
      damage: 300,
      count: 5,
      spreadDeg: 30,
      burstInterval: 0,
      range: 5.25,
      projectileSpeed: 9,
      ammo: 3,
      reload: 1.5,
      superChargePerHit: 0.04,
    },
    super: {
      name: 'Scrap Cannon',
      description: '더 넓고 멀리 무거운 리벳 9발을 쏜다. 벽을 부수고 적을 밀쳐 낸다.',
      kind: 'spread',
      damage: 320,
      count: 7,
      spreadDeg: 46,
      burstInterval: 0,
      projectileSpeed: 6.5,
      range: 5.95,
      breaksWalls: true,
      knockback: 2.5,
      speedJitter: 0.25,
    },
  },
  {
    id: 'volley',
    model: { type: 'primitive' },
    name: 'VOLLEY',
    role: 'marksman',
    roleLabel: '연사형',
    tagline: '신호탑의 명사수. 박자 한 번 놓치는 법이 없다.',
    palette: { primary: '#2fb8e8', secondary: '#1d2a52', accent: '#7cf3ff', skin: '#c98a5e', dark: '#0e1a3a' },
    hp: 2800,
    moveSpeed: 2.52,
    attack: {
      name: 'Pulse Burst',
      description: '좌우로 번갈아 가며 6발을 일직선으로 빠르게 쏜다.',
      kind: 'burst',
      damage: 320,
      count: 6,
      spreadDeg: 0,
      burstInterval: 0.08,
      range: 6.65,
      projectileSpeed: 10,
      ammo: 3,
      reload: 1.55,
      superChargePerHit: 0.03,
      lateralOffset: 0.15,
    },
    super: {
      name: 'Overdrive',
      description: '사거리가 늘어난 12발을 길게 퍼붓는다. 벽도 뚫고 부순다.',
      kind: 'burst',
      damage: 320,
      count: 12,
      spreadDeg: 0,
      burstInterval: 0.07,
      projectileSpeed: 11,
      range: 7.7,
      breaksWalls: true,
      knockback: 0,
      pierce: true,
    },
  },
  {
    id: 'boulder',
    model: { type: 'primitive' },
    name: 'BOULDER',
    role: 'tank',
    roleLabel: '탱커',
    tagline: '채석장 일꾼. 돌주먹에 브레이크는 없다.',
    palette: { primary: '#5cb847', secondary: '#8d909c', accent: '#ffcf4a', skin: '#e8a46f', dark: '#24461b' },
    hp: 5600,
    moveSpeed: 2.2,
    attack: {
      name: 'Rock Buster',
      description: '돌 파편 5개를 짧고 넓게 날린다. 붙으면 무시무시하다.',
      kind: 'spread',
      damage: 420,
      count: 5,
      spreadDeg: 34,
      burstInterval: 0,
      range: 2.8,
      projectileSpeed: 8,
      ammo: 3,
      reload: 1.7,
      superChargePerHit: 0.05,
    },
    super: {
      name: 'Avalanche Roll',
      description: '앞으로 멀리 돌진하며 벽을 부수고 적을 밀쳐 낸다.',
      kind: 'dash',
      damage: 900,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 4.5,
      range: 6.3,
      breaksWalls: true,
      knockback: 2.5,
    },
  },
  {
    id: 'hinako',
    model: { type: 'glb', body: 'models/hinako.glb', weapon: 'models/hinako_gun.glb' },
    name: 'HINAKO',
    role: 'sniper',
    roleLabel: '저격수',
    tagline: '벚꽃 신사의 조용한 저격수. 거리가 곧 무기다.',
    palette: { primary: '#f29ac0', secondary: '#7a2e45', accent: '#ffd6e8', skin: '#f6dcd2', dark: '#3a1824' },
    hp: 2400,
    moveSpeed: 2.35,
    attack: {
      name: 'Blossom Round',
      description: '멀리 날아가는 한 발. 멀리 갈수록 더 아프다.',
      kind: 'burst',
      damage: 800,
      damageFar: 1700,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      range: 7.35,
      projectileSpeed: 13,
      ammo: 3,
      reload: 2.3,
      superChargePerHit: 0.25,
    },
    super: {
      name: 'Petal Leap',
      description: '벽 너머 원하는 곳으로 멀리 뛰어오르며, 뛴 자리에 벚꽃 폭탄 4개를 남긴다.',
      kind: 'leap',
      damage: 1000,
      count: 4,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 0,
      range: 5.25,
      breaksWalls: false,
      knockback: 0,
      aoeRadius: 1.3,
      leapTime: 0.5,
      fuse: 2,
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
  range: 7.5,
  speed: 3.0,
};
