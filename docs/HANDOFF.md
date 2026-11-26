# 인수인계 — 다른 에이전트(모델)로 이어서 개발할 때

이 문서는 Claude 이외의 모델(예: FreeLLMAPI 뒤의 무료 모델)로 `claude` 세션을 열어도 **같은 개발 방식**을 유지하기 위한 안내다. 먼저 `CLAUDE.md`와 이 문서를 끝까지 읽는다.

## 0. 가장 중요한 규칙 (어기면 되돌린다)
1. **답변·커밋 메시지·문서는 한국어.** 사용자가 한국어로 말한다.
2. **오리지널만.** 다른 게임의 이름·캐릭터·아트·UI·고유 명칭을 따라 만들지 않는다. 사용자가 "~를 본따서"라고 해도 이름·외형·고유 설정은 새로 짓는다(장르의 일반 메커니즘만 쓴다).
3. **탄환 색:** 보는 사람 기준 우리 팀 탄환 = 파랑, 상대 팀 = 빨강. 캐릭터·스킨별 색 금지. 스킨 이펙트 이미지는 흑백으로 두고 화면에서 팀 색을 곱한다.
4. **수치를 바꾸면 `docs/`와 `src/data/`를 같이** 고친다.
5. **`src/game/`은 DOM·Three.js를 import하지 않는다**(서버와 공유하는 결정적 로직). 난수는 시드 기반만.
6. **UI는 1280×800 설계 좌표**, 기기는 Galaxy Tab S9 FE+(가로). 웹+PWA(APK 아님).
7. **push 전에 검사를 통과시킨다:** `npm run check`(타입 + 단위 테스트). 화면을 건드렸으면 관련 E2E도.
8. **푸시는 지정된 개발 브랜치로만.** `main`에 직접 push하지 않는다. 사용자가 시키지 않은 PR·force push·히스토리 재작성 금지.
9. **비밀값(API 키, 토큰, 계정 비밀번호)을 코드·문서·커밋에 쓰지 않는다.**
10. **비용이 드는 서버 설정(Fly 메모리·머신 수 등)은 사용자 허락 없이 바꾸지 않는다.** 지금은 512MB, 접속 없으면 자동 정지.

## 1. 폴더와 담당 (`docs/05-technical-architecture.md`가 기준)
| 폴더 | 내용 |
|---|---|
| `src/game/` | 순수 게임 로직(Sim, 봇, 규칙, 맵 충돌) |
| `src/data/` | 캐릭터·스킨·상점·패스·상자·랭크·맵 데이터 |
| `src/render/` | Three.js(모델·맵·전투 화면·이펙트) |
| `src/ui/` | DOM 화면·팝업·위젯 |
| `src/net/`, `server/` | 온라인(서버 권위형, 스냅샷+보간), 계정 JSON 저장소 |
| `tests/unit/`, `tests/*.spec.ts` | Vitest, Playwright E2E |
| `public/models`, `public/effects` | 사용자가 준 glb·이펙트 이미지 |

`.claude/agents/`에 역할(gameplay, network, world, ui, qa)이 있다. 서브에이전트를 쓸 수 있으면 **한 번에 하나씩** 돌린다(사용량 절약). 쓸 수 없으면 직접 하되 담당 폴더 밖은 꼭 필요할 때만 건드린다.

## 2. 작업 순서
1. 관련 `docs/`를 읽는다 → 2. 데이터(`src/data`) → 로직(`src/game`) → 화면 순으로 고친다 → 3. 테스트를 같이 추가/수정한다 → 4. 문서를 고친다 → 5. `npm run check` → 6. 커밋(작은 단위, 한국어) → 7. push.

- 새 캐릭터: `FIGHTERS`에 항목 + 모델 빌더 1개(`src/render/fighterModel.ts`) + 계정 기본값(`accountApi.ts`)은 이미 `FIGHTERS`를 돌므로 자동. 목록 화면은 5열이다.
- 새 스킨: `src/data/skins.ts`에 `rarity`(서사 100다이아 / 전설 1000다이아, `RARITY_PRICE`) 등. 전설은 `effects`(trail/superShot/hit)로 이펙트까지 바꾼다. glb는 `gltf-transform optimize`로 줄여서(몸 1024px, meshopt) `public/models`에 둔다.
- 새 공격 종류: `AttackKind`/`SuperKind` 추가 → `shotSpec`(`src/game/sim.ts`) → 단위 테스트(`tests/unit/game/`)까지.

