# 2단계 계획: 오프라인 전투 (연습장)

Lead가 쓴 작업 지시서. 각 에이전트는 자기 절을 따르고, **계약** 절의 형식은 바꾸지 않는다(바꿔야 하면 이유와 함께 Lead에게 보고).

## 목표
로비에서 PLAY → **TRAINING YARD** 전투 화면. 선택한 캐릭터로 움직이고, 기본 공격과 궁극기를 쓰고, 연습용 더미를 쓰러뜨린다. 왼쪽 위 버튼으로 로비에 돌아간다. 온라인 대전은 3단계.

완료 기준
- 터치(태블릿)와 키보드·마우스(PC) 모두로 조작 가능
- RIVET·VOLLEY·BOULDER의 기본 공격·궁극기가 `docs/01-core-mechanics.md` 대로 동작
- 피해, 넉백, 궁극기 충전, 체력 회복, 부활, 수풀 은신, 벽 파괴 동작
- 더미 3종(idle, patrol, turret) 동작
- 전투 화면 HUD: 체력·탄창·궁극기 게이지, 피해 숫자, 사망 시 부활 카운트다운
- 단위 테스트(`npm run test:unit`)와 기존 E2E(`npm run test:e2e`) 통과, 콘솔 오류 없음

## 현재 뼈대 (Lead가 만든 것, 그대로 동작함)
| 파일 | 내용 | 이후 담당 |
|---|---|---|
| `src/game/types.ts` | 시뮬레이션 공용 타입 | **Lead (계약)** |
| `src/game/sim.ts` | 이동, 탄창·재장전, 직선 투사체, 피해·사망·부활 | Gameplay |
| `src/game/world/*` | 격자, 충돌(단순 구현) | World |
| `src/data/maps/training.ts` | 연습장 초안 | World |
| `src/render/world/mapRenderer.ts` | 맵 3D(단순 구현) | World |
| `src/render/battle/battleView.ts` | 유닛·투사체·효과·카메라·조준 표시 | **Lead** |
| `src/render/battle/dummyModel.ts` | 더미 3D 모델 | **Lead** |
| `src/battle/session.ts` | 30틱 고정 루프, 입력 전달 | **Lead (계약)** |
| `src/ui/screens/battle.ts` | 나가기 버튼, 키보드·마우스 조작 | UI |
| `src/styles/battle.css` | 전투 화면 스타일 | UI |

## 계약 (바꾸지 말 것)
- **타입**: `src/game/types.ts` 전체. 좌표는 타일, 각도 라디안(+x=0, +y=화면 아래), 30틱/초.
- **Sim**: `new Sim({ map, seed, fighters, dummies })`, `step(Map<EntityId, FighterInput>) → SimEvent[]`, `units`, `projectiles`, `lobs`, `grid`, `tick`, `getUnit(id)`. 시뮬레이션 안에서는 `Math.random` 금지(`sim.rng` 사용). DOM·Three.js import 금지.
- **World**: `src/game/world/index.ts`가 내보내는 것 — `Grid`, `Tile`, `MapDef`, `moveCircle(grid, pos, r, dx, dy)`, `sweepCircle(grid, from, to, r, { breakWalls? }) → { hit, point, tile?, broken }`, `hasLineOfSight`, `isInBush`, `breakWallsInCircle`, `circleBlocked`. 맵 글자 규칙은 `grid.ts` 주석.
- **MapRenderer**: `new MapRenderer(grid)`, `.object`, `.update(t, dt, viewer)`, `.dispose()`. 월드 좌표 = (타일x, 높이, 타일y), 바닥 y=0.
- **BattleView(UI가 쓰는 부분)**: `setAim({ unitId, which: 'attack'|'super', aim } | null)`, `unitToDesign(id, height)`, `toDesign(pos, height)`, `groundAtDesign(x, y)`.
- **BattleSession(UI가 쓰는 부분)**: `controls.move`, `queueAttack(aim)`, `queueSuper(aim)`, `player`, `playerId`, `sim`, `view`, `onFrame`, `onEvents`.
- 조준값 `aim`: 길이 0~1 벡터(방향 + 사거리 비율). `null`이면 자동 조준.

