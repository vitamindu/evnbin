# 07 모델링·이펙트 가이드 (새 파이터·스킨 넣는 법)

REAPER(TRUE FORM REAPER)를 넣으면서 실제로 겪은 것들을 적었다. "확인함"은 실제로 돌려 본 것, "미확인"은 아직 눈으로 다 확인하지 못한 것이다.

## 1. 두 가지 모델
| 종류 | 언제 | 어디 |
|---|---|---|
| 기본(primitive) 모델 | 캐릭터 기본 외형. 도형으로 코드에서 만든다 | `src/render/fighterModel.ts`의 `buildXxx` + `BUILDERS` 표 |
| glb 모델 | 사용자가 준 모델. **스킨**으로만 쓴다 | `public/models/*.glb` + `src/data/skins.ts`의 `model` |

- 기본 모델 만드는 법: `buildHumanoid(root, g, 비율, 색)`로 몸·다리·팔을 만들고(`Proportions`), `addEyes`·`part`·`toon`으로 장식을 붙인다. 손(`rig.handR`)에 무기를 붙이고 `rig.armR.rotation`으로 자세를 잡는다. `FighterDef.palette`(primary/secondary/accent/skin/dark)만 써서 색을 정한다. 새 캐릭터는 `BUILDERS`에 등록하지 않으면 RIVET 모델로 나온다.
- 사용자가 준 모델은 기본 외형을 **대체하지 않고** 스킨으로 넣는다(HINAKO, REAPER 모두 그렇게 했다).

## 1-1. 기본 도형 모델 만드는 법 (기술, `src/render/fighterModel.ts`)
좌표: **발바닥 y=0, 정면 +z, 키 약 1.7**. 한 캐릭터 = `buildXxx(def, root, g): Rig` 함수 하나.

1. **비율 정하기**: `Proportions`(torsoW/H/D, headR, headLift, legR/legLen/legX, armR/armLen, shoeH)를 채운다. 기존 값(RIVET 보통, BOULDER 몸통 0.98로 크게, SHARD 머리 0.37로 큼)과 비교해 실루엣이 겹치지 않게 한다. `buildHumanoid(root, g, p, {top, legs, shoes, skin, hands})`가 다리·몸통·머리·팔을 만들고 `Rig`를 돌려준다.
2. **Rig 구조**: 다리는 엉덩이 높이를 축으로 하는 그룹 2개(`legs`, 걸을 때 `rotation.x`로 흔든다). `body` 그룹 안에 `torso`(둥근 상자), `head`(그룹, 중심 y = 몸통 위 + headR×headLift), 팔 피벗 2개(어깨 높이)가 있다. 팔 피벗 아래로 캡슐 팔과 구 모양 손이 매달려 있어서, **무기·장갑은 손(`rig.handR`)이나 `rig.armR`에 붙여야 팔과 같이 움직인다**(REAPER 낫은 `pole.position.copy(rig.handR.position)` 후 `rig.armR.add`).
3. **부품 만들기**: `part(geometry, toon('#색'))`. `part`는 메쉬 뒤집힌 외곽선 메쉬(`smoothed(geo)` + `outlineMat`)를 자식으로 붙인다. 아주 작거나 납작한 장식·발광 부분은 `{ outline: false }`.
   - 빛나는 부분(눈동자, 낫 날, 조준경 렌즈)은 조명을 안 받는 `MeshBasicMaterial`을 쓴다.
   - `toon(색)`은 같은 색이면 **공유·캐시**하므로 재질을 dispose하지 않는다.
   - **모든 지오메트리는 `g.add(new THREE.XxxGeometry(...))`로 감싼다**(`GeoBag`). 안 감싸면 모델을 지울 때 GPU 메모리가 샌다.