## 3. 명령
```
npm run dev            개발 서버
npm run check          타입 검사 + 단위 테스트 (push 전 필수)
npm run build          타입 검사 + 빌드
npm run test:e2e       빌드 후 Playwright 전체(약 20분, 기기가 느리면 시간 초과가 날 수 있음)
npx playwright test tests/shop.spec.ts --trace off      E2E 일부만 (먼저 npm run build)
```
- **E2E는 `vite preview`로 빌드 결과를 쓴다.** 코드를 고치고 `npm run build` 안 하면 옛 화면을 테스트한다.
- E2E를 오래 돌리는 중에는 단위 테스트의 `collision.test`(무작위 스윕)가 시간 초과로 실패할 수 있다. 그 파일만 따로 돌려 통과하면 부하 때문이다.
- 화면 확인: Playwright로 1280×800 스크린샷을 찍는다. 온라인 화면은 `?fakeonline`(가짜 계정·길드·파티·전적), 전투 내부는 `?qa`(`window.__fgBattle`).

## 4. 배포
- push하면 GitHub Pages가 자동 배포된다. `server/`·`src/data/`·`src/game/` 변경은 Fly 서버(`fightguys-evnbin`, 도쿄)도 자동 배포(`deploy-server.yml`).
- 서버 JSON 저장소(`.data/`)는 커밋하지 않는다.

## 5. 현재 상태 (2026-11 기준)
- 캐릭터 10종: RIVET, VOLLEY, BOULDER, HINAKO, FUSE, SHARD, GRIZZLE, PRISM, **REAPER**, **FISTER**(REAPER·FISTER는 암살자형).
- 스킨: SAKURA HINAKO(서사), TRUE FORM REAPER(전설). 둘 다 사용자가 준 glb.
- 모드: 연습장, TEAM FIGHT, 크리스탈 러시, FIGHTER BALL. 맵 3개(blossom-arena, frost-hollow, meadow-pitch).
- 계정/경제: 코인·다이아, 파이터 상자, 상점, 시즌 패스, 길드, 파티, 전적, 랭크·랭킹, 관리자(`mineack991`).
- **할 일:**
  - FISTER 전설 스킨: 모델(glb)과 이펙트 이미지를 사용자가 줄 예정. 받으면 REAPER와 같은 방식으로 넣는다.
  - 남의 스킨 초상화: 서버가 상대가 입은 스킨을 화면에 안 보내서 방·결과·랭킹의 남 칸은 기본 모습이다(필요하면 서버+프로토콜 수정).
  - 이펙트 이미지 자리: REAPER 돌진 잔상·궁극기 탄·적중은 연결됨. FISTER는 아직 없음.
  - REAPER·FISTER 수치는 첫 안이라 플레이 테스트로 조정.

## 6. 모델 한계에 대비한 습관
- 한 번에 크게 바꾸지 말고 작게 고치고 바로 `npm run check`.
- 파일을 고치기 전에 **먼저 읽는다.** 비슷한 기존 코드(예: `tests/unit/game/hinako.test.ts`, `src/data/fighters.ts`의 다른 캐릭터)를 찾아 같은 형태로 쓴다.
- 확신이 없는 수치·동작은 추측해서 넣지 말고 사용자에게 묻는다.
- 테스트가 실패하면 테스트를 지우거나 건너뛰지 않는다. 원인을 고치거나, 규칙이 바뀐 거라면 테스트를 새 규칙에 맞게 고친다.

## 7. FreeLLMAPI로 `claude` 세션 열기
FreeLLMAPI(<https://github.com/tashfeenahmed/freellmapi>)는 무료 LLM 제공자 여러 곳을 한 주소로 묶어 주는 게이트웨이다. 저장소 문서 기준:

1. 게이트웨이 설치·실행(Docker 필요): `curl -fsSL https://freellmapi.co/install.sh | bash` → <http://localhost:3001> → Keys 페이지에서 제공자 키를 넣고, 맨 위의 **통합 키**(`freellmapi-…`)를 복사.
2. Keys → Anthropic 탭에서 `opus`/`sonnet`/`haiku`/`default`를 어떤 모델로 보낼지 정한다(`auto` 가능).
3. 이 저장소 폴더에서:
```
export ANTHROPIC_BASE_URL=http://localhost:3001      # /v1을 붙이지 않는다(루트 주소)
export ANTHROPIC_AUTH_TOKEN=<통합 키>                # ANTHROPIC_API_KEY가 아니다
export CLAUDE_CODE_AUTO_MODE_SERVER=0
claude
```
또는 `npx freellmapi setup-claude --url http://localhost:3001 --api-key <통합 키>`.
- **통합 키는 이 저장소 안에 적지 않는다**(셸 환경 변수나 `~/.claude` 쪽에만).
- 무료 모델은 코딩 품질·도구 호출 안정성이 Claude보다 낮고, 하루 한도가 차면 품질이 떨어진다. 그래서 위 §0·§6을 더 엄격히 지킨다. 어려운 작업(netcode, sim 결정성)은 Claude로 하고, 데이터·문서·UI 다듬기·테스트 보강에 무료 모델을 쓰는 것을 권한다.
- 클라우드(웹) 세션에서 쓰려면 게이트웨이가 인터넷에서 닿아야 한다(로컬 `localhost`는 안 된다). 그 경우 별도 서버에 올리고 HTTPS 주소를 `ANTHROPIC_BASE_URL`로 쓴다.
