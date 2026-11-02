// 게임 문파 상점 품목과 가격 (문파 엽전). 2026-10-23 문주가 보내 준 상점 스크린샷 기준.
// 창고 가격은 이 값으로 고정됩니다. 게임에서 가격이 바뀌면 여기만 고치면 됩니다.
// cost 가 null 이면 아직 구매할 수 없어 가격을 모르는 품목 (운영진이 직접 입력).

export interface ShopItem {
  name: string;
  category: string;
  icon: string;
  description: string;
  cost: number | null;
}

const skillBox = (style: string): ShopItem => ({
  name: `용맹의 ${style} 도술 조각 선택 상자`,
  category: '도술 조각',
  icon: 'img:skill-select',
  description: `${style} 도술 조각 중 하나를 골라 받는 상자`,
  cost: 4600,
});

export const SHOP_ITEMS: ShopItem[] = [
  ...['강타', '연타', '저격', '결명', '강인', '파멸', '현신'].map(skillBox),
  { name: '용맹의 특별 도술 조각 랜덤 상자', category: '도술 조각', icon: 'img:special-random', description: '특별 도술 조각 하나가 무작위로 나오는 상자', cost: 8000 },
  { name: '용맹의 특별 도술 조각 선택 상자', category: '도술 조각', icon: 'img:special-select', description: '특별 도술 조각 중 하나를 골라 받는 상자', cost: 27500 },
  { name: '희귀 가호의 정수', category: '가호', icon: 'img:rare-essence', description: '가호 강화 재료 (희귀)', cost: 25 },
  { name: '영웅 가호의 정수', category: '가호', icon: 'img:hero-essence', description: '가호 강화 재료 (영웅)', cost: 115 },
  { name: '전설 가호의 정수', category: '가호', icon: 'img:legend-essence', description: '가호 강화 재료 (전설)', cost: 350 },
  { name: '가호 주머니', category: '가호', icon: 'img:pouch', description: '가호를 얻을 수 있는 주머니', cost: 230 },
  { name: '요혼석', category: '소모품', icon: 'img:yohonseok', description: '문파 상점 요혼석', cost: 45 },
  { name: '특급 체력 회복 물약', category: '소모품', icon: 'img:potion', description: '사냥·전장용 특급 체력 회복 물약', cost: 90 },
  { name: '영웅 무기 도안 선택 상자', category: '도안', icon: '📜', description: '영웅 등급 무기 도안 선택 (문파 Lv.7 상품)', cost: null },
  { name: '산척의 방어구 도안 선택 상자', category: '도안', icon: '📜', description: '영웅 등급 방어구 도안 선택 (문파 Lv.7 상품)', cost: null },
  { name: '영웅 장신구 도안 선택 상자', category: '도안', icon: '📜', description: '영웅 등급 장신구 도안 선택 (문파 Lv.7 상품)', cost: null },
  { name: '전설 무기 도안 선택 상자', category: '도안', icon: '🗡️', description: '전설 등급 무기 도안 선택 (문파 Lv.20 상품)', cost: null },
  { name: '산군의 위엄 방어구 도안 선택 상자', category: '도안', icon: '🛡️', description: '전설 등급 방어구 도안 선택 (문파 Lv.20 상품)', cost: null },
  { name: '산군의 어금니 장신구 도안 선택 상자', category: '도안', icon: '💍', description: '전설 등급 장신구 도안 선택 (문파 Lv.20 상품)', cost: null },
];

/** 이름이 문파 상점 품목이고 가격을 알면 그 고정 가격 */
export function fixedPrice(name: string): number | null {
  return SHOP_ITEMS.find((s) => s.name === name.trim())?.cost ?? null;
}
