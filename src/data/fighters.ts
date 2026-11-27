/**
 * 캐릭터(파이터) 정의. 전투 로직·UI·3D 모델이 모두 이 데이터를 읽는다.
 * 수치는 FIGHT GUYS 자체 초안 값이며, 전투 단계에서 플레이 테스트로 조정한다.
 * 거리 단위는 타일(1타일 = 월드 1유닛), 시간 단위는 초.
 */

export type FighterId = 'rivet' | 'volley' | 'boulder' | 'hinako' | 'fuse' | 'shard' | 'grizzle' | 'prism' | 'reaper' | 'fister' | 'chainer';
export type Role = 'scatter' | 'marksman' | 'tank' | 'sniper' | 'thrower' | 'control' | 'brawler' | 'bouncer' | 'assassin';

/** 기본 공격 형태. 새 캐릭터는 가능하면 이 조합으로 표현하고, 부족할 때만 종류를 추가한다. */
export type AttackKind =
  | 'dash' // 기본 공격으로 짧게 돌진하며 지나가는 적에게 피해(REAPER)
  | 'spread' // 부채꼴로 여러 발 동시 발사
  | 'burst' // 같은 방향으로 여러 발을 짧은 간격으로 연사
  | 'melee' // 전방 부채꼴 범위 즉시 판정
  | 'lob' // 지점 조준, 벽을 넘는 포물선
  | 'radial' // 자기 주변 360도로 발사
  | 'chain'; // 직선 사슬과 지연 폭발

export type SuperKind =
  | AttackKind
  | 'dash' // 조준 방향으로 긴 돌진
  | 'leap' // 조준 지점으로 높이 뛰어 벽을 넘어 이동, 뛴 자리에 폭탄을 떨어뜨림
  | 'zone' // 조준 지점(포물선)에 일정 시간 남는 지대: 안의 적을 느리게 하고 계속 피해
  | 'steal'; // 직선 사슬로 첫 파이터의 궁극기를 복사

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
  /** 탄이 맞거나 사거리 끝에 닿으면 사방으로 파편이 갈라져 나간다 */
  split?: { count: number; damage: number; range: number; speed: number };
  /** burst: 탄이 좌우로 번갈아 나가는 옆 간격(타일). 0이면 한 줄 */
  lateralOffset?: number;
  /** 벽에 닿으면 튕겨 나가는 횟수(튕겨도 남은 사거리만큼만 날아간다). 0이면 벽에서 사라짐 */
  bounces?: number;
  /** lob: 착탄 범위 반지름(타일) */
  aoeRadius?: number;
  /** 거리 비례 피해: 사거리 끝까지 날아갔을 때의 피해량(가까울수록 damage에 가깝다) */
  damageFar?: number;
  /** lob: 땅에 떨어진 뒤 터지기까지(초). 없으면 떨어지자마자 */
  fuse?: number;
  /** 흡혈: 준 피해의 이 비율만큼 내 체력 회복(0~1) */
  lifesteal?: number;
  /** chain: 조준한 바닥 지점을 사슬로 내리친다. delay초 뒤 반지름 radius 안의 모든 적이 동시에 damage를 받는다 */
  chainSlam?: { radius: number; delay: number; chainDamage: number };
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
  /** zone: 지대 반지름(타일), 유지 시간(초), 이동 속도 감소 비율(0~1), 초당 피해 */
  zone?: { radius: number; duration: number; slow: number; dps: number };
  /** 벽에 닿으면 튕겨 나가는 횟수 */
  bounces?: number;
  /** leap: true면 폭탄 대신 착지 지점 둘레(aoeRadius)에 damage 피해 + 넉백(내려찍기) */
  slam?: boolean;
  /** 흡혈: 준 피해의 이 비율만큼 내 체력 회복(0~1) */
  lifesteal?: number;
  /** 투사체 반지름(타일). 없으면 기본. 넓게 퍼지는 궁극기(REAPER 박쥐 떼 같은)용 */
  projectileRadius?: number;
  /** leap: true면 착지 피해·폭탄 없이 이동만(FISTER) */
  moveOnly?: boolean;
  /** leap: 공중에 떠 있는 시간(초) */
  leapTime?: number;
  /** leap: 폭탄이 떨어져 터지기까지의 시간(초). lob: 땅에 떨어진 뒤 터지기까지(초, 없으면 바로) */
  fuse?: number;
}

