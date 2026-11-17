import type { MapDef } from '../../game/world';

/**
 * 연습장(임시 초안, World 담당이 다시 디자인한다). 가로로 긴 맵: 팀0 왼쪽, 더미는 오른쪽.
 */
export const TRAINING_YARD: MapDef = {
  id: 'training-yard',
  name: 'TRAINING YARD',
  rows: [
    'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'X..........BBB.............X',
    'X..........BBB......d......X',
    'X...##..............d......X',
    'X...##.......###...........X',
    'X..A.........###.....p.....X',
    'X.........WW...............X',
    'X.........WW.........t.....X',
    'X...##..............d......X',
    'X...##.....BBB.............X',
    'X..........BBB.............X',
    'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  ],
};
