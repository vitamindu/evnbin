import { describe, expect, it } from 'vitest';
import { INVITE_TTL_MS, PARTY_MAX, PartyStore } from '../../../server/party';
import { Room } from '../../../server/rooms';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'ok';
};

describe('party', () => {
  it('invite friends only; accept joins; leader is the inviter', () => {
    const p = new PartyStore();
    expect(code(() => p.invite('a', 'b', false))).toBe('not_friends');
    expect(code(() => p.invite('a', 'a', true))).toBe('self');
    p.invite('a', 'b', true);
    expect(p.get('a')!.members).toEqual(['a']);
    expect(p.invitesFor('b').map((i) => i.from)).toEqual(['a']);
    p.accept('b', 'a');
    expect(p.get('b')!.leader).toBe('a');
    expect(p.get('a')!.members).toEqual(['a', 'b']);
    expect(p.invitesFor('b')).toEqual([]);
    expect(code(() => p.invite('a', 'b', true))).toBe('already_in_party');
    expect(p.mates('b')).toEqual(['a']);
  });

  it(`at most ${PARTY_MAX}; decline; invites expire`, () => {
    let now = 0;
    const p = new PartyStore(() => now);
    p.invite('a', 'b', true);
    p.invite('a', 'c', true);
    p.invite('a', 'd', true);
    p.accept('b', 'a');
    p.accept('c', 'a');
    expect(code(() => p.accept('d', 'a'))).toBe('party_full');
    expect(code(() => p.invite('a', 'e', true))).toBe('party_full');
    p.invite('x', 'y', true);
    p.decline('y', 'x');
    expect(p.invitesFor('y')).toEqual([]);
    p.invite('x', 'z', true);
    now += INVITE_TTL_MS + 1;
    expect(p.invitesFor('z')).toEqual([]);
    expect(code(() => p.accept('z', 'x'))).toBe('not_found');
  });

  it('leader leaves → next member leads; one left → party gone; kick is leader-only', () => {
    const p = new PartyStore();
    p.invite('a', 'b', true);
    p.invite('a', 'c', true);
    p.accept('b', 'a');
    p.accept('c', 'a');
    expect(code(() => p.kick('b', 'c'))).toBe('not_allowed');
    p.leave('a');
    expect(p.get('b')!.leader).toBe('b');
    p.kick('b', 'c');
    expect(p.get('c')).toBeNull();
    expect(p.get('b')).toBeNull(); // 혼자 남으면 없어진다
    expect(code(() => p.leave('b'))).toBe('not_in_party');
  });

  it('accepting another party leaves the old one', () => {
    const p = new PartyStore();
    p.invite('a', 'b', true);
    p.accept('b', 'a');
    p.invite('c', 'b', true);
    p.accept('b', 'c');
    expect(p.get('b')!.leader).toBe('c');
    expect(p.get('a')).toBeNull();
  });

  it('room code: only the leader sets it', () => {
    const p = new PartyStore();
    p.invite('a', 'b', true);
    p.accept('b', 'a');
    expect(code(() => p.setRoom('b', 'ABCD'))).toBe('not_allowed');
    p.setRoom('a', 'ABCD');
    expect(p.get('b')!.roomCode).toBe('ABCD');
  });
});

describe('room team preference (party mates)', () => {
  it('joins the mate’s team while it has room', () => {
    const r = new Room('ABCD');
    r.add('p1', 'A', 'rivet', 0, 'a');
    r.add('p2', 'X', 'rivet', 0, 'x'); // 자동이면 팀1
    const m = r.add('p3', 'B', 'rivet', 0, 'b', ['a']);
    expect(typeof m === 'object' && m.team).toBe(r.get('p1')!.team);
    const m2 = r.add('p4', 'C', 'rivet', 0, 'c', ['a', 'b']);
    expect(typeof m2 === 'object' && m2.team).toBe(r.get('p1')!.team);
    // 팀이 꽉 차면 다른 팀
    const m3 = r.add('p5', 'D', 'rivet', 0, 'd', ['a']);
    expect(typeof m3 === 'object' && m3.team).not.toBe(r.get('p1')!.team);
  });
});
