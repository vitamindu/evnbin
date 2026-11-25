import type { MapDef } from '../../game/world';

/**
 * 파이터 볼 경기장(오리지널 배치). 위아래·좌우 대칭: 팀0(A) 아래에서 위쪽 골대(h)로, 팀1(Z) 위에서 아래쪽 골대(g)로 공을 넣는다.
 * 양 끝 가운데 3칸이 골대 칸(벽 안쪽으로 2칸 들어간 주머니), 가운데 'O'에 공을 놓는다.
 * 골대 앞 수풀, 상자 줄, 양옆 벽 기둥으로 패스 길을 만든다.
 */
export const MEADOW_PITCH: MapDef = {
  id: 'meadow-pitch',
  name: 'MEADOW PITCH',
  rows: [
    'XXXXXXXXXXXXXXXXXXXXX',
    'XXXXXXXXXhhhXXXXXXXXX',
    'XXXXXXXXXhhhXXXXXXXXX',
    'X,,,,,,BB...BB,,,,,,X',
    'X,,,....Z.Z.Z....,,,X',
    'X,,...............,,X',
    'X.....##.....##.....X',
    'X..BB.##.....##.BB..X',
    'X..BB...........BB..X',
    'X.......#.#.#.......X',
    'X##...............##X',
    'X##......BBB......##X',
    'X,,......BBB......,,X',
    'X,,...............,,X',
    'X,,,,.....O.....,,,,X',
    'X,,...............,,X',
    'X,,......BBB......,,X',
    'X##......BBB......##X',
    'X##...............##X',
    'X.......#.#.#.......X',
    'X..BB...........BB..X',
    'X..BB.##.....##.BB..X',
    'X.....##.....##.....X',
    'X,,...............,,X',
    'X,,,....A.A.A....,,,X',
    'X,,,,,,BB...BB,,,,,,X',
    'XXXXXXXXXgggXXXXXXXXX',
    'XXXXXXXXXgggXXXXXXXXX',
    'XXXXXXXXXXXXXXXXXXXXX',
  ],
};
