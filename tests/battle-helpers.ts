import type { CDPSession, Page } from '@playwright/test';
import type { BattleSession } from '../src/battle/session';
import type { FighterId } from '../src/data/fighters';
import type { SimEvent, Vec2 } from '../src/game/types';
import { PROFILE_KEY, expect, tapToLobby } from './fixtures';

/**
 * Phase 2 (battle) helpers. The battle screen exposes the running BattleSession as `window.__fgBattle`
 * when the URL has `?qa` (src/ui/screens/battle.ts). Everything here only reads that object, except the
 * explicit test levers (`teleport`, `setSuperCharge`, `setPlayer`) which poke sim state between ticks.
 *
 * swiftshader renders at ~5-10 fps and the session caps catch-up at 0.1 s per frame, so the sim runs
 * slower than real time (~10-17 ticks/s instead of 30). Always wait on sim state/ticks, never on wall time.
 */

export const NAMES: Record<FighterId, string> = { rivet: 'RIVET', volley: 'VOLLEY', boulder: 'BOULDER', hinako: 'HINAKO' };
export const MAX_HP: Record<FighterId, number> = { rivet: 3800, volley: 2800, boulder: 5600, hinako: 2400 };
export const FIGHTER_IDS: FighterId[] = ['rivet', 'volley', 'boulder', 'hinako'];

/** TRAINING YARD (src/data/maps/training.ts): team-0 spawn `A` at tile (3, 9) → centre (3.5, 9.5). */
export const SPAWN: Vec2 = { x: 3.5, y: 9.5 };
/** Design-px centres from docs/03 / phase2-plan at 1280×800 (scale 1, so also CSS px). */
export const ATTACK_STICK: Vec2 = { x: 1140, y: 640 };
export const SUPER_BTN: Vec2 = { x: 1010, y: 700 };

export type QaEvent = SimEvent & { tick: number };
type EventType = SimEvent['type'];
/** A recorded event of one kind (with the tick it happened on). */
export type Ev<T extends EventType> = Extract<SimEvent, { type: T }> & { tick: number };
type Match<T extends EventType> = { type: T } & Record<string, string | number | boolean>;
export interface TraceRow {
  tick: number;
  x: number;
  y: number;
  action: string | null;
  alive: boolean;
  hp: number;
  ammo: number;
  charge: number;
  /** sim.lobs.length after the tick */
  lobs: number;
  /** player's own projectiles in flight after the tick */
  shots: number;
}
export interface QaRecorder {
  events: QaEvent[];
  trace: TraceRow[];
}
export type QaWindow = Window & { __fgBattle?: BattleSession; __qa?: QaRecorder; __qaCountdown?: string[] };

export interface PlayerState {
  tick: number;
  id: number;
  fighterId: FighterId;
  pos: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  ammo: number;
  superCharge: number;
  alive: boolean;
  action: string | null;
  move: Vec2;
}

/** Make `id` the selected fighter before the app boots (runs after the fixture's storage reset). */
export async function seedSelectedFighter(page: Page, id: FighterId) {
  await page.addInitScript(
    ([key, fighter]) => {
      try {
        if (!localStorage.getItem(key!)) localStorage.setItem(key!, JSON.stringify({ selected: fighter }));
      } catch {
        /* storage unavailable */
      }
    },
    [PROFILE_KEY, id],
  );
}

/** From the lobby: FIGHTERS → card → SELECT → back → back, i.e. the real UI path (ends on the lobby). */
export async function selectFighterViaUi(page: Page, id: FighterId) {
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await page.locator(`.fcard[data-fighter="${id}"]`).tap();
  await expect(page.locator('.detail-name')).toHaveText(NAMES[id]);
  const select = page.locator('.btn-select');
  if ((await select.innerText()).trim() !== '선택됨') await select.tap();
  await expect(select).toHaveText('선택됨');
  await page.locator('.detail .btn-back').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await page.locator('.fighters .btn-back').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('.nameplate .np-name')).toHaveText(NAMES[id]);
}

/** Load `/?qa`, go to the lobby with `fighter` selected (seeded storage), tap PLAY and wait for the battle loop. */
export async function openBattle(page: Page, fighter: FighterId = 'rivet') {
  if (fighter !== 'rivet') await seedSelectedFighter(page, fighter);
  await page.goto('/?qa');
  await tapToLobby(page);
  await expect(page.locator('.nameplate .np-name')).toHaveText(NAMES[fighter]);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, fighter);
}

/** Battle screen shown, session exposed, sim ticking, HUD drawn; installs the event/trace recorder. */
export async function waitBattleReady(page: Page, fighter: FighterId) {
  await expect(page.locator('.battle')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'battle');
  await page.waitForFunction(
    (id) => {
      const b = (window as QaWindow).__fgBattle;
      return !!b && b.player.fighterId === id && b.sim.tick >= 2;
    },
    fighter,
    { timeout: 20_000 },
  );
  await installRecorder(page);
  await expect(page.locator('.ub.is-me .ub-bar')).toBeVisible();
}

