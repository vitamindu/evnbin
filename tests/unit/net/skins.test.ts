import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { SKINS, SKIN_SHOP_OPEN } from '../../../src/data/skins';

const dirs: string[] = [];
const store = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-skin-'));
  dirs.push(d);
  return new AccountStore(d, Date.now, () => {});
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'ok';
};

describe('skins and admin', () => {
  it('mineack991 is admin (any case) and owns every skin', async () => {
    const s = store();
    const r = await s.signup('MineAck991', 'secret1', '관리자');
    expect(r.profile.admin).toBe(true);
    expect(r.profile.skins).toEqual(SKINS.map((k) => k.id));
    const key = 'mineack991';
    const p = s.equipSkin(key, 'hinako', 'hinako_sakura');
    expect(p.skinSel?.hinako).toBe('hinako_sakura');
    expect(s.skinFor(key, 'hinako')).toBe('hinako_sakura');
    expect(s.equipSkin(key, 'hinako', null).skinSel?.hinako).toBeUndefined();
  });

  it('normal accounts cannot wear or (while the shop is closed) buy skins', async () => {
    const s = store();
    const r = await s.signup('normal1', 'secret1', '보통');
    expect(r.profile.admin).toBeUndefined();
    expect(code(() => s.equipSkin('normal1', 'hinako', 'hinako_sakura'))).toBe('not_owned');
    expect(code(() => s.buySkin('normal1', 'hinako_sakura'))).toBe(SKIN_SHOP_OPEN ? 'not_enough_coins' : 'shop_closed');
    expect(s.skinFor('normal1', 'hinako')).toBeUndefined();
  });

  it('rejects a skin on the wrong fighter or an unknown skin', async () => {
    const s = store();
    await s.signup('mineack991', 'secret1', '관리자');
    expect(code(() => s.equipSkin('mineack991', 'rivet', 'hinako_sakura'))).toBe('bad_request');
    expect(code(() => s.equipSkin('mineack991', 'hinako', 'nope'))).toBe('bad_request');
  });
});