export interface FighterPalette {
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  dark: string;
}

/** glb 무기를 손에 쥐는 방법. 없으면 HINAKO 총 기준 */
export interface WeaponFit {
  /** 원본에서 무기가 길게 놓인 축 */
  axis: 'x' | 'y';
  /** 무기 길이(캐릭터 키 1.75 기준) */
  length: number;
  /** 쥐는 위치: 그 축 방향으로 -1(아래/총구) ~ 1(위/개머리판) */
  grip: number;
  /** 손 위치(발바닥 y=0, 정면 +z) */
  hand: [number, number, number];
  /** 쥔 자세(라디안) */
  rot: [number, number, number];
}

export interface FighterDef {
  id: FighterId;
  /** 3D 모델: 기본 도형으로 만든 임시 모델 또는 glb 파일(public/models/) */
  model: { type: 'primitive' } | { type: 'glb'; body: string; weapon?: string; weaponFit?: WeaponFit };
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
  /** Chainer 고유 동작 */
  chainKit?: {
    passiveRadius: number;
    passiveDamage: number;
    passiveMaxStacks: number;
    /** E1 재사용 대기시간(초). 콤보(E1→E2→W)가 끝난 순간부터 센다 */
    skillCooldown: number;
    /** E1: 짧은 돌진 거리(타일)와 속도(타일/초) */
    dashRange: number;
    dashSpeed: number;
    /** E2·W를 쓸 수 있는 제한 시간(초). 넘기면 콤보가 끝나고 E1 대기시간으로 돌아간다 */
    comboWindow: number;
    /** E: 사슬에 맞은 대상에게 날아가는 속도(타일/초) */
    pullSpeed: number;
    chainRange: number;
    chainDamage: number;
    stunDuration: number;
    wRange: number;
    /** W: 대상 쪽으로 짧게 돌진하는 최대 거리(타일). 이미 붙어 있으면 안 움직인다 */
    wDash: number;
    wMaxHpDamage: number;
    wHealFraction: number;
    stealRange: number;
    copiedSuperDuration: number;
  };
  /** 시간이 지나면 궁극기가 저절로 차는 양(초당, 0~1). FISTER */
  superChargePerSec?: number;
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
      damage: 288,
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
      damage: 288,
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
    model: { type: 'primitive' },
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
      reload: 3.85,
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
      leapTime: 1.25,
      fuse: 2,
    },
  },
  {
    id: 'fuse',
    model: { type: 'primitive' },
    name: 'FUSE',
    role: 'thrower',
    roleLabel: '투척형',
    tagline: '축제 불꽃놀이를 만드는 장인. 벽 뒤에 숨어도 소용없어요.',
    palette: { primary: '#ff5d73', secondary: '#2b2f6b', accent: '#ffd23f', skin: '#f2c19a', dark: '#5a1d2a' },
    hp: 2600,
    moveSpeed: 2.35,
    attack: {
      name: 'Popper Toss',
      description: '작은 폭죽 폭탄 2개를 벽 너머로 던져요. 떨어진 자리에서 터져요.',
      kind: 'lob',
      damage: 560,
      count: 2,
      spreadDeg: 0,
      burstInterval: 0,
      range: 5.6,
      projectileSpeed: 0,
      ammo: 3,
      reload: 1.9,
      superChargePerHit: 0.12,
      aoeRadius: 0.9,
      fuse: 0.5,
    },
    super: {
      name: 'Grand Finale',
      description: '큰 불꽃 폭탄을 던져 넓은 범위를 터뜨리고 벽을 부수며 적을 밀어내요.',
      kind: 'lob',
      damage: 1400,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 0,
      range: 5.6,
      breaksWalls: true,
      knockback: 1.5,
      aoeRadius: 2,
      fuse: 0.5,
    },
  },
  {
    id: 'shard',
    model: { type: 'primitive' },
    name: 'SHARD',
    role: 'control',
    roleLabel: '견제형',
    tagline: '얼음 수정에서 태어난 아이. 닿는 것마다 산산조각 내요.',
    palette: { primary: '#5fd6ff', secondary: '#2a4a9a', accent: '#e6fbff', skin: '#bfefff', dark: '#173062' },
    hp: 2700,
    moveSpeed: 2.35,
    attack: {
      name: 'Shatter Shot',
      description: '얼음 탄이 맞거나 끝까지 날아가면 6갈래 파편으로 갈라져요.',
      kind: 'burst',
      damage: 1040,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      range: 5.2,
      projectileSpeed: 8.5,
      ammo: 3,
      reload: 1.6,
      superChargePerHit: 0.06,
      split: { count: 6, damage: 390, range: 2.2, speed: 8 },
    },
    super: {
      name: 'Frost Field',
      description: '조준한 곳에 서리 지대를 깔아요. 안에 있는 적은 4초 동안 느려지고 계속 피해를 받아요.',
      kind: 'zone',
      damage: 0,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 0,
      range: 5.6,
      breaksWalls: false,
      knockback: 0,
      zone: { radius: 2.2, duration: 4, slow: 0.3, dps: 420 },
    },
  },
  {
    id: 'grizzle',
    model: { type: 'primitive' },
    name: 'GRIZZLE',
    role: 'brawler',
    roleLabel: '근접형',
    tagline: '곰 탈을 쓴 산골 씨름꾼. 일단 붙으면 놓아주지 않아요.',
    palette: { primary: '#8a5a32', secondary: '#e8483a', accent: '#ffd23f', skin: '#e9a777', dark: '#3e2414' },
    hp: 5800,
    moveSpeed: 2.45,
    attack: {
      name: 'Paw Flurry',
      description: '앞발로 4번 빠르게 후려쳐요. 아주 가까이 있어야 맞아요.',
      kind: 'burst',
      damage: 360,
      count: 4,
      spreadDeg: 0,
      burstInterval: 0.08,
      range: 2.2,
      projectileSpeed: 9,
      ammo: 3,
      reload: 1.3,
      superChargePerHit: 0.05,
      lateralOffset: 0.25,
    },
    super: {
      name: 'Mountain Drop',
      description: '높이 뛰어올라 조준한 곳을 내려찍어요. 둘레의 적에게 피해를 주고 밀어내며 벽을 부숴요.',
      kind: 'leap',
      damage: 1200,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 0,
      range: 5.5,
      breaksWalls: true,
      knockback: 1.5,
      aoeRadius: 1.6,
      slam: true,
      leapTime: 0.8,
    },
  },
  {
    id: 'prism',
    model: { type: 'primitive' },
    name: 'PRISM',
    role: 'bouncer',
    roleLabel: '반사형',
    tagline: '거울 갑옷을 입은 빛의 곡예사. 벽 뒤도 안전하지 않아요.',
    palette: { primary: '#b38cff', secondary: '#f4f1ff', accent: '#5ff0d0', skin: '#f3c9a6', dark: '#3a2670' },
    hp: 2500,
    moveSpeed: 2.35,
    attack: {
      name: 'Bounce Beam',
      description: '빛 구슬 5발을 연사해요. 벽에 닿으면 튕겨 나가요.',
      kind: 'burst',
      damage: 240,
      count: 5,
      spreadDeg: 0,
      burstInterval: 0.08,
      range: 6.3,
      projectileSpeed: 10,
      ammo: 3,
      reload: 1.6,
      superChargePerHit: 0.035,
      bounces: 3,
    },
    super: {
      name: 'Mirror Storm',
      description: '빛 구슬 12발을 길게 쏟아내요. 벽마다 튕기며 멀리 날아가요.',
      kind: 'burst',
      damage: 260,
      count: 12,
      spreadDeg: 0,
      burstInterval: 0.07,
      projectileSpeed: 11,
      range: 8.4,
      breaksWalls: false,
      knockback: 0,
      bounces: 3,
    },
  },
  {
    id: 'reaper',
    model: { type: 'primitive' },
    name: 'REAPER',
    role: 'assassin',
    roleLabel: '암살자형',
    tagline: '밤의 장의사. 그림자처럼 파고들어 숨을 거둬 간다.',
    palette: { primary: '#3b2a5c', secondary: '#b8a6ff', accent: '#7cffc4', skin: '#d9c8b8', dark: '#160f24' },
    hp: 3800,
    moveSpeed: 2.6,
    attack: {
      name: 'Shadow Step',
      description: '조준한 쪽으로 짧게 돌진하며 지나가는 적을 벤다. 재장전이 느리다.',
      kind: 'dash',
      damage: 900,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      range: 2.8,
      projectileSpeed: 9,
      ammo: 3,
      reload: 2.4,
      superChargePerHit: 0.2,
    },
    super: {
      name: 'Night Swarm',
      description: '넓게 퍼지는 어둠의 떼를 날려 맞은 적의 체력을 빼앗는다.',
      kind: 'burst',
      damage: 1100,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 9,
      range: 7,
      breaksWalls: false,
      knockback: 0,
      pierce: true,
      lifesteal: 1,
      projectileRadius: 0.9,
    },
  },
  {
    id: 'fister',
    model: { type: 'primitive' },
    name: 'FISTER',
    role: 'assassin',
    roleLabel: '암살자형',
    tagline: '거리의 싸움꾼. 때릴수록 살아나는 주먹.',
    palette: { primary: '#2d2d34', secondary: '#ff5a3c', accent: '#ffd23f', skin: '#f1c19c', dark: '#121216' },
    hp: 3600,
    moveSpeed: 2.55,
    superChargePerSec: 0.05,
    attack: {
      name: 'Rapid Jab',
      description: '아주 가까이에서 두 번 빠르게 때리고, 준 피해의 25%만큼 체력을 회복한다.',
      kind: 'burst',
      damage: 600, // 11레벨(×2) 기준 1200×2연타
      count: 2,
      spreadDeg: 0,
      burstInterval: 0.12,
      range: 1.6,
      projectileSpeed: 10,
      ammo: 3,
      reload: 0.6,
      superChargePerHit: 0.03,
      lifesteal: 0.25,
    },
    super: {
      name: 'Rooftop Leap',
      description: '조준한 곳으로 높이 뛰어 들어간다(벽을 넘는다). 궁극기는 시간이 지나면 저절로 찬다.',
      kind: 'leap',
      damage: 0,
      count: 0,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 0,
      range: 5.5,
      breaksWalls: false,
      knockback: 0,
      moveOnly: true,
      leapTime: 0.6,
    },
  },
  {
    id: 'chainer',
    model: { type: 'primitive' },
    name: 'CHAINER',
    role: 'brawler',
    roleLabel: '난투형',
    tagline: '쇠사슬과 족쇄를 끊고 탈출한 도주범.',
    palette: { primary: '#8f492d', secondary: '#3b4554', accent: '#ffc45b', skin: '#d6a782', dark: '#25232a' },
    hp: 4200,
    moveSpeed: 2.5,
    attack: {
      name: 'Chain Burst',
      description: '조준한 바닥(최대 5칸)을 사슬로 내리쳐요. 사슬에 닿으면 250, 0.75초 뒤 사슬이 만난 자리가 터져 작은 원 안의 모든 적이 동시에 750 피해를 받아요.',
      kind: 'chain',
      damage: 750,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      range: 5,
      projectileSpeed: 8,
      ammo: 3,
      reload: 2.1,
      superChargePerHit: 0.05,
      chainSlam: { radius: 0.65, delay: 0.75, chainDamage: 250 }, // 11레벨(×2) 기준 사슬 500 + 폭발 1500
    },
    super: {
      name: 'Stolen Force',
      description: '사거리 7칸의 사슬로 처음 맞힌 적의 궁극기를 빼앗아요. 복사한 궁극기는 15초 안에 한 번 써야 해요.',
      kind: 'steal',
      damage: 0,
      count: 1,
      spreadDeg: 0,
      burstInterval: 0,
      projectileSpeed: 11,
      range: 7,
      breaksWalls: false,
      knockback: 0,
    },
    chainKit: {
      passiveRadius: 1.5,
      passiveDamage: 500,
      passiveMaxStacks: 3,
      skillCooldown: 7,
      dashRange: 1.5,
      dashSpeed: 9,
      comboWindow: 5,
      pullSpeed: 16,
      chainRange: 4.5,
      chainDamage: 375,
      stunDuration: 1,
      wRange: 1.5,
      wDash: 0.8,
      wMaxHpDamage: 0.3,
      wHealFraction: 1,
      stealRange: 7,
      copiedSuperDuration: 15,
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
