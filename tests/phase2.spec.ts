import { getFighter } from '../src/data/fighters';
import type { Page } from '@playwright/test';
import {
  ATTACK_STICK,
  FIGHTER_IDS,
  Fingers,
  MAX_HP,
  NAMES,
  DUMMIES,
  SPAWN,
  circleFree,
  clearPath,
  idleDummyWithSpot,
  nearestBreakableWall,
  turretSpot,
  SUPER_BTN,
  aimState,
  angleClose,
  drawCallsWithin,
  eventMark,
  events,
  expectNoEvent,
  openBattle,
  player,
  selectFighterViaUi,
  setSuperCharge,
  teleport,
  toDesign,
  trace,
  translateOf,
  waitBattleReady,
  waitCameraSettled,
  waitForEvent,
  waitFullAmmo,
  waitTicks,
  type QaWindow,
} from './battle-helpers';
import { expect, shot, tapToLobby, test } from './fixtures';

/**
 * Phase 2: offline battle (TRAINING YARD). IDs from docs/06-test-cases.md (T-20 …).
 * Every test opens `/?qa` so the running BattleSession is readable as `window.__fgBattle`.
 * The fixture fails a test on any console.error / page error.
 *
 * Map positions (spawn, dummies, walls, stand spots) are derived from TRAINING_YARD at runtime
 * (tests/battle-helpers.ts), never hardcoded, and aim directions are computed from them.
 */

// swiftshader is slow and the sim only advances ~10-17 ticks per real second here.
test.describe.configure({ timeout: 120_000 });

/** Team-0 default facing (straight up on the vertical maps), read from a fresh fighter. */
const facingAtSpawn = async (page: Page) => (await player(page)).facing;
const dirTo = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

/** Id of the unit standing at a map position (dummies don't move except patrol). */
async function unitIdAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(
    (pt) => (window as QaWindow).__fgBattle!.sim.units.find((u) => Math.hypot(u.pos.x - pt.x, u.pos.y - pt.y) < 0.01)!.id,
    p,
  );
}

const fullAmmoSegs = (page: Page) => page.locator('.ub.is-me .ub-ammo b.is-full').count();

// ───────────────────────────── load ─────────────────────────────

for (const id of FIGHTER_IDS) {
  test(`T-20 battle loads with ${NAMES[id]} (selected in the UI): HUD, sticks, sim running, no console errors`, async ({ page }, testInfo) => {
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await page.goto('/?qa');
    await tapToLobby(page);
    if (id !== 'rivet') await selectFighterViaUi(page, id);
    await page.locator('.btn-play').tap();
    await waitBattleReady(page, id);

    await expect(page.locator('.battle-label')).toHaveText('TRAINING YARD');
    await expect(page.locator('.btn-battle-exit')).toBeVisible();
    await expect(page.locator('.battle')).toHaveClass(/has-touch/);
    await expect(page.locator('.stick-attack')).toBeVisible();
    await expect(page.locator('.stick-super')).toBeVisible();
    await expect(page.locator('.stick-move')).not.toHaveClass(/is-active/);

    const p = await player(page);
    expect(p.fighterId).toBe(id);
    expect(p.pos).toEqual(SPAWN);
    expect(p.hp).toBe(MAX_HP[id]);
    expect(p.ammo).toBe(3);
    expect(p.superCharge).toBe(0);
    const units = await page.evaluate(() =>
      (window as QaWindow).__fgBattle!.sim.units.map((u) => (u.type === 'dummy' ? u.behavior : u.type)),
    );
    expect(units).toEqual(['fighter', ...DUMMIES.map((d) => d.behavior)]);

    // The loop keeps ticking and the own bar shows full HP + 3 full ammo cells.
    await waitTicks(page, 15);
    const me = page.locator('.ub.is-me');
    await expect(me.locator('.ub-num')).toHaveText(String(MAX_HP[id]));
    await expect(me.locator('.ub-ammo > i')).toHaveCount(3);
    await expect.poll(() => fullAmmoSegs(page)).toBe(3);
    // one bar per unit (dummies off-screen at spawn are created but hidden)
    await expect(page.locator('.ub')).toHaveCount(6);
    expect(await drawCallsWithin(page, 10_000, 50), 'battle scene is being drawn').toBeGreaterThanOrEqual(50);
    await shot(page, testInfo, `20-battle-${id}`);
    expect(warnings.filter((w) => /model load failed/i.test(w))).toEqual([]);
  });
}

// ───────────────────────────── movement ─────────────────────────────

