/** 기기별 설정(그래픽 품질 등). 로컬 저장. */
export type Quality = 'high' | 'low';

export interface Settings {
  quality: Quality;
  showFps: boolean;
}

const KEY = 'fg.settings.v1';
const defaults: Settings = { quality: 'high', showFps: false };
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

let settings: Settings = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : { ...defaults };
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
