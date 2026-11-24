/**
 * 계정 HTTP API(/api/*). 형식은 src/net/accountApi.ts. Network 담당.
 * CORS: 게임 페이지(https://vitamindu.github.io)와 http://localhost:*, http://127.0.0.1:* 만 허용.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GUILD_MAX_MEMBERS, type AccountApiError, type GuildResponse, type GuildRole, type PartyResponse } from '../src/net/accountApi';
import { AccountError, type AccountStore, type RateLimiter } from './accounts';
import { PartyError, type PartyStore } from './party';

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
  not_enough_gems: 409,
  max_level: 409,
  no_boxes: 409,
  already_in_guild: 409,
  not_in_guild: 409,
  invalid_guild_name: 400,
  guild_taken: 409,
  guild_full: 409,
  not_allowed: 403,
  already_requested: 409,
  rate_limited_chat: 429,
  already_claimed: 409,
  tier_locked: 409,
  premium_required: 403,
  already_premium: 409,
  not_friends: 403,
  party_full: 409,
  not_in_party: 409,
  already_in_party: 409,
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
  /** 파티(메모리) */
  parties?: PartyStore;
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
      const code: AccountApiError | null = err instanceof HttpError || err instanceof AccountError || err instanceof PartyError ? err.code : null;
      if (code) send(STATUS[code], { error: code });
      else {
        deps.log(`[api] ${req.method} ${path} failed: ${(err as Error)?.stack ?? String(err)}`);
        send(500, { error: 'server_error' });
      }
    });
  return true;
}