test('T-21 keyboard WASD / arrows move the player; releasing stops it', async ({ page }) => {
  await openBattle(page);
  const start = await player(page);

  await page.keyboard.down('KeyD');
  await page.waitForFunction((x) => (window as QaWindow).__fgBattle!.player.pos.x > x + 1, start.pos.x);
  expect((await player(page)).move).toEqual({ x: 1, y: 0 });
  await page.keyboard.up('KeyD');
  let p = await player(page);
  expect(p.move).toEqual({ x: 0, y: 0 });
  expect(p.pos.y, 'moving right keeps y').toBeCloseTo(start.pos.y, 6);
  expect(p.facing).toBeCloseTo(0, 6);
  // stopped: no drift over the next ticks (no acceleration/inertia, docs/03)
  await waitTicks(page, 2);
  const stopped = (await player(page)).pos;
  await waitTicks(page, 6);
  expect((await player(page)).pos).toEqual(stopped);

  await page.keyboard.down('KeyS');
  await page.waitForFunction((y) => (window as QaWindow).__fgBattle!.player.pos.y > y + 0.8, stopped.y);
  await page.keyboard.up('KeyS');
  p = await player(page);
  expect(p.facing).toBeCloseTo(Math.PI / 2, 6);

  await page.keyboard.down('ArrowUp');
  await page.waitForFunction((y) => (window as QaWindow).__fgBattle!.player.pos.y < y - 0.5, p.pos.y);
  await page.keyboard.up('ArrowUp');

  // diagonal: same speed as straight, direction (1, -1)/√2
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  const diag = await player(page);
  expect(diag.move.x).toBeCloseTo(Math.SQRT1_2, 6);
  expect(diag.move.y).toBeCloseTo(-Math.SQRT1_2, 6);
  await page.waitForFunction((x) => (window as QaWindow).__fgBattle!.player.pos.x > x + 0.5, diag.pos.x);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  expect((await player(page)).move).toEqual({ x: 0, y: 0 });
});

test('T-22 touch: floating move stick appears under the finger, dead zone, follows past the rim, moves the player', async ({ page }, testInfo) => {
  await openBattle(page);
  const fingers = await Fingers.create(page);
  const start = await player(page);
  const stick = page.locator('.stick-move');

  await fingers.down(1, 300, 500);
  await expect(stick).toHaveClass(/is-active/);
  expect(await translateOf(page, '.stick-move')).toEqual([300, 500]);

  // inside the 12% dead zone (5px of 80px): knob moves, player does not
  await fingers.move(1, 305, 500, 1);
  await expect.poll(() => translateOf(page, '.stick-move .stick-knob')).toEqual([5, 0]);
  expect((await player(page)).move).toEqual({ x: 0, y: 0 });

  // past the dead zone: full speed to the right (no analog speed, docs/03)
  await fingers.move(1, 340, 500, 2);
  await expect.poll(async () => (await player(page)).move).toEqual({ x: 1, y: 0 });
  await page.waitForFunction((x) => (window as QaWindow).__fgBattle!.player.pos.x > x + 1, start.pos.x);
  await shot(page, testInfo, '22-move-stick');

  // dragging 200px out: the base follows so the knob stays on the rim (80px)
  await fingers.move(1, 500, 500, 4);
  await expect.poll(() => translateOf(page, '.stick-move')).toEqual([420, 500]);
  expect(await translateOf(page, '.stick-move .stick-knob')).toEqual([80, 0]);

  // turn downwards
  await fingers.move(1, 420, 600, 3);
  await expect.poll(async () => (await player(page)).move).toEqual({ x: 0, y: 1 });

  await fingers.up(1);
  await expect(stick).not.toHaveClass(/is-active/);
  expect((await player(page)).move).toEqual({ x: 0, y: 0 });
  // resting place: (190, 800 - 170)
  expect(await translateOf(page, '.stick-move')).toEqual([190, 630]);
  await waitTicks(page, 2);
  const stopped = (await player(page)).pos;
  await waitTicks(page, 5);
  expect((await player(page)).pos).toEqual(stopped);

  // right half, away from the buttons: no move stick
  await fingers.down(2, 900, 300);
  await fingers.move(2, 960, 300, 2);
  await waitTicks(page, 2);
  await expect(stick).not.toHaveClass(/is-active/);
  expect((await player(page)).move).toEqual({ x: 0, y: 0 });
  await fingers.dispose();
});

// ───────────────────────────── attack ─────────────────────────────

test('T-23 tap the attack stick: auto-aim shot, ammo cell used; with no ammo → noAmmo + ammo bar shakes', async ({ page }) => {
  await openBattle(page);
  await waitFullAmmo(page);
  const facing = await facingAtSpawn(page);
  const since = await eventMark(page);

  await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);
  const atk = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: false }, since);
  // no enemy in range of the spawn → fires the way the fighter faces
  expect(angleClose(atk.dir, facing)).toBe(true);
  const row = (await trace(page)).find((r) => r.tick === atk.tick)!;
  expect(row.ammo).toBeGreaterThanOrEqual(2);
  expect(row.ammo).toBeLessThan(2.1);
  expect(row.shots, 'RIVET fires 5 rivets').toBe(5);
  await expect.poll(() => fullAmmoSegs(page), { intervals: [50] }).toBe(2);
  // the attack stick never stayed in an aiming state (tap < 20px)
  await expect(page.locator('.stick-attack')).not.toHaveClass(/is-(held|aiming|cancel)/);

  // two more taps → two more shots (each tap must land on its own tick, so wait for every attack)
  for (let i = 0; i < 2; i++) {
    const m = await eventMark(page);
    await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);
    await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: false }, m);
  }
  // Reload (1.5 s/cell) keeps running while this slow browser round-trips, so empty the magazine
  // with the test lever instead of racing it; the HUD must then show no full cell.
  await page.evaluate(() => {
    (window as QaWindow).__fgBattle!.player.ammo = 0;
  });
  await expect.poll(() => fullAmmoSegs(page)).toBe(0);
  const m = await eventMark(page);
  await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);
  await waitForEvent(page, { type: 'noAmmo', unitId: '$player' }, m);
  await expect(page.locator('.ub.is-me .ub-ammo')).toHaveClass(/shake-[ab]/);
  expect((await events(page, m, 'attack')).filter((e) => e.unitId === atk.unitId)).toEqual([]);
});

