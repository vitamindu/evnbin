/**
 * 파이터 상자(보상 상자). 서버가 연다(클라이언트는 결과만 받는다). DOM·Three.js import 금지.
 *
 * 1) 아이템 개수: ITEM_COUNT_ODDS(%) — 3개 50, 4개 25, 5개 15, 6개 5, 7개 3, 8개 1.4, 9개 0.5, 10개 0.1
 * 2) 아이템마다 종류: 코인 85% / 보석(다이아) 15%
 *    - 코인: 100~1000, 10 단위. 적은 값일수록 잘 나온다(가중치 (92 - k)², k = (코인 - 100) / 10)
 *      → 100~190 약 29%, 100~490 약 82%, 900~1000 약 0.25%. 평균 약 326
 *    - 보석: 9~20개. 적은 값일수록 잘 나온다(가중치 21 - 개수) → 9개 약 15%, 20개 약 1.3%. 평균 약 12.7
 * 3) 얻는 방법: 온라인 경기 승리 +1(서버 accounts.ts). 관리자 계정은 무한
 * 내용물은 이후 추가 예정(캐릭터·스킨 등) — BoxItem.kind를 늘린다.
 */
export const BOX_NAME = '파이터 상자';

/** [아이템 개수, 확률(%)] — 합계 100 */
export const ITEM_COUNT_ODDS: readonly (readonly [number, number])[] = [
  [3, 50],
  [4, 25],
  [5, 15],
  [6, 5],
  [7, 3],
  [8, 1.4],
  [9, 0.5],
  [10, 0.1],
];

export const COIN_CHANCE = 0.85;
export const COIN_MIN = 100;
export const COIN_MAX = 1000;
export const COIN_STEP = 10;
export const GEM_MIN = 9;
export const GEM_MAX = 20;

export type BoxItem = { kind: 'coins'; amount: number } | { kind: 'gems'; amount: number };

const COIN_TABLE: readonly (readonly [number, number])[] = Array.from({ length: (COIN_MAX - COIN_MIN) / COIN_STEP + 1 }, (_, k) => [
  COIN_MIN + k * COIN_STEP,
  (92 - k) ** 2,
]);
const GEM_TABLE: readonly (readonly [number, number])[] = Array.from({ length: GEM_MAX - GEM_MIN + 1 }, (_, i) => [GEM_MIN + i, 21 - (GEM_MIN + i)]);

/** 가중치 표에서 하나 뽑기. rand: [0, 1) */
export function pickWeighted<T>(table: readonly (readonly [T, number])[], rand: () => number): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r < 0) return v;
  }
  return table[table.length - 1]![0];
}

/** 상자 하나 열기. 결과는 코인 먼저, 그다음 보석, 각각 큰 값부터 정렬 */
export function rollFighterBox(rand: () => number): BoxItem[] {
  const n = pickWeighted(ITEM_COUNT_ODDS, rand);
  const items: BoxItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push(rand() < COIN_CHANCE ? { kind: 'coins', amount: pickWeighted(COIN_TABLE, rand) } : { kind: 'gems', amount: pickWeighted(GEM_TABLE, rand) });
  }
  return items.sort((a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind === 'coins' ? -1 : 1));
}

/** 받은 아이템 합계 */
export function boxTotals(items: readonly BoxItem[]): { coins: number; gems: number } {
  let coins = 0;
  let gems = 0;
  for (const it of items) {
    if (it.kind === 'coins') coins += it.amount;
    else gems += it.amount;
  }
  return { coins, gems };
}
