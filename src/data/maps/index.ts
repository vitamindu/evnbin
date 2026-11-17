import type { MapDef } from '../../game/world';
import { BLOSSOM_ARENA } from './arena';
import { TRAINING_YARD } from './training';

/** 맵 목록. 서버와 클라이언트가 같은 id로 찾는다 */
export const MAPS: Record<string, MapDef> = {
  [TRAINING_YARD.id]: TRAINING_YARD,
  [BLOSSOM_ARENA.id]: BLOSSOM_ARENA,
};

export function getMap(id: string): MapDef {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}
