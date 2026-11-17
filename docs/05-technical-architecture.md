# 05 Technical Architecture

## 대상 기기
- **Samsung Galaxy Tab S9 FE+** (12.4", 2560×1600, 16:10, 90Hz, Exynos 1380). 모든 플레이어가 같은 기기.
- 외부 앱(APK) 설치 불가 → **웹 게임 + PWA**(크롬 "홈 화면에 추가"로 앱처럼 전체화면·가로 고정 실행).

## 기술 스택
| 영역 | 선택 |
|---|---|
| 언어 | TypeScript |
| 빌드 | Vite |
| 3D | Three.js (WebGL2) |
| UI | DOM + CSS (캔버스 위에 겹침) |
| PWA | vite-plugin-pwa (Workbox, 오프라인 캐시) |
| 서버(3단계) | Node.js + Colyseus(서버 권위형), 게임 로직 코드는 클라이언트와 공유 |
| 배포 | GitHub Pages (GitHub Actions) |

## 폴더 구조
```
src/
  config.ts            게임 이름·버전·설계 해상도 (이름은 여기 한 곳만 바꾼다)
  main.ts              부팅: 폰트·초상화 로딩, 화면 생성
  core/                DOM 도우미, 화면 크기 맞춤, 화면 전환, 기기(전체화면)
  audio/               효과음
  data/                캐릭터 등 게임 데이터 (UI·렌더링·로직이 모두 읽음)
  state/               프로필·설정 (지금은 localStorage)
  render/              Three.js: 렌더러(Stage), 재질, 캐릭터 모델, 장면(View)
  ui/                  화면(screens), 팝업(overlays), 공용 위젯, 아이콘
  game/                (2단계) 순수 게임 로직. DOM·Three.js를 import하지 않는다 → 서버에서도 실행
server/                (3단계) 게임 서버
docs/                  설계 문서
```

## 핵심 구조
- **렌더러 하나**(`Stage`)를 앱 전체가 공유하고, 화면마다 `View`(장면+카메라)만 바꿔 끼운다.
- **UI는 DOM**: 1280×800 설계 좌표로 만들고 `transform: scale()`로 맞춘다. 화면 비율이 다르면 무대가 늘어나서 모서리 요소는 실제 화면 모서리에 붙는다.
- **데이터 기반 캐릭터**: 새 캐릭터 = `FIGHTERS`에 항목 추가 + 모델 빌더 1개.
- **로직/표현 분리(2단계부터 필수)**: `src/game/`은 결정적(같은 입력 → 같은 결과) 순수 함수로 작성. 서버가 진짜 상태를 계산하고, 클라이언트는 같은 코드로 예측만 한다.

## 네트워크 계획 (3단계)
- 서버 권위형: 클라이언트는 입력(이동 방향, 공격 방향, 틱 번호)만 보낸다.
- 서버 30틱/초 시뮬레이션, 상태 20회/초 전송, 클라이언트 보간 + 내 캐릭터 예측·보정.
- 호스팅 후보: 한국에서 가까운 지역(도쿄/서울)이 있는 서비스. 무료 요금제는 잠자기·지연 한계가 있음.

## 성능 예산 (S9 FE+ 기준)
| 항목 | 목표 |
|---|---|
| 프레임 | 로비 60fps 이상, 전투 60fps 유지 |
| 픽셀 비율 | HIGH = min(기기, 2), LOW = 1 (설정에서 전환) |
| 그림자 | 그림자 맵 대신 원형 그림자(blob) |
| 드로우콜 | 전투 화면 150 이하 목표 |
| 다운로드 | 첫 실행 5MB 이하, 이후 오프라인 캐시 |

## 데이터 저장
- 1단계: 기기 localStorage (`fg.profile.v1`, `fg.settings.v1`).
- 4단계: 로그인 후 서버 저장으로 이전.

## 배포
- 저장소 기본 브랜치에 푸시하면 GitHub Actions가 빌드해서 GitHub Pages에 올린다(`.github/workflows/deploy.yml`).
- 저장소 Settings → Pages → Source를 **GitHub Actions**로 한 번 설정해야 한다.
- 빌드 시 `BASE_PATH=/<저장소이름>/`.

## 에이전트 분업
역할 정의는 `.claude/agents/`에 있다. 각 역할은 담당 폴더만 수정하고, 공용 인터페이스(`src/data/`, `src/game/` 타입) 변경은 Lead가 결정한다.

| 역할 | 담당 |
|---|---|
| Lead (메인 세션) | 아키텍처, 업무 분배, 통합, `src/core`, `src/data` 스키마 |
| Gameplay | `src/game/` 전투·이동·캐릭터 로직, `src/data/fighters.ts` 수치 |
| Network | `server/`, 동기화, 매칭 |
| World | 맵 데이터·충돌·환경, `src/render/` 맵 렌더링 |
| UI | `src/ui/`, `src/styles/`, HUD |
| QA | `tests/`, 테스트 실행, 회귀 검증 보고 |
