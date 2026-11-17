# 3단계 계획: 실시간 온라인 대전

Lead가 쓴 작업 지시서. **계약** 절의 파일은 바꾸지 않는다(필요하면 이유와 함께 Lead에게 보고).

## 목표
친구들끼리 방 코드로 모여 **3대3 TEAM FIGHT**를 실시간으로 한다.
- 로비에서 모드 선택: TRAINING(오프라인 연습장) / TEAM FIGHT(온라인)
- TEAM FIGHT: 서버 연결 → 방 만들기(코드 4글자) 또는 코드로 들어가기 → 방 화면(팀·캐릭터·준비, 빈자리 봇 채우기) → 방장이 시작 → 전투 → 결과 → 방으로 복귀
- 맵: BLOSSOM ARENA(`src/data/maps/arena.ts`), 팀0 왼쪽 / 팀1 오른쪽
- 규칙(teamfight): 상대를 쓰러뜨리면 팀 점수 +1. **10점 먼저** 또는 **2분 30초** 뒤 점수가 높은 팀 승리(같으면 무승부). 부활 3초.

완료 기준
- 같은 방의 브라우저 탭 2~6개가 서로의 움직임·공격·피해를 실시간으로 본다.
- 내 캐릭터 이동은 입력 즉시 반응(예측), 다른 유닛은 부드럽게 보간.
- 연결이 끊기면 다시 연결하거나 로비로 돌아갈 수 있고, 오류 없이 처리.
- 단위 테스트 + E2E(서버를 띄워 탭 2개로 대전) 통과.

## 계약 (바꾸지 말 것)
| 파일 | 내용 |
|---|---|
| `src/game/types.ts` | `MatchMode`, `MatchState`, `SimView.match`, 사건 `score`·`matchEnd` 추가 |
| `src/battle/types.ts` | `BattleLike`: 전투 화면이 쓰는 세션(오프라인 `BattleSession`과 온라인 세션이 같이 구현) |
| `src/net/protocol.ts` | 웹소켓 JSON 메시지, 방·경기 시작·스냅샷·결과 형식 |
| `src/net/api.ts` | `OnlineClient`: UI가 쓰는 온라인 기능 |
| `src/data/maps/index.ts` | 맵 id → MapDef (`getMap`) |

## 구조
```
브라우저(클라이언트)                          서버(Node, server/)
 UI ── OnlineClient ──(wss JSON)──▶ 방 관리 · 30틱 Sim 실행(src/game 공유)
 전투 화면 ◀─ 온라인 세션(BattleLike) ◀── snap(15회/초) + 사건
           └─ 내 이동 예측(moveCircle) + ack로 보정
```
- 서버 권위형: 클라이언트는 입력만 보낸다. 서버가 `Sim`을 30틱으로 돌리고 2틱마다 `snap`.
- 다른 유닛은 약 100ms 뒤를 보간해서 그린다. 내 캐릭터는 입력을 바로 반영(예측)하고, `ack` 이후 입력을 서버 위치에서 다시 적용해 보정.
- 벽 파괴 등 `wallsBroken` 사건은 클라이언트 격자에도 반영(맵 렌더러가 `grid.version`으로 갱신).

## Network — `server/`, `src/net/` (protocol.ts·api.ts 제외), `tests/unit/net/`
1. **서버**: Node + `ws`. `npm run server`(개발, 포트 8787), 빌드 스크립트(번들 1개), `Dockerfile`. 상태 확인용 HTTP `GET /health`.
2. **방**: 코드 4글자(헷갈리는 글자 제외), 최대 6명, 팀 자동 배정·변경, 방장 위임(방장이 나가면), 준비 표시, `fillBots`이면 빈자리를 봇으로(봇 조종은 Gameplay의 `src/game/bot.ts`), 경기 중 재접속(같은 playerId).
3. **경기**: `Sim({ mode: 'teamfight', map: getMap(mapId), fighters, dummies: false })`, 30틱 루프(드리프트 보정), 입력 큐(틱마다 플레이어별 마지막 이동 + 1회성 공격·궁극기), `snap` 2틱마다, `end` 후 방을 lobby로.
4. **클라이언트**: `createOnlineClient(): OnlineClient`(src/net/client.ts), 온라인 세션(`BattleLike` 구현): 스냅샷 버퍼·보간, 내 이동 예측·보정, 입력 송신(틱마다, seq), 핑 측정, 끊김 처리.
5. **서버 주소**: `src/net/config.ts` — 기본값 `import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8787'`, 설정에서 바꿀 수 있게 getter/setter 제공(UI가 연결).
6. **테스트**: 단위(방 규칙, 입력 큐), 서버를 띄워 가짜 클라이언트 2개로 경기 시작~스냅샷 수신.

## Gameplay — `src/game/` (world 제외), `tests/unit/game/`
1. **teamfight 규칙**: `match` 갱신(점수, 남은 시간, 승패), `score`·`matchEnd` 사건, 경기 끝나면 입력 무시. training은 지금처럼 무제한.
2. **봇**: `src/game/bot.ts` — `botInput(sim, fighterId): FighterInput`. 결정적(sim.rng만). 가장 가까운 보이는 적에게 다가가 사거리 안에서 공격, 체력이 낮으면 물러남, 궁극기 차면 사용, 벽에 끼면 우회. 서버와 오프라인 모두에서 쓸 수 있게.
3. 테스트.

## UI — `src/ui/`, `src/styles/`
1. 로비 모드 카드 → 모드 선택(TRAINING / TEAM FIGHT). PLAY: TRAINING이면 연습장, TEAM FIGHT면 온라인 화면.
2. 온라인 화면: 연결 상태, 방 만들기 / 코드 입력해 들어가기, 방 화면(코드 크게 표시, 팀별 슬롯 3+3, 캐릭터·준비 표시, 팀 바꾸기, 봇 채우기 토글, 방장 START), 오류 표시.
3. 전투 화면이 `BattleLike`를 받도록 정리(`session.sim` 대신 `session.state`), teamfight HUD: 위 가운데 팀 점수와 남은 시간, 핑 표시.
4. 결과 화면: 승/패/무, 점수, 플레이어별 KO·피해, 방으로 돌아가기.
5. 설정에 서버 주소 입력란.

## 공통 규칙
- 오리지널만. 자기 담당 파일만 수정, 공용 파일은 보고.
- 작업 공간: git worktree. 시작할 때 `ln -s /home/user/evnbin/node_modules node_modules`. 끝나면 worktree 브랜치에 커밋(push 금지).
- 확인: `npx tsc --noEmit`, `npm run test:unit`, `npm run build`.
