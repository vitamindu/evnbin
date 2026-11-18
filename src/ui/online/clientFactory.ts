import type { OnlineClient } from '../../net/api';
import { createFakeOnlineClient } from './fakeClient';

/**
 * 온라인 클라이언트를 만드는 단 한 곳(앱 전체에 하나).
 * - 주소에 `?fakeonline`이 있으면 메모리 안의 가짜 서버(화면 확인·스크린샷용, ui/online/fakeClient.ts).
 * - 아니면 Network 담당의 `createOnlineClient()`(src/net/client.ts).
 *
 * 이 파일을 만든 작업 공간에는 src/net/client.ts가 아직 없어서, import.meta.glob으로 "있으면" 불러오고
 * 없으면 가짜로 대신한다. Lead: 병합 뒤에는 아래 glob을 정적 import로 바꿔도 된다.
 *   import { createOnlineClient } from '../../net/client';
 */
const realModule = import.meta.glob<{ createOnlineClient?: () => OnlineClient }>('../../net/client.ts', { eager: true });

let client: OnlineClient | null = null;

export function isFakeOnline(): boolean {
  return new URLSearchParams(location.search).has('fakeonline');
}

export function getOnlineClient(): OnlineClient {
  if (client) return client;
  const create = Object.values(realModule)[0]?.createOnlineClient;
  if (create && !isFakeOnline()) {
    client = create();
  } else {
    if (!create) console.info('[online] src/net/client.ts not found: using the in-memory fake server');
    const fake = createFakeOnlineClient();
    (window as unknown as { __fgFakeOnline?: typeof fake }).__fgFakeOnline = fake;
    client = fake;
  }
  return client;
}
