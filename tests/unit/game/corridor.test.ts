import { describe, expect, it } from 'vitest';
import { FIGHTERS } from '../../../src/data/fighters';
import { MAX_FIGHTER_RADIUS, fighterRadius } from '../../../src/game/rules';
import { Grid, moveCircle } from '../../../src/game/world';
import { testMap } from './helpers';

/** 가로 9칸 맵 가운데(y=5)에 벽 줄, x=4 한 칸만 뚫린 통로 */
function corridorGrid() {
  const marks: Array<[number, number, string]> = [];
  for (let x = 1; x <= 7; x++) if (x !== 4) marks.push([x, 5, 'X']);
  return new Grid(testMap(9, 11, marks));
}

const walk = (grid: Grid, start: { x: number; y: number }, r: number, dir: { x: number; y: number }, ticks = 200) => {
  let p = { ...start };
  for (let i = 0; i < ticks; i++) p = moveCircle(grid, p, r, dir.x * 0.08, dir.y * 0.08);
  return p;
};

describe('1칸 통로', () => {
  it(`모든 파이터의 몸이 1칸 통로에 들어간다(반지름 ≤ ${MAX_FIGHTER_RADIUS})`, () => {
    for (const f of FIGHTERS) expect(fighterRadius(f.id), f.id).toBeLessThanOrEqual(MAX_FIGHTER_RADIUS);
  });

  for (const f of FIGHTERS) {
    it(`${f.name}: 통로 정면에서, 그리고 0.3칸 비껴서도 위로 지나간다`, () => {
      const r = fighterRadius(f.id);
      const grid = corridorGrid();
      for (const x of [4.5, 4.2, 4.8]) {
        const end = walk(grid, { x, y: 8.5 }, r, { x: 0, y: -1 });
        expect(end.y, `${f.id} from x=${x}`).toBeLessThan(4);
      }
    });
  }

  it('대각선으로 비스듬히 들어가도 지나간다', () => {
    const grid = corridorGrid();
    const r = fighterRadius('boulder');
    const end = walk(grid, { x: 3.3, y: 8.5 }, r, { x: 0.2, y: -0.98 });
    expect(end.y).toBeLessThan(4);
  });
});
