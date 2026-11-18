import type { MatchMode } from '../game/types';

/** 기기별 설정(그래픽 품질 등). 로컬 저장. */
export type Quality = 'high' | 'low';

export interface Settings {
  quality: Quality;
  showFps: boolean;
  /** 로비 모드 카드에서 고른 경기 방식. PLAY가 이 모드로 시작한다(training: 오프라인 연습장, teamfight: 온라인) */
  playMode: MatchMode;
}

const KEY = 'fg.settings.v1';
const defaults: Settings = { quality: 'high', showFps: false, playMode: 'training' };
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

let settings: Settings = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    const s: Settings = raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : { ...defaults };
    if (s.playMode !== 'training' && s.playMode !== 'teamfight') s.playMode = defaults.playMode;
    return s;
  } catch {
    return { ...defaults };
  }
})();

export function getSettings(): Readonly<Settings> {
  return settings;
}

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
  for (const l of listeners) l(settings);
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
