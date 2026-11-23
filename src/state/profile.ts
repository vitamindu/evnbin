import { FIGHTERS, type FighterId } from '../data/fighters';

/** 플레이어 프로필. 지금은 기기 로컬 저장, 로그인 단계에서 서버 저장으로 옮긴다. */
export interface FighterProgress {
  trophies: number;
  power: number;
  /** 온라인 경기 수(서버가 센다) */
  games?: number;
}

export interface Profile {
  name: string;
  tag: string;
  level: number;
  coins: number;
  crystals: number;
  selected: FighterId;
  fighters: Record<FighterId, FighterProgress>;
  /** 랭크 점수(TEAM FIGHT 온라인 경기로만 바뀐다, src/data/ranks.ts) */
  rankPoints: number;
  /** 아직 열지 않은 파이터 상자 수(관리자는 무한) */
  boxes?: number;
  /** 프로필 사진(작은 이미지 data URL). 없으면 닉네임 첫 글자 */
  avatar?: string;
  /** 관리자 계정(서버가 정한다). 관리자는 모든 스킨을 쓸 수 있다 */
  admin?: boolean;
  /** 가진 스킨 id(관리자는 서버가 전부 넣어 준다) */
  skins?: string[];
  /** 캐릭터별로 고른 스킨 id(없으면 기본 외형) */
  skinSel?: Partial<Record<FighterId, string>>;
}

const KEY = 'fg.profile.v1';
type Listener = (p: Profile) => void;
const listeners = new Set<Listener>();

function makeDefault(): Profile {
  const fighters = {} as Record<FighterId, FighterProgress>;
  for (const f of FIGHTERS) fighters[f.id] = { trophies: 0, power: 1 };
  const tag = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('');
  return { name: '플레이어', tag, level: 1, coins: 0, crystals: 0, selected: 'rivet', fighters, rankPoints: 0 };
}

function load(): Profile {
  const def = makeDefault();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw) as Partial<Profile>;
    const merged: Profile = { ...def, ...saved, fighters: { ...def.fighters, ...(saved.fighters ?? {}) } };
    if (!FIGHTERS.some((f) => f.id === merged.selected)) merged.selected = def.selected;
    return merged;
  } catch {
    return def;
  }
}

let profile = load();
/** 로그인 중이면 서버 프로필을 쓰고, 기기에는 저장하지 않는다(기기 저장분은 오프라인용으로 남겨 둔다) */
let fromServer = false;

function save() {
  if (fromServer) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 메모리에서만 유지 */
  }
}

export function getProfile(): Readonly<Profile> {
  return profile;
}

export function updateProfile(fn: (p: Profile) => void) {
  fn(profile);
  save();
  for (const l of listeners) l(profile);
}

/**
 * 로그인하면 서버 프로필로 바꾸고(null이면 기기에 저장된 오프라인 프로필로 돌아간다) 화면을 갱신한다.
 * 서버 프로필은 Profile과 같은 모양이며, 빠진 캐릭터 항목은 기본값으로 채운다.
 */
export function useServerProfile(p: Profile | null) {
  if (p) {
    const def = makeDefault();
    profile = { ...def, ...p, fighters: { ...def.fighters, ...(p.fighters ?? {}) } };
    if (!FIGHTERS.some((f) => f.id === profile.selected)) profile.selected = def.selected;
    fromServer = true;
  } else {
    fromServer = false;
    profile = load();
  }
  for (const l of listeners) l(profile);
}

export function isServerProfile(): boolean {
  return fromServer;
}

export function onProfileChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function totalTrophies(p: Readonly<Profile> = profile): number {
  return Object.values(p.fighters).reduce((s, f) => s + f.trophies, 0);
}

export function resetProfile() {
  if (fromServer) return;
  profile = makeDefault();
  save();
  for (const l of listeners) l(profile);
}

/** 이 프로필이 쓸 수 있는 스킨인지 */
export function ownsSkin(p: Readonly<Profile>, skinId: string): boolean {
  return !!p.admin || !!p.skins?.includes(skinId);
}

/** 캐릭터에 지금 입힌 스킨 id(가진 것만, 없으면 undefined = 기본) */
export function equippedSkin(p: Readonly<Profile>, fighterId: FighterId): string | undefined {
  const id = p.skinSel?.[fighterId];
  return id && ownsSkin(p, id) ? id : undefined;
}

/** 가장 많이 쓴 캐릭터: 경기 수 → 트로피 → 지금 선택한 캐릭터 순 */
export function mostPlayedFighter(p: Readonly<Profile>): FighterId {
  let best: FighterId = p.selected;
  let score = [-1, -1];
  for (const f of FIGHTERS) {
    const prog = p.fighters[f.id];
    const s = [prog?.games ?? 0, prog?.trophies ?? 0];
    if (s[0]! > score[0]! || (s[0] === score[0] && s[1]! > score[1]!)) {
      best = f.id;
      score = s;
    }
  }
  return score[0] === 0 && score[1] === 0 ? p.selected : best;
}