test('T-24 drag the attack stick: aim indicator follows, release fires that way; dragging back to the centre cancels', async ({ page }, testInfo) => {
  await openBattle(page);
  const fingers = await Fingers.create(page);
  await waitFullAmmo(page);

  // drag up-right by (60, -60) → |d| > 80 → aim (√½, −√½)
  await fingers.down(1, ATTACK_STICK.x, ATTACK_STICK.y);
  await expect(page.locator('.stick-attack')).toHaveClass(/is-held/);
  await fingers.move(1, ATTACK_STICK.x + 60, ATTACK_STICK.y - 60, 4);
  await expect(page.locator('.stick-attack')).toHaveClass(/is-aiming/);
  await expect.poll(async () => (await aimState(page)).shapes).toEqual(['rivet|attack']);
  await expect
    .poll(async () => {
      const a = (await aimState(page)).aim;
      return a && { which: a.which, x: +a.aim.x.toFixed(3), y: +a.aim.y.toFixed(3) };
    })
    .toEqual({ which: 'attack', x: 0.707, y: -0.707 });
  // knob clamped to the 80px rim along the drag direction
  expect(await translateOf(page, '.stick-attack .stick-knob')).toEqual([56.6, -56.6]);
  await shot(page, testInfo, '24-attack-aim');

  const since = await eventMark(page);
  await fingers.up(1);
  const atk = await waitForEvent(page, { type: 'attack', unitId: '$player' }, since);
  expect(atk.isSuper).toBe(false);
  expect(angleClose(atk.dir, -Math.PI / 4), `dir ${atk.dir}`).toBe(true);
  await expect.poll(async () => (await aimState(page)).aim).toBeNull();
  await expect.poll(async () => (await aimState(page)).shapes).toEqual([]);
  await expect(page.locator('.stick-attack')).not.toHaveClass(/is-(held|aiming|cancel)/);

  // cancel: drag out (aimed), come back within 20px of the start, release → nothing fires
  await fingers.down(2, ATTACK_STICK.x, ATTACK_STICK.y);
  await fingers.move(2, ATTACK_STICK.x - 70, ATTACK_STICK.y, 3);
  await expect(page.locator('.stick-attack')).toHaveClass(/is-aiming/);
  await fingers.move(2, ATTACK_STICK.x - 6, ATTACK_STICK.y + 4, 3);
  await expect(page.locator('.stick-attack')).toHaveClass(/is-cancel/);
  await expect.poll(async () => (await aimState(page)).aim).toBeNull();
  const m = await eventMark(page);
  await fingers.up(2);
  await expect(page.locator('.stick-attack')).not.toHaveClass(/is-(held|aiming|cancel)/);
  await expectNoEvent(page, { type: 'attack', unitId: '$player' }, m);
  await fingers.dispose();
});

// ───────────────────────────── super ─────────────────────────────

test('T-25 super button: grey + denied while charge < 1, ring shows charge, glows and fires when charged', async ({ page }, testInfo) => {
  await openBattle(page);
  const btn = page.locator('.stick-super');
  const ico = btn.locator('.knob-ico');
  const ring = btn.locator('.ring-fill');
  const ringC = 2 * Math.PI * 54;

  await expect(btn).toHaveClass(/is-charging/);
  await expect(btn).not.toHaveClass(/is-ready/);
  expect(await ico.evaluate((e) => getComputedStyle(e).filter)).toContain('grayscale(1)');
  expect(parseFloat(await ring.evaluate((e) => (e as SVGElement).style.strokeDashoffset))).toBeCloseTo(ringC, 1);

  // tapping / E while not charged: shake, no super
  let m = await eventMark(page);
  await page.touchscreen.tap(SUPER_BTN.x, SUPER_BTN.y);
  await expect(btn).toHaveClass(/shake-[ab]/);
  await page.keyboard.press('KeyE');
  await expectNoEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  expect((await aimState(page)).aim).toBeNull();

  // half charge → half ring
  await setSuperCharge(page, 0.5);
  await expect
    .poll(async () => parseFloat(await ring.evaluate((e) => (e as SVGElement).style.strokeDashoffset)))
    .toBeCloseTo(ringC / 2, 1);
  await expect(btn).toHaveClass(/is-charging/);

  // full → ready: coloured icon, glow animation
  await setSuperCharge(page, 1);
  await expect(btn).toHaveClass(/is-ready/);
  await expect(btn).not.toHaveClass(/is-charging/);
  // (the icon filter has a 0.2 s transition)
  await expect.poll(() => ico.evaluate((e) => getComputedStyle(e).filter)).toBe('none');
  expect(await btn.locator('.super-glow').evaluate((e) => getComputedStyle(e).animationName)).toBe('super-glow');
  await shot(page, testInfo, '25-super-ready');

  const facing = await facingAtSpawn(page);
  m = await eventMark(page);
  await page.touchscreen.tap(SUPER_BTN.x, SUPER_BTN.y);
  const sup = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  expect(angleClose(sup.dir, facing), 'auto-aimed super with no target goes the facing way').toBe(true);
  expect((await player(page)).superCharge).toBe(0);
  await expect(btn).toHaveClass(/is-charging/);
});