/**
 * Wrap `sim.step` (observe only) so every tick's events and a compact player trace are kept in `window.__qa`.
 * The session still receives the same event array, so `session.onEvents` (HUD, sfx) is untouched.
 */
export async function installRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as QaWindow;
    const b = w.__fgBattle!;
    const sim = b.sim as unknown as { step: (i: unknown) => SimEvent[] } & BattleSession['sim'];
    const qa: QaRecorder = { events: [], trace: [] };
    w.__qa = qa;
    const orig = sim.step;
    sim.step = function (this: unknown, inputs: unknown) {
      const ev = orig.call(this, inputs as never);
      const t = sim.tick;
      for (const e of ev) qa.events.push({ ...e, tick: t } as QaEvent);
      const p = b.player;
      qa.trace.push({
        tick: t,
        x: p.pos.x,
        y: p.pos.y,
        action: p.action ? p.action.kind : null,
        alive: p.alive,
        hp: p.hp,
        ammo: p.ammo,
        charge: p.superCharge,
        lobs: sim.lobs.length,
        shots: sim.projectiles.filter((s) => s.ownerId === b.playerId).length,
      });
      return ev;
    };
  });
}

export async function player(page: Page): Promise<PlayerState> {
  return page.evaluate(() => {
    const b = (window as QaWindow).__fgBattle!;
    const p = b.player;
    return {
      tick: b.sim.tick,
      id: p.id,
      fighterId: p.fighterId,
      pos: { ...p.pos },
      facing: p.facing,
      hp: p.hp,
      maxHp: p.maxHp,
      ammo: p.ammo,
      superCharge: p.superCharge,
      alive: p.alive,
      action: p.action ? p.action.kind : null,
      move: { ...b.controls.move },
    };
  });
}

export const simTick = (page: Page) => page.evaluate(() => (window as QaWindow).__fgBattle!.sim.tick);

/** Wait until the sim has advanced `n` more ticks. */
export async function waitTicks(page: Page, n: number, timeout = 30_000) {
  const start = await simTick(page);
  await page.waitForFunction((t) => (window as QaWindow).__fgBattle!.sim.tick >= t, start + n, { timeout });
}

/** Index to pass as `since` so only events after "now" are matched. */
export const eventMark = (page: Page) => page.evaluate(() => (window as QaWindow).__qa!.events.length);

export async function events<T extends EventType>(page: Page, since: number, type: T): Promise<Ev<T>[]>;
export async function events(page: Page, since?: number): Promise<QaEvent[]>;
export async function events(page: Page, since = 0, type?: EventType): Promise<QaEvent[]> {
  return page.evaluate(
    ([from, t]) => (window as QaWindow).__qa!.events.slice(from as number).filter((e) => !t || e.type === t),
    [since, type ?? null] as const,
  );
}

export async function trace(page: Page): Promise<TraceRow[]> {
  return page.evaluate(() => (window as QaWindow).__qa!.trace.slice());
}

/**
 * Wait for the first recorded event (index ≥ since) whose fields include `match`.
 * Special value '$player' in match is replaced by the player's entity id.
 */
export async function waitForEvent<T extends EventType>(page: Page, match: Match<T>, since = 0, timeout = 30_000): Promise<Ev<T>> {
  const h = await page.waitForFunction(
    ([m, from]) => {
      const w = window as QaWindow;
      const pid = w.__fgBattle!.playerId;
      const want = Object.entries(m as Record<string, unknown>).map(([k, v]) => [k, v === '$player' ? pid : v] as const);
      return (
        w.__qa!.events.slice(from as number).find((e) => want.every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v)) ??
        null
      );
    },
    [match, since] as const,
    { timeout },
  );
  return (await h.jsonValue()) as Ev<T>;
}

/** Make sure no event matching `match` arrives during the next `ticks` sim ticks. */
export async function expectNoEvent<T extends EventType>(page: Page, match: Match<T>, since: number, ticks = 12) {
  await waitTicks(page, ticks);
  const pid = await page.evaluate(() => (window as QaWindow).__fgBattle!.playerId);
  const got = (await events(page, since)).filter((e) =>
    Object.entries(match).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === (v === '$player' ? pid : v)),
  );
  expect(got, `no ${JSON.stringify(match)} event`).toEqual([]);
}

/** Test lever: move the player to a free floor tile centre (between ticks). */
export async function teleport(page: Page, x: number, y: number) {
  await page.evaluate(
    ([px, py]) => {
      const p = (window as QaWindow).__fgBattle!.player;
      p.pos = { x: px!, y: py! };
    },
    [x, y],
  );
  await waitTicks(page, 2);
}

export async function setSuperCharge(page: Page, k: number) {
  await page.evaluate((v) => {
    (window as QaWindow).__fgBattle!.player.superCharge = v;
  }, k);
}