4. **얼굴**: `addEyes(rig.head, g, headR, { size, spread, y })`가 구 표면(`onSphere`)에 눈을 붙인다. 머리 장식(두건, 이마 띠, 얼음 가시)은 `rig.head.add`.
5. **자세**: 빌더 안에서 `rig.armR.rotation.set(...)`으로 기본 자세를 잡는다. `buildFighterModel`이 **빌더가 끝난 뒤의 팔 `rotation.x`를 기준 자세로 기억**하고 그 위에 숨쉬기·걷기·반동을 더한다. 그래서 `rotation.y/z`로 잡은 자세는 그대로 유지되고, `rotation.x`는 기준값 근처에서만 흔들린다.
6. **등록**: 파일 아래쪽 `BUILDERS` 표에 `id: buildXxx`. 없으면 RIVET 모델로 나온다.
7. **움직임 조정**: 모든 캐릭터가 같은 애니메이션(`update`)을 쓴다. 캐릭터마다 바꿀 수 있는 건 `IDLE` 표(숨쉬기 속도·폭)와 그림자 크기(`blobShadow`, BOULDER·GRIZZLE만 0.85, 나머지 0.65 — 큰 캐릭터는 이 조건에 추가)뿐이다. 다른 동작이 필요하면 `buildFighterModel`의 `update`를 직접 고친다.
8. **확인**: 캐릭터 목록 카드(초상화), 상세 화면(큰 모델), 전투 화면(작게, `MODEL_SCALE` 0.85)에서 모두 본다. `tests/new-fighters.spec.ts`처럼 Playwright로 목록·상세 스크린샷을 찍는다.

겪은 점: 열린 원뿔(`openEnded`)은 한쪽 면만 보여서 두건·망토는 바깥에서만 제대로 보인다. 몸통에 붙이는 장식은 몸통 크기(`torsoD/2`)만큼 앞으로 빼야 파묻히지 않는다.

## 2. 받은 glb 살펴보기와 줄이기
받은 파일 특징(REAPER 기준, 확인함): 뼈대·애니메이션 없는 **정적 모델**, 34만 정점, 2048×2048 텍스처 3장(baseColor jpeg, normal png, metallicRoughness png), 몸 26MB·무기 9.8MB. 이대로는 웹에서 못 쓴다.

도구(저장소 밖 임시 폴더에 설치): `npm install @gltf-transform/cli@4 sharp`
```
npx gltf-transform inspect  원본.glb                       # 정점 수·텍스처·bbox 확인
# 몸: 정점 4%만 남기고 텍스처 1024, meshopt 압축, webp
npx gltf-transform optimize 몸.glb  out/몸.glb  --compress meshopt --texture-compress webp --texture-size 1024 --simplify true --simplify-ratio 0.04 --simplify-error 0.01
# 무기: 25%만 남기고 텍스처 512
npx gltf-transform optimize 무기.glb out/무기.glb --compress meshopt --texture-compress webp --texture-size 512  --simplify true --simplify-ratio 0.25 --simplify-error 0.005
```
결과(확인함): REAPER 몸 26.27MB→0.53MB, 낫 9.85MB→0.22MB. HINAKO는 0.45MB/0.12MB.
- **meshopt 압축만 쓴다.** 로더(`glbFighter.ts`)가 `MeshoptDecoder`만 연결돼 있다. Draco로 압축하면 안 열린다.
- 줄인 뒤 반드시 눈으로 본다(§4). 비율을 너무 낮추면 가는 뿔·낫 날이 뭉개진다.
- 파일은 `public/models/`에 `이름.glb`로 둔다(영문 소문자, 공백 없음). 몸과 무기는 따로 받는다.

## 3. 게임이 glb를 다루는 방식 (`src/render/glbFighter.ts`)
- **재질을 전부 툰 재질로 바꾼다**(`toToon`): baseColor 텍스처(`map`), `normalMap`, `color`만 쓴다. **metalness/roughness/emissive/정점 색은 버린다.** 그래서 어두운 금속 모델은 평평한 어두운 색으로 보인다. 색은 baseColor 텍스처에 이미 들어 있어야 한다.
- **정규화**(`normalizeBody`): 키가 **1.75**가 되게 크기를 맞추고, 발바닥 y=0, 가운데 x·z=0으로 옮긴다. 모델이 **+z 쪽(정면)을 보고** 있어야 한다. REAPER·HINAKO는 원본이 이미 +z를 봤다(§4 방법으로 확인함). 다르면 `normalizeBody`에서 `rotation.y`를 돌려야 하는데 아직 그런 모델은 없다(미확인).
- **움직임은 절차적이다**: 뼈대가 없어서 몸 전체를 위아래·좌우로 흔든다(숨쉬기, 걸을 때 통통 튀며 뒤뚱, 승리 때 점프+회전). 공격하면 **무기만** 뒤로 튕긴다(반동). 팔다리는 따로 안 움직인다.
- **로딩**: 부팅 때 `preloadGlbFighters()`가 모든 스킨의 glb를 미리 받는다. 스킨을 하나 추가하면 **부팅 다운로드가 그만큼 늘어난다**(그래서 줄이기가 중요). 아직 못 받았으면 임시 캡슐을 보여 주다가 받는 즉시 바꿔 끼운다. 캐시 키는 몸 glb 경로다.
- **E2E 테스트 `T-33`**(`tests/phase2.spec.ts`)가 부팅 때 받는 glb 파일 목록을 정확히 비교한다. **스킨을 추가하면 이 목록도 고친다.**
- 모델 크기는 판정과 무관하다. 몸 판정 반지름은 `src/game/rules.ts`(`FIGHTER_RADIUS_BY_ID`)에서 따로 정한다. 전투 화면에서는 `MODEL_SCALE`(0.85)이 한 번 더 곱해진다.