test('T-26 RIVET super (dragged at the crates) breaks walls: wallsBroken event + grid tiles become floor', async ({ page }, testInfo) => {
  await openBattle(page, 'rivet');
  const wall = nearestBreakableWall(getFighter('rivet').super.range - 0.5);
  const crates = [wall.tile];
  const tilesNow = () =>
    page.evaluate((ts) => ts.map(([x, y]) => (window as QaWindow).__fgBattle!.sim.grid.get(x!, y!) as number), crates);
  expect(await tilesNow(), 'target is a breakable wall (Tile.Wall = 1)').toEqual([1]);
  const aimDir = dirTo(SPAWN, wall.centre);
  const version0 = await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.grid.version);
  await setSuperCharge(page, 1);
  await expect(page.locator('.stick-super')).toHaveClass(/is-ready/);

  // drag the super stick from the spawn toward the nearest breakable wall (screen x/y = map x/y)
  const fingers = await Fingers.create(page);
  await fingers.down(1, SUPER_BTN.x, SUPER_BTN.y);
  await fingers.move(1, SUPER_BTN.x + Math.cos(aimDir) * 85, SUPER_BTN.y + Math.sin(aimDir) * 85, 4);
  await expect(page.locator('.stick-super')).toHaveClass(/is-aiming/);
  await expect.poll(async () => (await aimState(page)).shapes).toEqual(['rivet|super']);
  await shot(page, testInfo, '26-rivet-super-aim');
  const m = await eventMark(page);
  await fingers.up(1);

  const sup = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  expect(angleClose(sup.dir, aimDir, 0.03), `dir ${sup.dir} vs ${aimDir}`).toBe(true);
  const broken = await waitForEvent(page, { type: 'wallsBroken' }, m);
  const brokenTiles = broken.tiles.map((t) => `${t.x},${t.y}`);
  expect(brokenTiles.some((t) => crates.some(([x, y]) => t === `${x},${y}`)), `broken ${brokenTiles}`).toBe(true);
  const after = await tilesNow();
  expect(after.filter((t) => t === 0).length, `crate tiles after: ${after}`).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.grid.version)).toBeGreaterThan(version0);
  await waitTicks(page, 3);
  await shot(page, testInfo, '26-rivet-wall-broken');
  await fingers.dispose();
});

test('T-27 BOULDER super (E key, auto-aim) dashes its full super range', async ({ page }, testInfo) => {
  await openBattle(page, 'boulder');
  await setSuperCharge(page, 1);
  await expect(page.locator('.stick-super')).toHaveClass(/is-ready/);
  const facing = await facingAtSpawn(page);
  const bs = getFighter('boulder').super;
  expect(clearPath(SPAWN, facing, bs.range, 0.5), 'test premise: dash lane from the spawn is open').toBe(true);
  const m = await eventMark(page);
  await page.keyboard.press('KeyE');
  const sup = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  // nothing in range → facing
  expect(angleClose(sup.dir, facing)).toBe(true);
  await page.waitForFunction(
    (t) => {
      const w = window as QaWindow;
      const rows = w.__qa!.trace.filter((r) => r.tick >= t);
      return rows.some((r) => r.action === 'dash') && rows.at(-1)!.action === null;
    },
    sup.tick,
  );
  const rows = (await trace(page)).filter((r) => r.tick >= sup.tick);
  const dash = rows.filter((r) => r.action === 'dash');
  const end = rows.find((r) => r.tick > dash.at(-1)!.tick)!;
  const moved = Math.hypot(end.x - SPAWN.x, end.y - SPAWN.y);
  // walking would cover only a third of this in the same time
  const dashTicks = (bs.range / bs.projectileSpeed) * 30;
  expect(moved, `dash distance (${dash.length} dash ticks)`).toBeGreaterThan(bs.range - 0.5);
  expect(end.x).toBeCloseTo(SPAWN.x + Math.cos(facing) * bs.range, 1);
  expect(end.y).toBeCloseTo(SPAWN.y + Math.sin(facing) * bs.range, 1);
  expect(dash.length).toBeGreaterThanOrEqual(Math.floor(dashTicks * 0.85));
  expect(dash.length).toBeLessThanOrEqual(Math.ceil(dashTicks * 1.15));
  await shot(page, testInfo, '27-boulder-dash');
});

