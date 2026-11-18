/**
 * 게임 서버 주소. 설정 화면에서 바꿀 수 있고 기기에 저장된다.
 * (UI 담당이 만든 최소 버전 — Network 담당의 같은 파일과 병합할 때 Lead가 맞춘다.)
 */
const KEY = 'fg.server.v1';
const DEFAULT_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:8787';

export function getServerUrl(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function setServerUrl(url: string): void {
  const v = url.trim();
  try {
    if (!v || v === DEFAULT_URL) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* 저장 불가 환경: 무시 */
  }
}