## 4. 눈으로 확인하는 방법 (확인함)
1. 최소한의 three.js 페이지를 만든다: importmap으로 `three`와 `three/addons/`를 가리키고, `GLTFLoader`+`MeshoptDecoder`로 glb를 읽어 **yaw 0, 90°, 180°** 세 개를 나란히 세우고 카메라는 +z에서 원점을 본다. 가장 왼쪽(yaw 0) 모델이 카메라를 마주 보면 정면이 +z다.
2. `python3 -m http.server`로 그 폴더를 열고 Playwright로 스크린샷을 찍는다.
3. 저장소 안에 두지 말고 임시 폴더에서 한다(커밋 금지).

## 5. 무기 쥐기 (`weaponFit`)
`SkinDef.model.weaponFit`이 없으면 **HINAKO 총 기준**(x축으로 긴 무기, 총구가 -x, 총구를 비스듬히 위·앞으로)이다. 낫·창처럼 **세로로 선 무기**는 지정한다:
```ts
weaponFit: { axis: 'y', length: 1.7, grip: -0.15, hand: [-0.42, 0.85, 0.12], rot: [0.15, 0, 0.12] }
```
- `axis`: 원본에서 무기가 길게 놓인 축. `length`: 길이(키 1.75 기준). `grip`: 손으로 쥘 위치(-1 아래 끝 ~ 1 위 끝). `hand`: 손 위치(발바닥 y=0, +z 정면). `rot`: 쥔 자세(라디안).
- 원본의 **날이 -x 쪽**으로 굽어 있다고 보고 `rotation.y = 90°`로 돌려 날이 **정면(+z)** 을 향하게 한다. 날이 반대쪽이면 `rot[1]`에 π를 더한다.
- REAPER 값은 처음 잡은 값이다. **손에 딱 맞게 쥐였는지는 연습장의 작은 화면에서만 봤고 클로즈업으로는 확인하지 못했다(미확인).** 어색하면 `hand`·`grip`·`rot`부터 조정한다.

## 6. 초상화
- `src/render/thumbnails.ts`가 부팅 때 파이터와 **스킨마다** 384px 초상화를 한 번 그려 둔다(`ctx.portraits`, `ctx.skinPortraits`). 카메라 위치(0.2, 1.35, 3.6)·시선(0,1.08,0)·몸 회전 -0.35가 모두 같다.
- 모델이 넓거나(망토) 크면 카드에서 옆이 잘린다. REAPER 카드는 망토 끝이 살짝 잘렸다(허용). 크게 거슬리면 모델별 카메라 값을 따로 두는 식으로 고친다(아직 없음).
- 화면에서 초상화는 `ui/portraits.ts`의 `portraitSrc`/`myPortraitSrc`로 고른다(입은 스킨 기준). 방·경기 결과·랭킹에서 다른 사람의 장착 스킨도 서버가 전달한다.