test('T-28 HINAKO super (dragged forward) leaps its full super range and drops 4 bombs at take-off', async ({ page }, testInfo) => {
  await openBattle(page, 'hinako');
  await setSuperCharge(page, 1);
  await expect(page.locator('.stick-super')).toHaveClass(/is-ready/);

  const hs = getFighter('hinako').super;
  // leap the way the fighter faces (toward the dummies); the landing spot must be open for an exact check
  const facing = await facingAtSpawn(page);
  const ux = Math.round(Math.cos(facing));
  const uy = Math.round(Math.sin(facing));
  const target = { x: SPAWN.x + ux * hs.range, y: SPAWN.y + uy * hs.range };
  const fingers = await Fingers.create(page);
  await fingers.down(1, SUPER_BTN.x, SUPER_BTN.y);
  await fingers.move(1, SUPER_BTN.x + ux * 100, SUPER_BTN.y + uy * 100, 4);
  await expect.poll(async () => (await aimState(page)).shapes).toEqual(['hinako|super']);
  await expect
    .poll(async () => {
      const a = (await aimState(page)).aim;
      return a && { which: a.which, x: Math.round(a.aim.x), y: Math.round(a.aim.y) };
    })
    .toEqual({ which: 'super', x: ux, y: uy });
  await shot(page, testInfo, '28-hinako-leap-aim');
  const m = await eventMark(page);
  await fingers.up(1);

  const sup = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  expect(angleClose(sup.dir, Math.atan2(uy, ux))).toBe(true);
  const startRow = (await trace(page)).find((r) => r.tick === sup.tick)!;
  expect(startRow.action).toBe('leap');
  expect(startRow.lobs, 'four bombs in the air right after take-off').toBe(4);
  await page.waitForFunction(
    (t) => (window as QaWindow).__qa!.trace.some((r) => r.tick > t && r.action === null),
    sup.tick,
  );
  await shot(page, testInfo, '28-hinako-leap-landed');
  const rows = (await trace(page)).filter((r) => r.tick >= sup.tick);
  const leapTicks = rows.filter((r) => r.action === 'leap').length;
  const land = rows.find((r) => r.action === null)!;
  const airTicks = Math.round((hs.leapTime ?? 0) * 30);
  expect(leapTicks, `${hs.leapTime} s in the air`).toBeGreaterThanOrEqual(airTicks - 2);
  expect(leapTicks).toBeLessThanOrEqual(airTicks + 2);
  if (!circleFree(target, 0.4)) throw new Error(`test premise: leap target ${JSON.stringify(target)} is blocked`);
  expect(land.x).toBeCloseTo(target.x, 1);
  expect(land.y).toBeCloseTo(target.y, 1);

  // bombs burst `fuse` seconds after take-off, on a 1-tile ring around the take-off point
  await expect.poll(async () => (await events(page, m, 'explode')).length).toBe(4);
  const ex = await events(page, m, 'explode');
  for (const e of ex) {
    expect(Math.hypot(e.pos.x - SPAWN.x, e.pos.y - SPAWN.y)).toBeCloseTo(1, 3);
    expect(e.isSuper).toBe(true);
    expect(e.tick - sup.tick).toBe(Math.round((getFighter('hinako').super.fuse ?? 0) * 30));
  }
  await fingers.dispose();
});

// ───────────────────────────── HUD ─────────────────────────────

test('T-29 hitting a dummy shows a merged damage number, lowers its bar and charges the super', async ({ page }, testInfo) => {
  await openBattle(page);
  const { dummy, spot } = idleDummyWithSpot();
  const dummyId = await unitIdAt(page, dummy);
  // spot 3–4.5 tiles from an idle dummy (nearest enemy), clear line of sight, turret out of range
  await teleport(page, spot.x, spot.y);
  await waitCameraSettled(page);
  await waitFullAmmo(page);
  const m = await eventMark(page);
  await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);

  const atk = await waitForEvent(page, { type: 'attack', unitId: '$player' }, m);
  expect(angleClose(atk.dir, dirTo(spot, dummy)), `auto-aim at the dummy, dir ${atk.dir}`).toBe(true);
  await waitForEvent(page, { type: 'hit', sourceId: '$player', targetId: dummyId }, m);
  await waitTicks(page, 4); // remaining rivets of the same volley
  const hits = (await events(page, m, 'hit')).filter((e) => e.targetId === dummyId);
  const total = hits.reduce((s, h) => s + h.damage, 0);
  expect(hits.length).toBeGreaterThan(0);

  // Hold the dummy's 2 s auto-refill while the HUD is inspected (screenshots are slow under swiftshader).
  const holdRegen = (hold: boolean) =>
    page.evaluate(
      ([id, h]) => {
        const b = (window as QaWindow).__fgBattle!;
        b.sim.getUnit(id as number)!.lastCombatTick = h ? b.sim.tick + 100_000 : b.sim.tick;
      },
      [dummyId, hold] as const,
    );
  await holdRegen(true);

  const pop = page.locator('.pop.is-dealt:not([hidden]) .pop-label');
  await expect(pop).toHaveCount(1);
  await expect(pop).toHaveText(String(total));
  const dummyBar = page.locator('.ub.is-dummy:not([hidden]) .ub-num', { hasText: String(6000 - total) });
  await expect(dummyBar).toHaveCount(1);
  expect((await player(page)).superCharge).toBeCloseTo(0.04 * hits.length, 6);
  await shot(page, testInfo, '29-damage-number');
  // numbers fade out; once combat is over the dummy refills to full after 2 s
  await expect(pop).toHaveCount(0, { timeout: 20_000 });
  await holdRegen(false);
  await page.waitForFunction((id) => (window as QaWindow).__fgBattle!.sim.getUnit(id)!.hp === 6000, dummyId, { timeout: 30_000 });
  await expect(dummyBar).toHaveCount(0);
});

