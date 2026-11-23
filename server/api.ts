/**
 * 계정 HTTP API(/api/*). 형식은 src/net/accountApi.ts. Network 담당.
 * CORS: 게임 페이지(https://vitamindu.github.io)와 http://localhost:*, http://127.0.0.1:* 만 허용.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountApiError } from '../src/net/accountApi';
import { AccountError, type AccountStore, type RateLimiter } from './accounts';

export const DEFAULT_API_ORIGINS = ['https://vitamindu.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const MAX_BODY = 4096;
/** 프로필 사진(data URL) 최대 길이 */
export const AVATAR_MAX_BYTES = 60_000;

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  return allowed.includes(origin) || LOCAL_ORIGIN.test(origin);
}

/** 요청한 쪽 IP. Fly 프록시 뒤에서는 Fly-Client-IP 헤더 */
export function clientIp(req: IncomingMessage): string {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly) return fly;
  return req.socket.remoteAddress ?? 'unknown';
}

export function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1]! : null;
}

const STATUS: Record<AccountApiError, number> = {
  bad_credentials: 401,
  unauthorized: 401,
  username_taken: 409,
  invalid_username: 400,
  weak_password: 400,
  bad_request: 400,
  rate_limited: 429,
  nickname_taken: 409,
  invalid_nickname: 400,
  not_found: 404,
  already_friends: 409,
  not_owned: 403,
  already_owned: 409,
  shop_closed: 403,
  not_enough_coins: 409,
  self: 400,
};

class HttpError extends Error {
  constructor(readonly code: AccountApiError) {
    super(code);
  }
}

function readJson(req: IncomingMessage, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBody) {
        reject(new HttpError('bad_request'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new HttpError('bad_request'));
      }
    });
    req.on('error', () => reject(new HttpError('bad_request')));
  });
}

export interface ApiDeps {
  store: AccountStore;
  limiter: RateLimiter;
  allowedOrigins: readonly string[];
  log: (m: string) => void;
  /** 그 계정이 지금 웹소켓으로 연결돼 있는가, 방에 있는가(친구 목록용) */
  presence?: (account: string) => { online: boolean; inRoom: boolean };
}

/** /api/*이면 처리하고 true. 아니면 false(다른 경로는 app.ts가 처리) */
export function handleApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): boolean {
  const path = (req.url ?? '/').split('?')[0]!;
  if (!path.startsWith('/api/')) return false;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  if (originAllowed(origin, deps.allowedOrigins)) {
    headers['access-control-allow-origin'] = origin!;
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = 'Content-Type, Authorization';
    headers['access-control-max-age'] = '600';
  }
  const send = (status: number, body: unknown) => {
    if (res.headersSent) return;
    res.writeHead(status, headers);
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return true;
  }
  void route(req, path, deps)
    .then((r) => send(200, r))
    .catch((err: unknown) => {
      const code: AccountApiError | null = err instanceof HttpError || err instanceof AccountError ? err.code : null;
      if (code) send(STATUS[code], { error: code });
      else {
        deps.log(`[api] ${req.method} ${path} failed: ${(err as Error)?.stack ?? String(err)}`);
        send(500, { error: 'server_error' });
      }
    });
  return true;
}

async function route(req: IncomingMessage, path: string, { store, limiter, log, presence }: ApiDeps): Promise<unknown> {
  const ip = clientIp(req);
  const method = req.method ?? 'GET';
  if (method === 'POST' && path === '/api/signup') {
    if (limiter.signupBlocked(ip)) throw new HttpError('rate_limited');
    const b = await readJson(req);
    const r = await store.signup(b.username, b.password, b.nickname);
    limiter.signedUp(ip);
    log(`[api] signup ${r.username} (${r.profile.name})`);
    return r;
  }
  if (method === 'POST' && path === '/api/login') {
    if (limiter.loginBlocked(ip)) throw new HttpError('rate_limited');
    const b = await readJson(req);
    try {
      const r = await store.login(b.username, b.password);
      limiter.loginOk(ip);
      return r;
    } catch (err) {
      if (err instanceof AccountError && err.code === 'bad_credentials') limiter.loginFailed(ip);
      throw err;
    }
  }
  const key = store.verify(bearer(req));
  const me = (k: string) => ({ profile: store.profile(k), username: store.username(k) });
  const friendList = (k: string) => ({
    friends: store
      .friends(k)
      .map((f) => ({
        nickname: store.nickname(f) ?? '',
        online: false,
        inRoom: false,
        ...(presence?.(f) ?? {}),
        rankPoints: store.profile(f)?.rankPoints ?? 0,
        ...(store.profile(f)?.avatar ? { avatar: store.profile(f)!.avatar } : {}),
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname)),
  });
  if (method === 'GET' && path === '/api/me') {
    if (!key) throw new HttpError('unauthorized');
    return me(key);
  }
  if (method === 'PUT' && path === '/api/nickname') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    const before = store.nickname(key);
    store.changeNickname(key, typeof b.nickname === 'string' ? b.nickname.trim() : b.nickname);
    log(`[api] nickname ${before} -> ${store.nickname(key)}`);
    return me(key);
  }
  if (path === '/api/friends' && (method === 'GET' || method === 'POST')) {
    if (!key) throw new HttpError('unauthorized');
    if (method === 'POST') {
      const b = await readJson(req);
      store.addFriend(key, b.nickname);
    }
    return friendList(key);
  }
  if (method === 'DELETE' && path.startsWith('/api/friends/')) {
    if (!key) throw new HttpError('unauthorized');
    let nickname: string;
    try {
      nickname = decodeURIComponent(path.slice('/api/friends/'.length));
    } catch {
      throw new HttpError('bad_request');
    }
    store.removeFriend(key, nickname);
    return friendList(key);
  }
  if (method === 'PUT' && path === '/api/profile') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    // 바꿀 수 있는 것은 selected뿐. 다른 필드(트로피·코인 등)는 무시하지 않고 거절한다
    const extra = Object.keys(b).filter((k) => k !== 'selected');
    if (extra.length || b.selected === undefined) throw new HttpError('bad_request');
    const profile = store.updateSelected(key, b.selected);
    if (!profile) throw new HttpError('bad_request');
    return me(key);
  }
  if (method === 'PUT' && path === '/api/avatar') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req, AVATAR_MAX_BYTES + 512);
    store.setAvatar(key, b.avatar ?? null);
    return me(key);
  }
  if (method === 'PUT' && path === '/api/skin') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.equipSkin(key, b.fighterId, b.skinId ?? null);
    return me(key);
  }
  if (method === 'POST' && path === '/api/skins/buy') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.buySkin(key, b.skinId);
    log(`[api] skin bought ${store.username(key)} ${String(b.skinId)}`);
    return me(key);
  }
  if (method === 'POST' && path === '/api/logout') {
    const token = bearer(req);
    if (!key || !token) throw new HttpError('unauthorized');
    store.logout(token);
    return { ok: true };
  }
  throw new HttpError('bad_request');
}
