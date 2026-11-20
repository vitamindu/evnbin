# 5단계 계획: 크리스탈 러시 · 닉네임 · 친구

## 크리스탈 러시 (오리지널 수치, 온라인 3대3)
- 맵: BLOSSOM ARENA 가운데 'C'(크리스탈 생성 지점). 경기 시작 3초 뒤부터 7초마다 1개 생성(바닥에 최대 10개).
- 크리스탈에 닿으면 줍는다(들고 있는 수 `fighter.crystals`). 쓰러지면 들고 있던 크리스탈을 그 자리 주변에 흩뿌린다(다른 사람이 주울 수 있음).
- 팀 합계 10개 이상이고 상대보다 많으면 12초 카운트다운. 그 상태가 끝까지 유지되면 승리. 조건이 깨지면 카운트다운 취소(`countdown` 사건, team null).
- 시간 제한 3분. 끝나면 크리스탈이 많은 팀 승리, 같으면 무승부.
- 쓰러뜨려도 점수는 없음(score는 크리스탈 합계를 담는다). 부활 3초.
- 봇: 크리스탈을 줍고, 많이 들었으면 조심하고, 적 운반자를 노린다.

## 계약 (Lead)
- `src/game/types.ts`: `MatchMode`에 'crystal', `Crystal`, `SimView.crystals`, `Fighter.crystals?`, `MatchState.crystals?/countdownTicks?/countdownTeam?`, 사건 `crystalSpawn/crystalPickup/crystalDrop/countdown`.
- `src/game/world/grid.ts`: 'C' 글자, `grid.crystalSpawns`.
- `src/net/protocol.ts`: `Snapshot.crystals`, 클라이언트 `setMode`(방장만, teamfight | crystal).
- 계정: `profile.name` = **닉네임**(화면에 보이는 이름), 로그인은 **아이디**(username). 닉네임 2~10자(한글·영문·숫자·밑줄), 대소문자 구분 없이 중복 금지. 기존 계정은 닉네임 = 아이디(겹치면 뒤에 숫자).
  - `POST /api/signup {username, password, nickname}`; 오류 `nickname_taken`, `invalid_nickname` 추가
  - `PUT /api/nickname {nickname}` → `{ profile }`
  - `GET /api/friends` → `{ friends: [{ nickname, online, rankPoints, inRoom: boolean }] }`
  - `POST /api/friends {nickname}` → 바로 서로 친구. 오류 `not_found`, `already_friends`, `self`
  - `DELETE /api/friends/<nickname>` → 서로 삭제
  - 게임 방의 이름 = 닉네임.

## 담당
- Gameplay: 크리스탈 규칙·봇·테스트.
- Network: 닉네임·친구 API, 저장 이전, setMode, 스냅샷에 crystals, 테스트.
- UI: 가입(닉네임 칸), 설정에서 닉네임 변경, 친구 화면(로비 친구 버튼), 방 화면 모드 선택(방장), 크리스탈 HUD(팀 합계·카운트다운·머리 위 들고 있는 수).
- Lead: 크리스탈·운반 표시 3D, 통합.
