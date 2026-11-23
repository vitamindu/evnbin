import { SKINS, type SkinDef } from './skins';

/**
 * 상점 상품. 서버가 이 표로 값을 매기고 보상을 준다(server/accounts.ts buyShopItem). DOM·Three.js import 금지.
 * - 오늘의 선물: 하루 1번 무료(한국 시간 자정에 다시 받을 수 있다)
 * - 파이터 상자: 다이아로 산다(산 상자는 상자 버튼에서 연다)
 * - 코인: 다이아로 산다
 * - 스킨: 다이아(src/data/skins.ts 가격)
 * 관리자 계정은 다이아가 무한이라 가격이 들지 않는다.
 */
export type ShopItem =
  | { id: string; kind: 'daily'; name: string; coins: number; gems: number; boxes: number }
  | { id: string; kind: 'box'; name: string; boxes: number; price: number; tag?: string }
  | { id: string; kind: 'coins'; name: string; coins: number; price: number; tag?: string }
  | { id: string; kind: 'skin'; name: string; skinId: string; price: number };

export const DAILY_GIFT: ShopItem = { id: 'daily', kind: 'daily', name: '오늘의 선물', coins: 100, gems: 0, boxes: 0 };

export const SHOP_ITEMS: readonly ShopItem[] = [
  DAILY_GIFT,
  { id: 'box1', kind: 'box', name: '파이터 상자', boxes: 1, price: 30 },
  { id: 'box10', kind: 'box', name: '파이터 상자 10개', boxes: 10, price: 270, tag: '10% 할인' },
  { id: 'coins1500', kind: 'coins', name: '코인 1,500', coins: 1500, price: 50 },
  { id: 'coins5000', kind: 'coins', name: '코인 5,000', coins: 5000, price: 150, tag: '10% 더' },
  ...SKINS.map((s: SkinDef): ShopItem => ({ id: `skin:${s.id}`, kind: 'skin', name: s.name, skinId: s.id, price: s.price })),
];

export const getShopItem = (id: string): ShopItem | undefined => SHOP_ITEMS.find((i) => i.id === id);

/** 하루 기준(한국 시간) 날짜 문자열 YYYY-MM-DD */
export function shopDay(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}
