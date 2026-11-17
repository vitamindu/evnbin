/** 기기 관련: 전체화면, 가로 고정, 설치(PWA) 여부. */

/** 홈 화면에 설치한 앱(PWA)으로 실행 중인지. 브라우저의 전체화면 API 상태와는 구분한다. */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return window.matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement;
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement || window.matchMedia('(display-mode: fullscreen)').matches;
}

/** 사용자 터치 이벤트 안에서 호출해야 한다(브라우저 정책). */
export async function enterFullscreen(): Promise<void> {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen && !isStandalone()) {
    try {
      await root.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* 거부되면 그냥 진행 */
    }
  }
  await lockLandscape();
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      /* 무시 */
    }
  }
}

async function lockLandscape() {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try {
    await o.lock?.('landscape');
  } catch {
    /* 전체화면이 아니거나 지원하지 않으면 실패한다 */
  }
}

/** 길게 누르기 메뉴, 핀치 줌, 당겨서 새로고침 등 게임에 방해되는 기본 동작을 막는다. */
export function blockBrowserGestures() {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}
