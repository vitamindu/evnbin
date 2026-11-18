# FIGHT GUYS 게임 서버

친구끼리 방 코드로 모여 하는 실시간 3대3(TEAM FIGHT) 서버. Node + `ws`, 서버 권위형.
게임 규칙은 `src/game/`(Sim)을 그대로 import해서 돌린다. 메시지 형식은 `src/net/protocol.ts`.

## 실행

```bash
npm run server            # 개발: tsx watch, 포트 8787 (코드 바꾸면 다시 시작)
npm run server:build      # 배포용 번들 → dist-server/index.mjs (ws만 외부 패키지)
npm run server:start      # 번들 실행
curl localhost:8787/health
```

웹 클라이언트는 `npm run dev`로 띄우고, 기본 서버 주소는 `ws://localhost:8787`이다.
같은 와이파이의 태블릿에서 접속하려면 설정의 서버 주소를 `ws://<PC의 IP>:8787`로 바꾼다
(개발 서버 `vite --host`도 같은 IP로 연다). https 페이지에서는 `ws://`가 막히므로 배포 서버는 `wss://`.

| 환경 변수 | 기본 | 설명 |
|---|---|---|
| `PORT` | 8787 | HTTP(`GET /health`)와 웹소켓이 같은 포트 |
| `HOST` | 0.0.0.0 | 바인드 주소 |
| `ALLOWED_ORIGINS` | (모두 허용) | 쉼표 구분 페이지 주소. 예: `https://<user>.github.io` |
| `START_DELAY_MS` | 1500 | START 후 첫 틱까지(모두가 전투 화면을 준비할 시간) |

클라이언트 빌드 시 `VITE_SERVER_URL=wss://game.example.com npm run build`로 기본 서버 주소를 넣는다
(`src/net/config.ts`). 사용자가 설정에서 바꾼 주소는 기기(localStorage `fg.server.v1`)에 저장된다.

## 배포(일반)

웹소켓과 TLS를 지원하는 어느 컨테이너 호스팅이든 된다.

```bash
docker build -t fight-guys-server .
docker run --init -p 8787:8787 -e ALLOWED_ORIGINS=https://<user>.github.io fight-guys-server
```

- **TLS**: 호스팅의 HTTPS 종단(로드밸런서·리버스 프록시)이 `wss://` → 컨테이너 `PORT`의 평문 ws로 넘기게 한다.
  프록시 설정에 웹소켓 업그레이드(`Upgrade`, `Connection` 헤더)와 긴 유휴 시간(60초 이상)을 허용한다.
- **지역**: 한국 사용자는 서울(ap-northeast-2) 또는 도쿄 지역을 고른다. 미국 지역이면 왕복 150ms 이상.
- **인스턴스 1개**: 방 상태가 메모리에 있으므로 수평 확장(여러 대) 하지 않는다. 재시작하면 방이 사라진다.
- **잠자기**: 무료 요금제가 유휴 시 잠드는 호스팅이면 첫 연결이 느리다. UI가 `GET /health`를 먼저 불러 깨울 수 있다.
- **상태 확인**: `GET /health` → `{"ok":true,"protocol":1,"rooms":0,"playing":0,"connections":0,"uptimeSec":12}`.
- 비밀값은 필요 없다. 토큰 등을 이미지나 저장소에 넣지 않는다.

## 구조

| 파일 | 내용 |
|---|---|
| `index.ts` | 진입점(환경 변수, 종료 신호) |
| `app.ts` | HTTP + 웹소켓, 연결·메시지 처리, 방↔경기 연결, 끊김 감지 |
| `rooms.ts` | 방 규칙(코드, 6명, 팀 자동 배정·변경, 방장 위임, 준비, 봇 채우기, 재접속 자리) — 순수 로직 |
| `match.ts` | 경기 한 판: Sim 30틱, 입력 큐, snap(2틱마다, 클라이언트별 ack), 기록, 끝 |
| `inputQueue.ts` | 플레이어별 입력 큐(이동은 틱마다 하나, 공격·궁극기는 1회성으로 보존) |
| `loop.ts` | 드리프트 보정 고정 주기 루프 |
| `bots.ts` | `src/game/bot.ts`의 `botInput` 어댑터(예외 시 가만히) |
| `validate.ts` | 클라이언트 메시지 검사 |

## 동작 요약

- **연결**: `hello`(버전·이름·캐릭터) → `welcome`(playerId). 이후 `create` 또는 `join`.
- **방**: 코드 4글자(I·L·O·U·V 제외), 사람 최대 6명. 사람이 적은 팀으로 자동 배정, `setTeam`으로 변경(팀당 3명).
  방장이 나가거나 끊기면 가장 먼저 들어온, 연결된 사람이 방장. `fillBots`면 팀마다 3명이 되게 봇이 들어간다.
  준비 표시는 참고용(방장은 언제든 시작 가능).
- **재접속**: 연결이 끊기면 클라이언트가 자동으로 다시 연결해 `hello`(방에서의 이름) → `join`(같은 코드)을 보낸다.
  서버는 같은 이름의 자리를 찾아 그 playerId를 이어붙이고 `welcome`(원래 playerId) → `room` → (경기 중이면) `start`를 보낸다.
  경기 중 끊긴 사람의 캐릭터는 봇이 조종한다. 로비에서 20초, 경기 중 모두가 끊긴 채 30초가 지나면 정리한다.
- **경기**: START → 1.5초 뒤 30틱/초. 클라이언트는 틱마다 `input`(seq), 서버는 2틱마다 `snap`
  (그 클라이언트의 ack + 직전 snap 이후 사건). 규칙이 승패를 정하면(또는 안전 상한 5분) `end` → 방은 lobby로.
- **대역폭**: snap은 숫자를 소수 셋째 자리로 줄인 JSON(6명 교전 중 평균 약 3.8KB, 최대 약 7KB),
  permessage-deflate 압축으로 클라이언트당 약 5KB/s 수신, 입력 송신 약 1.6KB/s.