test('T-30 overhead HP bars: own bar (green, ammo cells) and red dummy bars track their units on screen', async ({ page }, testInfo) => {
  await openBattle(page);
  const { spot } = idleDummyWithSpot();
  await teleport(page, spot.x, spot.y);
  await waitCameraSettled(page);
  await waitTicks(page, 2);

  const rows = await page.evaluate(() => {
    const b = (window as QaWindow).__fgBattle!;
    const bars = [...document.querySelectorAll<HTMLElement>('.hud-bars .ub')];
    return b.sim.units.map((u, i) => {
      const at = b.view.unitToDesign(u.id, u.type === 'dummy' ? 1.4 : 1.7);
      const bar = bars[i]!;
      const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(bar.style.transform);
      return {
        type: u.type,
        hp: Math.ceil(u.hp),
        onScreen: !!at?.onScreen,
        at: at ? [at.x, at.y] : null,
        cls: bar.className,
        hidden: bar.hidden,
        num: bar.querySelector('.ub-num')!.textContent,
        pos: m ? [Number(m[1]), Number(m[2])] : null,
      };
    });
  });
  expect(rows).toHaveLength(6);
  expect(rows[0]!.cls).toContain('is-me');
  expect(rows[0]!.cls).not.toContain('is-enemy');
  for (const r of rows.slice(1)) {
    expect(r.cls).toContain('is-dummy');
    expect(r.cls).toContain('is-enemy');
  }
  const visibleDummies = rows.filter((r) => r.type === 'dummy' && r.onScreen);
  expect(visibleDummies.length, 'at least the idle dummy next to the stand spot is on screen').toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.hidden, `${r.type} bar hidden iff off screen`).toBe(!r.onScreen);
    if (!r.onScreen) continue;
    expect(r.num).toBe(String(r.hp));
    expect(Math.abs(r.pos![0] - r.at![0])).toBeLessThan(1);
    expect(Math.abs(r.pos![1] - r.at![1])).toBeLessThan(1);
  }
  await expect(page.locator('.ub.is-me .ub-ammo > i')).toHaveCount(3);
  await expect(page.locator('.ub.is-dummy .ub-ammo')).toHaveCount(0);
  // colours: own fill green, enemy fill red
  const fill = (sel: string) => page.locator(`${sel} .ub-fill`).first().evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(await fill('.ub.is-me')).toContain('rgb(72, 209, 106)');
  expect(await fill('.ub.is-enemy:not([hidden])')).toContain('rgb(255, 90, 90)');
  await shot(page, testInfo, '30-hud-bars');
});