## Gameplay — `src/game/` (world 제외), `src/data/fighters.ts` 수치, `tests/unit/game/`
1. **spread**: 부채꼴로 `count`발을 균등 각도로 동시 발사. 가까울수록 많이 맞는다(별도 보정 없이 기하로).
2. **burst**: `count`발을 `burstInterval`초 간격으로 연사(액션 `burst`). 연사 중 이동 가능, 새 공격 불가. `lateralOffset`이 있으면 발사 위치를 진행 방향의 좌우로 번갈아 띄운다.
3. **궁극기**: 같은 종류 규칙 + `SuperDef` 값. `breaksWalls`이면 `sweepCircle(..., { breakWalls: true })`로 부서지는 벽을 부수며 계속 날아가고, 부순 타일은 `wallsBroken` 사건으로 알린다. `knockback`이면 맞은 대상을 밀어낸다.
4. **dash**(BOULDER 궁극기): 조준 방향으로 `projectileSpeed` 속도로 `range`만큼 돌진(액션 `dash`). 매 틱 주변 부서지는 벽을 부수고, 닿은 적에게 한 번씩 피해 + 넉백. 단단한 벽·물·맵 끝에서 멈춘다.
5. **넉백**: 액션 `knockback`, 약 0.25초 동안 `moveCircle`로 밀려남. 그동안 이동·공격 불가.
6. **궁극기 충전**: 기본 공격이 적에게 맞을 때마다 `superChargePerHit`(궁극기 적중은 충전 없음). 1이 되면 `superReady`. 게이지 1 미만이면 궁극기 입력 무시. 탄이 없으면 `noAmmo`.
7. **자동 조준**: `aim=null`이면 사거리 안에서 보이는(시야·수풀 규칙) 가장 가까운 적 방향. 없으면 바라보는 방향.
8. **체력 회복**: 마지막 전투 후 3초 지나면 초당 최대 체력의 13%. 더미는 2초 후 빠르게 전부 회복.
9. **수풀**: `inBush` 갱신, 공격하면 1초 노출(`revealedUntil`). `src/game/visibility.ts`에 `isVisibleTo(sim, unit, team)`를 만든다(같은 팀은 항상, 적은 수풀 밖이거나 노출 중이거나 2.5타일 이내).
10. **더미**: idle(가만히), patrol(시작점 기준 좌우 3타일 왕복, 벽에 막히면 반대로), turret(1.5초마다 사거리 8·시야 안 가장 가까운 적 파이터에게 느린 탄: 속도 7, 피해 400). 죽으면 2초 뒤 부활.
11. **단위 테스트**: 각 항목. 결정성(같은 시드·입력 → 같은 결과) 테스트 유지.

## World — `src/game/world/`, `src/data/maps/`, `src/render/world/`, `tests/unit/world/`
1. **충돌 정확도**: `moveCircle`(모서리에서 걸리지 않고 미끄러짐), `sweepCircle`(초당 22타일 탄도 벽을 뚫지 않음, 시작점이 벽 안일 때 처리), `hasLineOfSight`, `breakWallsInCircle`. 지금 구현을 개선하거나 교체.
2. **연습장 맵 다시 디자인**: 가로로 긴 맵(가로 30~36, 세로 17~21). 왼쪽 팀0 출발, 오른쪽에 더미 구역. 부서지는 벽 묶음, 단단한 벽, 수풀, 물, 탁 트인 사격장(거리 감각용). 더미: idle 3개 이상, patrol 1개, turret 1개(벽 뒤 엄폐). 오리지널 배치.
3. **맵 그래픽**: 바닥 타일 변화, 부서지는 벽(나무 상자·흙벽돌 느낌)과 단단한 벽(돌)이 확실히 구분, 수풀은 뭉게뭉게(바람에 살짝 흔들림), 물 표면 움직임, 맵 바깥 장식. 플레이어가 들어간 수풀 덩어리는 반투명. 벽이 부서질 때 전체를 다시 만들지 말고 해당 칸만 갱신.
4. **성능**: 맵 드로우콜 60 이하(InstancedMesh). 그림자 맵 사용 금지.
5. **단위 테스트**: 충돌 함수.

## UI — `src/ui/screens/battle.ts`, `src/ui/battle/`, `src/styles/battle.css`
1. **터치 조작**
   - 이동: 화면 왼쪽 절반 아무 곳이나 누르면 그 자리에 조이스틱(반경 80, 데드존 12%). 놓으면 사라짐.
   - 공격: 오른쪽 아래 고정 조이스틱(중심 약 (1140, 640), 반경 80). **짧게 탭** = 자동 조준 `queueAttack(null)`. **끌기** = `view.setAim({ which:'attack', aim })`로 조준선 표시, 놓으면 `queueAttack(aim)`. 중앙 20px 안으로 되돌려 놓으면 취소.
   - 궁극기: 공격 조이스틱 왼쪽 위(약 (1010, 700)), 같은 방식. `player.superCharge < 1`이면 회색, 충전 정도를 링으로 표시, 가득 차면 빛남.
   - 멀티터치(pointerId별 추적). 버튼 위 터치는 이동 조이스틱이 가져가지 않음.
2. **PC 조작 유지**: WASD/방향키 이동, 마우스 왼쪽 클릭 공격, 오른쪽 클릭 궁극기, Space 자동 공격, E 자동 궁극기.
3. **HUD**: 모든 유닛 머리 위 체력 막대 + 숫자(`view.unitToDesign`), 아군 초록·적 빨강. 플레이어는 체력 아래 탄창 3칸(재장전 진행 표시). 피해 숫자(`hit` 사건). 사망 시 가운데 부활 카운트다운. 위 가운데 "TRAINING YARD".
4. **성능**: 요소는 재사용, 위치는 `transform: translate3d`, 매 프레임 레이아웃을 일으키는 읽기 금지.
5. **로비**: 모드 카드·PLAY 연결은 끝나 있음. 필요하면 다듬기만.

## 공통 규칙
- 오리지널만: 다른 게임의 이름·캐릭터·아트·UI를 따라 하지 않는다.
- 자기 담당 파일만 수정. 공용 파일(`package.json`, `docs/`, 다른 담당 폴더)을 고쳐야 하면 하지 말고 보고.
- 작업 공간: Lead가 준 git worktree. 시작할 때 `ln -s /home/user/evnbin/node_modules node_modules`(설치 시간 절약). 끝나면 **worktree 브랜치에 커밋**(push 금지).
- 확인: `npx tsc --noEmit`, `npm run test:unit`, 빌드 후 1280×800 터치 Chromium 스크린샷.
- 보고: 바꾼 파일, 계약에 필요한 변경 제안, 문서(`docs/`)에 반영할 내용, 남은 문제.
