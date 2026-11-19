# 4단계 계획: 로그인·계정

아이디+비밀번호 계정. 계정 정보(이름, 트로피, 레벨, 재화, 선택 캐릭터)는 Fly.io 게임 서버에 저장한다.

## 흐름
- 타이틀에서 TAP TO START → 저장된 토큰이 있으면 자동 로그인 → 로비.
- 토큰이 없거나 만료면 로그인 / 회원가입 화면(아이디, 비밀번호, 비밀번호 확인).
- 서버에 닿지 않으면 "오프라인으로 계속"(연습장만, 진행도는 기기에 임시 저장 후 다음 로그인 때 합치지 않고 버린다 — 단순하게).
- 설정에 로그아웃. 로비 프로필 카드에 계정 이름.
- TEAM FIGHT: 로그인한 계정으로 방에 들어간다(이름 = 계정 이름). 경기가 끝나면 서버가 트로피를 반영(승 +8, 무 0, 패 −4, 0 아래로는 안 내려감, 캐릭터별)하고 코인 +20(승) / +10(그 외).

## 계약 (Lead)
- HTTP(JSON), 게임 서버와 같은 주소(https://…/api/…):
  - `POST /api/signup {username, password}` → `{ token, profile }`
  - `POST /api/login {username, password}` → `{ token, profile }`
  - `GET /api/me` (Authorization: Bearer) → `{ profile }`
  - `PUT /api/profile` (Bearer) `{ selected }` → `{ profile }` (클라이언트가 바꿀 수 있는 건 선택 캐릭터뿐, 트로피·재화는 서버만)
  - `POST /api/logout` (Bearer)
  - 오류: `{ error: 'bad_credentials' | 'username_taken' | 'invalid_username' | 'weak_password' | 'unauthorized' | 'rate_limited' }`
- 아이디: 3~12자, 영문·숫자·한글·밑줄, 대소문자 구분 없이 중복 금지. 비밀번호: 6자 이상.
- `profile`은 `src/state/profile.ts`의 `Profile`과 같은 모양(name = 아이디, tag는 서버가 발급).
- 웹소켓 `hello`에 `token?: string` 추가(프로토콜 v2). 토큰이 있으면 계정 이름을 쓰고 경기 결과를 그 계정에 반영. 토큰이 없으면 게스트(진행도 반영 없음).

## Network — `server/`, `src/net/` (protocol.ts는 hello에 token 추가만), `tests/unit/net/`
1. 저장: Fly 볼륨(`/data`)의 JSON 파일(원자적 쓰기: 임시 파일 → rename). 볼륨이 없으면(로컬) `./.data/`.
2. 비밀번호: `crypto.scrypt` + 사용자별 salt, `timingSafeEqual`. 토큰: 무작위 32바이트, 서버에 해시로 저장, 30일 만료.
3. 같은 IP에서 로그인 실패 연속 시 제한(rate_limited).
4. CORS: 게임 페이지 주소(GitHub Pages)와 localhost 허용.
5. 경기 결과 반영(트로피·코인) + 테스트.
6. 클라이언트 `src/net/account.ts`: `signup`, `login`, `logout`, `restore()`(저장된 토큰으로 /api/me), `updateSelected`, 현재 계정 구독. 토큰은 localStorage(`fg.auth.v1`, try/catch).
7. `fly.toml`에 볼륨 마운트(`[mounts] source="fg_data" destination="/data"`) — Lead가 볼륨을 만든다.

## UI — `src/ui/`, `src/styles/`, `src/state/profile.ts`
1. 타이틀 이후 로그인/가입 화면(오리지널 디자인, 태블릿 키보드 대응, 입력 칸은 화면 위쪽), 오류 메시지 한국어+영어 짧게.
2. 로그인되면 `state/profile.ts`가 서버 프로필을 쓰고 화면 갱신, 선택 캐릭터 변경은 `account.updateSelected`로 서버에 저장.
3. 설정에 계정 이름 + 로그아웃. 온라인 화면의 이름 입력칸은 로그인 시 숨김.