test('T-31 player KO shows KNOCKED OUT + 3-2-1 countdown, input is ignored, then respawns at the spawn with full HP', async ({ page }, testInfo) => {
  await openBattle(page);
  await page.evaluate(() => {
    const w = window as QaWindow;
    const seen: string[] = [];
    w.__qaCountdown = seen;
    const num = document.querySelector('.respawn-num')!;
    new MutationObserver(() => {
      if (!document.querySelector<HTMLElement>('.respawn')!.hidden && seen.at(-1) !== num.textContent) seen.push(num.textContent!);
    }).observe(document.querySelector('.respawn')!, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const { turret, spot } = turretSpot();
  const turretId = await unitIdAt(page, turret);
  // ~3 tiles from the turret with a clear line of sight; HP 1 and no regen until hit
  await teleport(page, spot.x, spot.y);
  await page.evaluate(() => {
    const b = (window as QaWindow).__fgBattle!;
    b.player.hp = 1;
    b.player.lastCombatTick = b.sim.tick + 100_000;
  });
  const m = await eventMark(page);
  const hit = await waitForEvent(page, { type: 'hit', targetId: '$player', sourceId: turretId }, m, 60_000);
  expect(hit.killed).toBe(true);
  await waitForEvent(page, { type: 'death', unitId: '$player' }, m);

  await expect(page.locator('.respawn')).toBeVisible();
  await expect(page.locator('.respawn-title')).toHaveText('쓰러졌어요!');
  await expect(page.locator('.respawn-sub')).toHaveText('부활까지');
  await expect(page.locator('.respawn-num')).toHaveText(/^[123]$/);
  await expect(page.locator('.battle')).toHaveClass(/is-dead/);
  await expect(page.locator('.ko-veil')).toHaveClass(/is-on/);
  await expect(page.locator('.ub.is-me .ub-bar')).toBeHidden();
  await shot(page, testInfo, '31-knocked-out');

  // input while dead does nothing
  const dm = await eventMark(page);
  await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);
  await page.keyboard.press('Space');

  await waitForEvent(page, { type: 'respawn', unitId: '$player' }, m, 60_000);
  expect((await events(page, dm, 'attack')).filter((e) => e.unitId === hit.targetId)).toEqual([]);
  await expect(page.locator('.respawn')).toBeHidden();
  await expect(page.locator('.battle')).not.toHaveClass(/is-dead/);
  await expect(page.locator('.ko-veil')).not.toHaveClass(/is-on/);
  const p = await player(page);
  expect(p.alive).toBe(true);
  expect(p.hp).toBe(MAX_HP.rivet);
  expect(p.ammo).toBe(3);
  expect(p.pos).toEqual(SPAWN);
  const countdown = await page.evaluate(() => (window as QaWindow).__qaCountdown!);
  expect(countdown).toEqual(['3', '2', '1']);
  await expect(page.locator('.ub.is-me .ub-bar')).toBeVisible();
  await expect(page.locator('.ub.is-me .ub-num')).toHaveText(String(MAX_HP.rivet));
});

// ───────────────────────────── exit / model / PC / multi-touch / layout ─────────────────────────────

test('T-32 exit button returns to the lobby; the stage keeps rendering; PLAY again starts a fresh battle', async ({ page }, testInfo) => {
  await openBattle(page);
  await page.keyboard.down('KeyD'); // leave a key held while exiting
  await waitTicks(page, 3);
  await page.locator('.btn-battle-exit').tap();
  await page.keyboard.up('KeyD');
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'lobby');
  await expect(page.locator('.battle')).toHaveCount(0);
  await expect(page.locator('.hud')).toHaveCount(0);
  expect(await page.evaluate(() => (window as QaWindow).__fgBattle === undefined)).toBe(true);

  // lobby showcase is still drawn after the battle view was disposed
  expect(await drawCallsWithin(page, 10_000, 50), 'lobby scene draw calls').toBeGreaterThanOrEqual(50);
  // battle keys after leaving: no errors (fixture), nothing listens any more
  for (const k of ['Space', 'KeyE', 'KeyW', 'ArrowLeft']) await page.keyboard.press(k);
  await shot(page, testInfo, '32-lobby-after-battle');

  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'rivet');
  const p = await player(page);
  expect(p.pos).toEqual(SPAWN);
  expect(p.move).toEqual({ x: 0, y: 0 });
  await waitTicks(page, 5);
  expect((await player(page)).pos, 'no stuck key from the previous battle').toEqual(SPAWN);
  await page.locator('.btn-battle-exit').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  expect(await drawCallsWithin(page, 10_000, 50), 'lobby draws after the second exit').toBeGreaterThanOrEqual(50);
});

test('T-33 SAKURA HINAKO skin glb loads at boot without warnings; default HINAKO is the toon model in battle', async ({ page }) => {
  const warnings: string[] = [];
  const glb: Record<string, number> = {};
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('response', (r) => {
    const name = /models\/([\w-]+\.glb)$/.exec(r.url())?.[1];
    if (name) glb[name] = r.status();
  });
  await page.goto('/?qa');
  await tapToLobby(page);
  // 스킨(src/data/skins.ts)용 glb는 부팅 때 미리 받는다
  expect(glb).toEqual({ 'hinako.glb': 200, 'hinako_gun.glb': 200, 'reaper.glb': 200, 'reaper_scythe.glb': 200, 'chainer_crimson.glb': 200 });

  await selectFighterViaUi(page, 'hinako');
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'hinako');
  const model = await page.evaluate(() => {
    const scene = (window as QaWindow).__fgBattle!.view.scene;
    const root = scene.getObjectByName('fighter:hinako');
    let meshes = 0;
    let textured = 0;
    root?.traverse((o) => {
      const mesh = o as unknown as { isMesh?: boolean; material?: { map?: unknown } };
      if (!mesh.isMesh) return;
      meshes++;
      if (mesh.material?.map) textured++;
    });
    return { found: !!root, meshes, textured };
  });
  expect(model.found).toBe(true);
  expect(model.meshes, 'built from toon primitives').toBeGreaterThan(10);
  expect(model.textured, 'default look is not the textured skin (only the soft blob shadow has a map)').toBeLessThanOrEqual(1);
  expect(warnings.filter((w) => /model load failed/i.test(w))).toEqual([]);
});

