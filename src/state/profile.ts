import { FIGHTERS, type FighterId } from '../data/fighters';

/** 플레이어 프로필. 지금은 기기 로컬 저장, 로그인 단계에서 서버 저장으로 옮긴다. */
export interface FighterProgress {
  trophies: number;
  power: number;
}

export interface Profile {
  name: string;
  tag: string;
  level: number;
  coins: number;
  crystals: number;
  selected: FighterId;
  fighters: Record<FighterId, FighterProgress>;
}

const KEY = 'fg.profile.v1';
type Listener = (p: Profile) => void;
const listeners = new Set<Listener>();

function makeDefault(): Profile {
  const fighters = {} as Record<FighterId, FighterProgress>;
  for (const f of FIGHTERS) fighters[f.id] = { trophies: 0, power: 1 };
  const tag = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('');
  return { name: 'PLAYER', tag, level: 1, coins: 0, crystals: 0, selected: 'rivet', fighters };
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

function save() {
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

export function onProfileChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function totalTrophies(p: Readonly<Profile> = profile): number {
  return Object.values(p.fighters).reduce((s, f) => s + f.trophies, 0);
}

export function resetProfile() {
  profile = makeDefault();
  save();
  for (const l of listeners) l(profile);
}
