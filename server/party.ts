/**
 * 파티(로비에서 친구와 함께 대전에 들어가기). 메모리에만 둔다(서버가 다시 켜지면 사라져도 된다).
 * - 초대: 친구에게만. 받은 사람이 수락하면 같은 파티. 초대는 2분 뒤 사라진다.
 * - 최대 3명(한 팀). 파티장이 나가면 다음 사람이 파티장, 혼자 남으면 파티가 없어진다.
 * - 파티장이 온라인 방을 만들면 방 코드를 남기고, 파티원 화면이 그 방으로 따라 들어간다.
 * - 방에서 파티원은 같은 팀으로 들어간다(server/rooms.ts add의 preferTeamOf).
 */
export const PARTY_MAX = 3;
export const INVITE_TTL_MS = 120_000;

export type PartyErrorCode = 'not_found' | 'not_friends' | 'party_full' | 'self' | 'not_allowed' | 'not_in_party' | 'already_in_party';

export class PartyError extends Error {
  constructor(readonly code: PartyErrorCode) {
    super(code);
  }
}

interface Party {
  id: number;
  leader: string;
  members: string[];
  roomCode: string | null;
}

interface Invite {
  from: string;
  partyId: number;
  at: number;
}

export class PartyStore {
  private nextId = 1;
  private readonly parties = new Map<number, Party>();
  private readonly partyOf = new Map<string, number>();
  private readonly invites = new Map<string, Invite[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 내 파티(사본). 없으면 null */
  get(key: string): Party | null {
    const id = this.partyOf.get(key);
    const p = id === undefined ? undefined : this.parties.get(id);
    return p ? { ...p, members: [...p.members] } : null;
  }

  /** 받은 초대(오래된 것은 지운다) */
  invitesFor(key: string): Invite[] {
    const t = this.now();
    const live = (this.invites.get(key) ?? []).filter((i) => t - i.at < INVITE_TTL_MS && this.parties.has(i.partyId));
    if (live.length) this.invites.set(key, live);
    else this.invites.delete(key);
    return live.map((i) => ({ ...i }));
  }

  /** 초대 보내기. 파티가 없으면 내가 파티장인 파티를 만든다. areFriends: 계정 둘이 친구인가 */
  invite(from: string, to: string, areFriends: boolean): void {
    if (from === to) throw new PartyError('self');
    if (!areFriends) throw new PartyError('not_friends');
    let p = this.raw(from);
    if (!p) {
      p = { id: this.nextId++, leader: from, members: [from], roomCode: null };
      this.parties.set(p.id, p);
      this.partyOf.set(from, p.id);
    }
    if (p.members.includes(to)) throw new PartyError('already_in_party');
    if (p.members.length >= PARTY_MAX) throw new PartyError('party_full');
    const list = this.invitesFor(to).filter((i) => i.from !== from);
    list.push({ from, partyId: p.id, at: this.now() });
    this.invites.set(to, list);
  }

  /** 초대 수락: 지금 파티가 있으면 나오고 그 파티로 */
  accept(key: string, from: string): void {
    const inv = this.invitesFor(key).find((i) => i.from === from);
    if (!inv) throw new PartyError('not_found');
    const p = this.parties.get(inv.partyId);
    if (!p) throw new PartyError('not_found');
    if (p.members.length >= PARTY_MAX) throw new PartyError('party_full');
    if (this.partyOf.get(key) !== p.id) {
      this.leave(key, true);
      p.members.push(key);
      this.partyOf.set(key, p.id);
    }
    this.invites.set(key, (this.invites.get(key) ?? []).filter((i) => i.from !== from));
  }

  decline(key: string, from: string): void {
    this.invites.set(key, (this.invites.get(key) ?? []).filter((i) => i.from !== from));
  }

  /** 나가기. 파티장이 나가면 다음 사람이 파티장, 1명만 남으면 파티가 없어진다 */
  leave(key: string, quiet = false): void {
    const p = this.raw(key);
    if (!p) {
      if (quiet) return;
      throw new PartyError('not_in_party');
    }
    p.members = p.members.filter((m) => m !== key);
    this.partyOf.delete(key);
    if (p.leader === key && p.members.length) p.leader = p.members[0]!;
    if (p.members.length <= 1) this.dissolve(p);
  }

  /** 파티장이 파티원 내보내기 */
  kick(leader: string, target: string): void {
    const p = this.raw(leader);
    if (!p) throw new PartyError('not_in_party');
    if (p.leader !== leader) throw new PartyError('not_allowed');
    if (!p.members.includes(target) || target === leader) throw new PartyError('not_found');
    this.leave(target);
  }

  /** 파티장이 만든(또는 나온) 온라인 방 코드 */
  setRoom(leader: string, code: string | null): void {
    const p = this.raw(leader);
    if (!p) throw new PartyError('not_in_party');
    if (p.leader !== leader) throw new PartyError('not_allowed');
    p.roomCode = code;
  }

  /** 같은 파티 사람들(나 빼고) */
  mates(key: string): string[] {
    const p = this.raw(key);
    return p ? p.members.filter((m) => m !== key) : [];
  }

  private raw(key: string): Party | undefined {
    const id = this.partyOf.get(key);
    return id === undefined ? undefined : this.parties.get(id);
  }

  private dissolve(p: Party) {
    for (const m of p.members) this.partyOf.delete(m);
    this.parties.delete(p.id);
  }
}