/** Wait until the player has stood still (no action, full ammo) — clean start for attack tests. */
export async function waitFullAmmo(page: Page) {
  await page.waitForFunction(() => {
    const p = (window as QaWindow).__fgBattle!.player;
    return p.alive && !p.action && p.ammo >= p.maxAmmo;
  });
}

/** View's current aim indicator (BattleView private state, read at runtime). */
export async function aimState(page: Page): Promise<{ aim: { which: string; aim: Vec2 } | null; shapes: string[] }> {
  return page.evaluate(() => {
    const v = (window as QaWindow).__fgBattle!.view as unknown as {
      aim: { which: string; aim: Vec2 } | null;
      aimShapes: Map<string, { visible: boolean }>;
    };
    return {
      aim: v.aim ? { which: v.aim.which, aim: { ...v.aim.aim } } : null,
      shapes: [...v.aimShapes.entries()].filter(([, o]) => o.visible).map(([k]) => k),
    };
  });
}

/** Design-px position of a plane point (as BattleView projects it for the HUD). */
export async function toDesign(page: Page, p: Vec2, height = 0) {
  return page.evaluate(
    ([pt, h]) => (window as QaWindow).__fgBattle!.view.toDesign(pt as Vec2, h as number),
    [p, height] as const,
  );
}

/** Wait until the follow camera has settled on the player (two frames give the same projection). */
export async function waitCameraSettled(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const d = await page.evaluate(() => {
          const b = (window as QaWindow).__fgBattle!;
          const at = b.view.toDesign(b.player.pos, 0);
          return `${at.x.toFixed(0)},${at.y.toFixed(0)}`;
        });
        const same = d === last;
        last = d;
        return same;
      },
      { message: 'camera settled on the player', intervals: [250], timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Wait until the stage canvas has issued at least `min` WebGL draw calls (wraps the context's draw methods,
 * then restores them), giving up after `maxMs`. Returns the count. swiftshader sometimes stalls ~1 s between
 * frames, so give a generous deadline rather than sampling a fixed short window.
 */
export async function drawCallsWithin(page: Page, maxMs: number, min = 1): Promise<number> {
  return page.evaluate(
    async ([dur, need]) => {
      const c = document.getElementById('scene') as HTMLCanvasElement;
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as unknown as Record<string, (...a: unknown[]) => unknown>;
      let n = 0;
      const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
      for (const k of names) {
        const f = gl[k];
        if (typeof f !== 'function') continue;
        gl[k] = function (this: unknown, ...a: unknown[]) {
          n++;
          return f.apply(this, a);
        };
      }
      const t0 = performance.now();
      while (n < need! && performance.now() - t0 < dur!) await new Promise((r) => setTimeout(r, 50));
      for (const k of names) delete gl[k];
      return n;
    },
    [maxMs, min],
  );
}

/**
 * Real touch input through CDP (Input.dispatchTouchEvent), so Chromium produces genuine touch + pointer
 * events (pointerType 'touch', implicit capture, multi-touch). Coordinates are CSS px.
 * Note: pointermove is rAF-aligned, so poll the resulting state after `move`.
 */
export class Fingers {
  private readonly pts = new Map<number, Vec2>();
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async create(page: Page) {
    return new Fingers(page, await page.context().newCDPSession(page));
  }

  private list() {
    return [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y }));
  }

  /**
   * Chromium dispatches pointermove aligned to animation frames (and coalesces it), so wait two frames
   * after the last move: by then the page has seen the finger's final position.
   */
  private frames() {
    return this.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }

  async down(id: number, x: number, y: number) {
    this.pts.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() });
  }

  /** Move finger `id` to (x, y) in `steps` equal touchMove events, then let the page process them. */
  async move(id: number, x: number, y: number, steps = 4) {
    const from = this.pts.get(id);
    if (!from) throw new Error(`finger ${id} is not down`);
    for (let i = 1; i <= steps; i++) {
      this.pts.set(id, { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
    }
    await this.frames();
  }

  /** Lift only finger `id` (touchEnd carrying just that point). */
  async up(id: number) {
    const p = this.pts.get(id);
    if (!p) return;
    this.pts.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y }] });
  }

  async tap(id: number, x: number, y: number) {
    await this.down(id, x, y);
    await this.up(id);
  }

  async dispose() {
    for (const id of [...this.pts.keys()]) await this.up(id);
    await this.cdp.detach().catch(() => {});
  }
}

/** translate3d(x, y, …) of an element's inline transform → [x, y] */
export async function translateOf(page: Page, selector: string): Promise<[number, number]> {
  const t = await page.locator(selector).first().evaluate((e: HTMLElement) => e.style.transform);
  const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(t);
  if (!m) throw new Error(`no translate3d on ${selector}: "${t}"`);
  return [Number(m[1]), Number(m[2])];
}

export const angleClose = (a: number, b: number, tol = 0.02) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= tol;
