/**
 * 경기 명단 → 시뮬레이션 출발 설정. 서버와 클라이언트가 같은 규칙을 써야 파이터 id·출발 지점이 일치한다.
 * Network 담당. DOM·Three.js import 금지.
 *
 * 규칙: 명단 순서대로 파이터를 만든다(첫 파이터 id = 1). 출발 지점 번호는 같은 팀 안에서의 명단 순서.
 */
import type { SpawnFighter } from '../game/types';
import type { MatchRosterEntry } from './protocol';

export function rosterSpawns(roster: readonly Pick<MatchRosterEntry, 'team' | 'fighterId' | 'bot'>[]): SpawnFighter[] {
  const perTeam = [0, 0];
  return roster.map((r) => ({
    fighterId: r.fighterId,
    team: r.team,
    controller: r.bot ? 'bot' : 'player',
    spawnIndex: perTeam[r.team]!++,
  }));
}
