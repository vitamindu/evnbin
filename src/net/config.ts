/**
 * 게임 서버 주소. Network 담당. UI(설정 화면)가 getServerUrl/setServerUrl로 읽고 바꾼다.
 *
 * 기본값: 빌드할 때 VITE_SERVER_URL(예: wss://game.example.com), 없으면 ws://localhost:8787.
 * 바꾼 값은 기기에 저장(localStorage). 저장소를 못 쓰는 환경이면 이번 실행 동안만 기억한다.
 * 주의: https로 서비스되는 페이지에서는 브라우저가 ws://(암호화 안 됨)를 막는다 → 배포 서버는 wss://.
 */
const KEY = 'fg.server.v1';

export const DEFAULT_SERVER_URL: string = (import.meta.env?.VITE_SERVER_URL as string | undefined) || 'ws://localhost:8787';

let memory: string | null = null;

/**
 * 사용자가 입력한 주소를 웹소켓 주소로 다듬는다.
 *  "game.example.com" → "wss://game.example.com", "http://x" → "ws://x", "https://x" → "wss://x".
 *  localhost·IP 주소에 스킴이 없으면 ws://. 끝의 "/"는 뗀다. 잘못된 주소면 null.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0] ?? '';
    const local = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith('.local');
    s = (local ? 'ws://' : 'wss://') + s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    if (!u.hostname) return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** 지금 쓸 서버 주소(저장한 값 → 빌드 기본값) */
export function getServerUrl(): string {
  if (memory) return memory;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    /* 저장소 없음 */
  }
  return DEFAULT_SERVER_URL;
}

/**
 * 서버 주소 저장. 빈 값·null이면 기본값으로 되돌린다.
 * 다듬은 주소를 돌려준다(잘못된 주소면 저장하지 않고 null).
 */
export function setServerUrl(url: string | null): string | null {
  if (url === null || url.trim() === '') {
    memory = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 무시 */
    }
    return DEFAULT_SERVER_URL;
  }
  const norm = normalizeServerUrl(url);
  if (!norm) return null;
  memory = norm;
  try {
    localStorage.setItem(KEY, norm);
  } catch {
    /* 이번 실행 동안만 기억 */
  }
  return norm;
}

/** 서버의 상태 확인 주소(ws → http). 연결 전에 서버가 깨어 있는지 볼 때 */
export function healthUrl(wsUrl: string = getServerUrl()): string {
  return wsUrl.replace(/^ws/i, 'http').replace(/\/$/, '') + '/health';
}