test('T-34 PC: left click fires at the clicked ground point, right click supers there, Space auto-attacks', async ({ page }) => {
  await openBattle(page);
  await waitCameraSettled(page);
  const at = async (dx: number, dy: number) => toDesign(page, { x: SPAWN.x + dx, y: SPAWN.y + dy });

  let m = await eventMark(page);
  // points ahead of the spawn (toward the map centre) so they are on screen
  const f = await facingAtSpawn(page);
  const ahead = (fwd: number, side: number) => ({
    dx: Math.cos(f) * fwd - Math.sin(f) * side,
    dy: Math.sin(f) * fwd + Math.cos(f) * side,
  });
  const p1 = ahead(3, 2);
  const a = await at(p1.dx, p1.dy);
  await page.mouse.click(a.x, a.y);
  const atk = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: false }, m);
  expect(angleClose(atk.dir, Math.atan2(p1.dy, p1.dx)), `left click dir ${atk.dir}`).toBe(true);

  await setSuperCharge(page, 1);
  m = await eventMark(page);
  const p2 = ahead(3, -3);
  const s = await at(p2.dx, p2.dy);
  await page.mouse.click(s.x, s.y, { button: 'right' });
  const sup = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: true }, m);
  expect(angleClose(sup.dir, Math.atan2(p2.dy, p2.dx)), `right click dir ${sup.dir}`).toBe(true);

  await waitFullAmmo(page);
  m = await eventMark(page);
  const facing = (await player(page)).facing;
  await page.keyboard.press('Space');
  const auto = await waitForEvent(page, { type: 'attack', unitId: '$player', isSuper: false }, m);
  expect(angleClose(auto.dir, facing), 'Space with no target fires the facing way').toBe(true);
  // the mouse never created touch-stick state
  await expect(page.locator('.stick-move')).not.toHaveClass(/is-active/);
  await expect(page.locator('.stick-attack')).not.toHaveClass(/is-(held|aiming|cancel)/);
});

test('T-35 multi-touch: move with the left thumb while aiming and firing with the right', async ({ page }, testInfo) => {
  await openBattle(page);
  await waitFullAmmo(page);
  const fingers = await Fingers.create(page);
  const start = await player(page);

  await fingers.down(1, 300, 500);
  await fingers.move(1, 360, 500, 3);
  await expect.poll(async () => (await player(page)).move).toEqual({ x: 1, y: 0 });

  await fingers.down(2, ATTACK_STICK.x, ATTACK_STICK.y);
  await fingers.move(2, ATTACK_STICK.x, ATTACK_STICK.y + 90, 4);
  await expect.poll(async () => (await aimState(page)).aim?.aim).toEqual({ x: 0, y: 1 });
  expect((await player(page)).move, 'still moving while aiming').toEqual({ x: 1, y: 0 });
  await expect(page.locator('.stick-move')).toHaveClass(/is-active/);
  await expect(page.locator('.stick-attack')).toHaveClass(/is-aiming/);
  await shot(page, testInfo, '35-multitouch');

  const m = await eventMark(page);
  await fingers.up(2);
  const atk = await waitForEvent(page, { type: 'attack', unitId: '$player' }, m);
  expect(angleClose(atk.dir, Math.PI / 2), `aimed down, dir ${atk.dir}`).toBe(true);
  expect((await player(page)).move, 'lifting the aim finger keeps the move finger').toEqual({ x: 1, y: 0 });
  await expect(page.locator('.stick-move')).toHaveClass(/is-active/);
  await page.waitForFunction((x) => (window as QaWindow).__fgBattle!.player.pos.x > x + 1, start.pos.x);

  await fingers.up(1);
  await expect.poll(async () => (await player(page)).move).toEqual({ x: 0, y: 0 });
  await expect(page.locator('.stick-move')).not.toHaveClass(/is-active/);
  await fingers.dispose();
});

for (const vp of [
  { width: 1280, height: 800 },
  { width: 1280, height: 712 },
]) {
  test.describe(`battle layout ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    test(`T-36 battle controls anchored to the corners and tappable where drawn — ${vp.width}x${vp.height}`, async ({ page }, testInfo) => {
      await openBattle(page);
      const s = Math.min(vp.width / 1280, vp.height / 800);
      const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
      const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      const atk = await box('.stick-attack');
      const sup = await box('.stick-super');
      // docs/03: attack (right 140, bottom 160), super (right 270, bottom 100) in design px
      expect(centre(atk).x).toBeCloseTo(vp.width - 140 * s, 0);
      expect(centre(atk).y).toBeCloseTo(vp.height - 160 * s, 0);
      expect(centre(sup).x).toBeCloseTo(vp.width - 270 * s, 0);
      expect(centre(sup).y).toBeCloseTo(vp.height - 100 * s, 0);
      const faces = {
        exit: await box('.btn-battle-exit'),
        label: await box('.battle-label'),
        attack: await box('.stick-attack .knob-face'),
        super: await box('.stick-super .knob-face'),
      };
      const names = Object.keys(faces) as (keyof typeof faces)[];
      for (const n of names) {
        const b = faces[n];
        expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${n} inside viewport`).toBe(true);
      }
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const a = faces[names[i]!];
          const b = faces[names[j]!];
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(ox > 0.5 && oy > 0.5, `${names[i]} overlaps ${names[j]}`).toBe(false);
        }
      await shot(page, testInfo, `36-battle-${vp.width}x${vp.height}`);

      // input hit areas line up with what is drawn: tap the drawn attack stick → a shot
      const m = await eventMark(page);
      await page.touchscreen.tap(centre(atk).x, centre(atk).y);
      await waitForEvent(page, { type: 'attack', unitId: '$player' }, m);
      // and the drawn super button (not charged) → shakes, no shot
      await page.touchscreen.tap(centre(sup).x, centre(sup).y);
      await expect(page.locator('.stick-super')).toHaveClass(/shake-[ab]/);
    });
  });
}
