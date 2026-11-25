import type { MapDef } from '../../game/world';
import { BLOSSOM_ARENA } from './arena';
import { TRAINING_YARD } from './training';
import { MEADOW_PITCH } from './pitch';
import { FROST_HOLLOW } from './frost';
import type { MatchMode } from '../../game/types';

/** 맵 목록. 서버와 클라이언트가 같은 id로 찾는다 */
export const MAPS: Record<string, MapDef> = {
  [TRAINING_YARD.id]: TRAINING_YARD,
  [BLOSSOM_ARENA.id]: BLOSSOM_ARENA,
  [MEADOW_PITCH.id]: MEADOW_PITCH,
  [FROST_HOLLOW.id]: FROST_HOLLOW,
};

/** 모드마다 고를 수 있는 맵(첫 번째가 기본). 방장이 방에서 바꾼다 */
export const MODE_MAPS: Record<MatchMode, readonly string[]> = {
  training: [TRAINING_YARD.id],
  teamfight: [BLOSSOM_ARENA.id, FROST_HOLLOW.id],
  crystal: [BLOSSOM_ARENA.id, FROST_HOLLOW.id],
  ball: [MEADOW_PITCH.id],
};

export const mapsFor = (mode: MatchMode): readonly string[] => MODE_MAPS[mode];
export const isMapForMode = (mode: MatchMode, mapId: string): boolean => MODE_MAPS[mode].includes(mapId);

export function getMap(id: string): MapDef {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}