## 7. 스킨 데이터 (`src/data/skins.ts`)
- 필수: `id`(소문자_밑줄), `fighterId`, `name`, `price`(`RARITY_PRICE[rarity]`), `rarity`('epic' 서사 100다이아 / 'legendary' 전설 1000다이아), `model`.
- 전설은 `effects`로 이펙트까지 바꾼다. 스킨 id는 계정에 저장되므로 **한 번 정하면 바꾸지 않는다.**
- 추가하면 같이 고칠 것: 상점(자동), 시즌 패스 보상(필요 시), `tests/unit/net/skins.test.ts`(자동), E2E `shop.spec.ts`의 카드 수, `T-33`의 glb 목록, `docs/01-core-mechanics.md`의 스킨 절.
- 관리자 계정은 모든 스킨을 가진다. 테스트에서 특정 스킨을 입히려면 localStorage 프로필을 `{ selected, skins: [id], skinSel: { 캐릭터: id } }`로 심는다(`tests/new-fighters.spec.ts` 참고).

## 8. 이펙트 이미지 (`SkinEffects`)
사용자가 준 이미지(붉은색·검은색)를 이렇게 처리했다(확인함):
1. 가장자리 투명 여백을 자른다(알파 > 8의 bbox).
2. 너무 크면 줄인다(잔상 768px 폭, 나머지 ≤256px).
3. **R 채널 밝기를 흑백으로** 만들고(×1.15) 알파는 그대로 둔다. → 게임에서 팀 색을 곱하므로 **원본 색을 쓰면 안 된다**(탄환 색 규칙: 우리 파랑, 상대 빨강).
4. `public/effects/<캐릭터>/` 아래에 저장한다.

그리는 방식(`src/render/battle/battleView.ts`):
- 재질 `color`에 팀 색 ×1.6을 곱한다(흰 부분이 밝은 팀 색이 된다). 어두운 원본은 어두운 파랑/빨강이 된다. 어두운 바닥에서 안 보이면 이미지를 더 밝게 다시 변환한다.
- **`depthTest: false`**: 수풀·벽에 가려지지 않게 항상 위에 그린다. 안 하면 수풀 속 탄이 안 보였다.
- `trail`: **기본/궁극기가 `dash` 종류일 때만** 출발점에서 `range` 길이로 깔고 0.7초 동안 사라진다.
- `superShot`: 궁극기 탄을 이 이미지의 판(바닥과 나란)으로 그린다. 크기는 탄 판정 반지름(`projectileRadius`)에 맞춰 커진다.
- `hit`: 맞은 자리에서 솟는 이미지(카메라를 보는 스프라이트, 0.4초). 쏜 사람의 스킨 기준이다.
- Chainer 스킨용 칸: `chain`(모든 사슬을 이미지로, `ChainSprite`가 길이만큼 이어 붙임 — 사슬은 가로로 눕힌 이미지, 왼쪽이 시작), `whirl`(패시브 소용돌이 고리, 정사각), `wave`(W 충격파, 아래쪽 끝이 중심), `blast`(Q 폭발, 정사각). 사슬이 비스듬한 이미지는 알파 주성분 방향으로 눕혀서 자른다(`CRIMSON CHAINER` 때 한 방식).
- **`attackShot`, `superCast`는 타입만 있고 아직 그리지 않는다.** 필요하면 `battleView.ts`에서 `skinFx()`를 읽어 연결한다.
- `hit` 이펙트를 실제 전투에서 눈으로 본 적은 아직 없다(연결과 요청 성공만 확인, 미확인).

## 9. 새 파이터를 넣는 순서 (체크리스트)
1. `src/data/fighters.ts`: `FighterId`·`Role`(필요 시)·항목. `docs/01-core-mechanics.md`의 캐릭터 표를 같이 고친다.
2. `src/ui/widgets.ts`의 `ROLE_ICON`(역할 아이콘)과 `accountApi.ts`의 오프라인 기본 진행도(현재 하드코딩 목록이라 **직접 추가**해야 한다).
3. 새 공격 종류가 필요하면 `src/game/sim.ts`(`shotSpec`)와 단위 테스트.
4. 기본 모델 빌더 + `BUILDERS` 등록.
5. 캐릭터 목록 화면은 6열 2줄(최대 12장)이다. 그보다 늘어나면 `.fighter-grid` 레이아웃을 다시 잡는다.
6. 테스트: 단위 테스트, `tests/phase1.spec.ts`의 캐릭터 수·이름 순서·상세 화면 화살표 순서, `npm run check`.
7. 화면 스크린샷으로 목록·상세·전투를 직접 본다.
