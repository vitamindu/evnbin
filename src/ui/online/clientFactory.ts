import type { OnlineClient } from '../../net/api';
import { createOnlineClient } from '../../net/client';
import { createFakeOnlineClient } from './fakeClient';

/**
 * 온라인 클라이언트를 만드는 단 한 곳(앱 전체에 하나).
 * - 주소에 `?fakeonline`이 있으면 메모리 안의 가짜 서버(화면 확인·스크린샷용, ui/online/fakeClient.ts).
 * - 아니면 Network 담당의 `createOnlineClient()`(src/net/client.ts).
 */
let client: OnlineClient | null = null;

export function isFakeOnline(): boolean {
  return new URLSearchParams(location.search).has('fakeonline');
}

export function getOnlineClient(): OnlineClient {
  if (client) return client;
  if (isFakeOnline()) {
    const fake = createFakeOnlineClient();
    (window as unknown as { __fgFakeOnline?: typeof fake }).__fgFakeOnline = fake;
    client = fake;
  } else {
    client = createOnlineClient();
  }
  return client;
}