async function route(req: IncomingMessage, path: string, { store, limiter, log, presence, parties: partyStore }: ApiDeps): Promise<unknown> {
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
  const guildInfo = (k: string, requested?: boolean): GuildResponse => {
    const g = store.guildOf(k);
    if (!g) return { guild: null, ...(requested ? { requested } : {}) };
    const myRole = store.guildRole(k)!;
    const roleOf = (m: string): GuildRole => (m === g.leader ? 'master' : g.vices.includes(m) ? 'vice' : 'member');
    return {
      guild: {
        name: g.name,
        description: g.description,
        leader: store.nickname(g.leader) ?? '',
        maxMembers: GUILD_MAX_MEMBERS,
        joinMode: g.joinMode,
        myRole,
        members: g.members.map((m) => {
          const p = store.profile(m);
          return {
            nickname: store.nickname(m) ?? '',
            rankPoints: p?.rankPoints ?? 0,
            ...(p?.avatar ? { avatar: p.avatar } : {}),
            role: roleOf(m),
            online: false,
            inRoom: false,
            ...(presence?.(m) ?? {}),
          };
        }),
        requests:
          myRole === 'member'
            ? []
            : g.requests.map((q) => {
                const p = store.profile(q.key);
                return { nickname: store.nickname(q.key) ?? '', rankPoints: p?.rankPoints ?? 0, ...(p?.avatar ? { avatar: p.avatar } : {}), at: q.at };
              }),
      },
    };
  };
  const chatSince = (k: string, after: number) => {
    const g = store.guildOf(k);
    if (!g) throw new HttpError('not_in_guild');
    return { messages: g.chat.filter((c) => c.id > after).map((c) => ({ id: c.id, from: c.from ? (store.nickname(c.from) ?? '') : null, text: c.text, at: c.at })) };
  };
  const query = () => new URL(req.url ?? '/', 'http://x').searchParams;
  if (path === '/api/guild' && (method === 'GET' || method === 'POST')) {
    if (!key) throw new HttpError('unauthorized');
    if (method === 'POST') {
      const b = await readJson(req);
      store.createGuild(key, typeof b.name === 'string' ? b.name.trim() : b.name, b.description);
      log(`[api] guild created ${String(b.name)}`);
    }
    return guildInfo(key);
  }
  if (method === 'POST' && path === '/api/guild/join') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    const r = store.joinGuild(key, b.name);
    return guildInfo(key, r === 'requested');
  }
  if (method === 'POST' && path === '/api/guild/leave') {
    if (!key) throw new HttpError('unauthorized');
    store.leaveGuild(key);
    return guildInfo(key);
  }
  if (method === 'POST' && path === '/api/guild/answer') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.answerRequest(key, b.nickname, b.accept === true);
    return guildInfo(key);
  }
  if (method === 'POST' && path === '/api/guild/kick') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.kickMember(key, b.nickname);
    return guildInfo(key);
  }
  if (method === 'POST' && path === '/api/guild/vice') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.setVice(key, b.nickname, b.on === true);
    return guildInfo(key);
  }
  if (method === 'PUT' && path === '/api/guild/settings') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.guildSettings(key, { joinMode: b.joinMode, description: b.description });
    return guildInfo(key);
  }
  if (path === '/api/guild/chat' && (method === 'GET' || method === 'POST')) {
    if (!key) throw new HttpError('unauthorized');
    if (method === 'POST') {
      const b = await readJson(req);
      store.guildChat(key, b.text);
    }
    return chatSince(key, Number(query().get('after')) || 0);
  }
  if (method === 'GET' && path === '/api/guilds') {
    if (!key) throw new HttpError('unauthorized');
    const mine = new Set(store.requestedGuilds(key));
    return { guilds: store.searchGuilds(query().get('q') ?? '').map((g) => (mine.has(g.name) ? { ...g, requested: true } : g)) };
  }
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
  if (method === 'POST' && path === '/api/boxes/open') {
    if (!key) throw new HttpError('unauthorized');
    const r = store.openBox(key);
    return { ...me(key), items: r.items };
  }
  if (path === '/api/party' || path.startsWith('/api/party/')) {
    if (!key) throw new HttpError('unauthorized');
    const parties = partyStore;
    if (!parties) throw new HttpError('bad_request');
    const byNick = (n: unknown) => {
      const k = store.findByNickname(n);
      if (!k) throw new HttpError('not_found');
      return k;
    };
    if (method === 'POST' && path === '/api/party/invite') {
      const b = await readJson(req);
      const to = byNick(b.nickname);
      parties.invite(key, to, store.friends(key).includes(to));
    } else if (method === 'POST' && path === '/api/party/accept') {
      const b = await readJson(req);
      parties.accept(key, byNick(b.from));
    } else if (method === 'POST' && path === '/api/party/decline') {
      const b = await readJson(req);
      parties.decline(key, byNick(b.from));
    } else if (method === 'POST' && path === '/api/party/leave') {
      parties.leave(key);
    } else if (method === 'POST' && path === '/api/party/kick') {
      const b = await readJson(req);
      parties.kick(key, byNick(b.nickname));
    } else if (!(method === 'GET' && path === '/api/party')) {
      throw new HttpError('bad_request');
    }
    const p = parties.get(key);
    const member = (k: string) => {
      const pr = store.profile(k);
      return { nickname: store.nickname(k) ?? '', ...(pr?.avatar ? { avatar: pr.avatar } : {}), fighterId: pr?.selected ?? 'rivet', rankPoints: pr?.rankPoints ?? 0, leader: p?.leader === k };
    };
    return {
      party: p ? { members: p.members.map(member), leader: store.nickname(p.leader) ?? '', roomCode: p.roomCode } : null,
      invites: parties.invitesFor(key).map((i) => {
        const pr = store.profile(i.from);
        return { from: store.nickname(i.from) ?? '', ...(pr?.avatar ? { avatar: pr.avatar } : {}), at: i.at };
      }),
    } satisfies PartyResponse;
  }
  if (method === 'POST' && path === '/api/admin/grant') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    return store.adminGrant(key, typeof b.target === 'string' ? b.target.trim() : b.target, b.coins, b.gems);
  }
  if (method === 'GET' && path === '/api/ranking') {
    if (!key) throw new HttpError('unauthorized');
    return store.ranking(key);
  }
  if (method === 'GET' && path === '/api/history') {
    if (!key) throw new HttpError('unauthorized');
    return store.history(key);
  }
  if (method === 'POST' && path === '/api/pass/claim') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    const r = store.claimPass(key, b.tier, b.track);
    return { ...me(key), got: r.got };
  }
  if (method === 'POST' && path === '/api/pass/premium') {
    if (!key) throw new HttpError('unauthorized');
    store.buyPremiumPass(key);
    return me(key);
  }
  if (method === 'POST' && path === '/api/shop/buy') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    const r = store.buyShopItem(key, b.itemId);
    return { ...me(key), got: r.got };
  }
  if (method === 'POST' && path === '/api/upgrade') {
    if (!key) throw new HttpError('unauthorized');
    const b = await readJson(req);
    store.upgradeFighter(key, b.fighterId);
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
