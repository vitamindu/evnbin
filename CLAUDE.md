# FIGHT GUYS — 작업 규칙

탑다운 3대3 팀 슈터 장르의 오리지널 웹 게임(이름은 임시, `src/config.ts`의 `GAME_TITLE`). 설계 문서는 `docs/`에 있고, 작업 전에 관련 문서를 먼저 읽는다.

## 반드시 지킬 것
- **오리지널만 만든다.** 다른 게임의 이름·캐릭터·아트·사운드·UI 디자인·고유 명칭을 복제하거나 살짝 바꿔 쓰지 않는다. 장르의 일반 메커니즘은 써도 된다.
- **대상 기기: Galaxy Tab S9 FE+** (2560×1600, 16:10 가로, 90Hz). UI는 1280×800 설계 좌표로 만든다.
- **APK 불가 → 웹 + PWA.** 브라우저 정책(첫 터치 전 소리 불가, 전체화면은 터치 안에서만)을 지킨다.
- **3D(Three.js), 로직은 평면.** 2단계부터 게임 로직은 `src/game/`에 DOM·Three.js 없이 작성한다(서버와 공유).
- 수치를 바꾸면 `docs/`와 `src/data/`를 같이 고친다.

## 명령
- `npm run dev` 개발 서버 / `npm run build` 타입 검사 + 빌드 / `npm run preview` 빌드 결과 확인
- 화면 확인: 뷰포트 1280×800(태블릿 CSS 크기), 터치 활성화한 Chromium으로 스크린샷

## 에이전트 분업
`.claude/agents/`의 역할(gameplay, network, world, ui, qa)을 쓴다. 메인 세션이 Lead로서 분배·통합한다. 각 역할은 `docs/05-technical-architecture.md`의 담당 폴더만 수정한다.
