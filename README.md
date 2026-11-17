# FIGHT GUYS (임시 이름)

탑다운 3대3 팀 슈터 장르의 오리지널 웹 게임 프로토타입. Galaxy Tab S9 FE+ 가로 화면에 맞춰 만든다.

- 현재 버전: **v0.1.0** — 타이틀, 로비, 캐릭터 3종(RIVET · VOLLEY · BOULDER) 선택
- 설계 문서: [`docs/`](docs/README.md)

## 실행
```bash
npm install
npm run dev      # 같은 와이파이의 태블릿에서 http://<PC IP>:5173 으로 접속
npm run build    # dist/ 생성
npm run preview  # 빌드 결과 확인
```

## 태블릿에 설치하기 (APK 없이)
1. 태블릿 크롬에서 배포 주소(GitHub Pages)를 연다.
2. 오른쪽 위 메뉴(⋮) → **홈 화면에 추가** → 설치.
3. 홈 화면 아이콘으로 실행하면 주소창 없이 가로 전체화면으로 열린다. 한 번 열면 오프라인에서도 실행된다.

## GitHub Pages 배포 설정 (한 번만)
1. 저장소를 Public으로 전환.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. 기본 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 빌드·배포한다. 주소: `https://<사용자>.github.io/<저장소>/`
