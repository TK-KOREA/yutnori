// 팀 색·동물·결과 동물처럼 여러 모듈이 함께 쓰는 값.

/**
 * 팀 색: 명도를 4단계로 나눠 색각 이상이어도 구분되게 했다.
 * shape: 받침·HUD·발자국에 쓰는 팀 모양
 */
export const TEAM_COLORS = [
  { id: 'red', name: '다홍', hex: 0xE14B2F, css: '#D2412A', dark: '#FF6A4D', ink: '#FFFFFF', shape: 'circle', pattern: 'dots' },
  { id: 'blue', name: '쪽빛', hex: 0x2C5ED0, css: '#2C5ED0', dark: '#6E95FF', ink: '#FFFFFF', shape: 'square', pattern: 'grid' },
  { id: 'yellow', name: '노랑', hex: 0xF4B82E, css: '#F4B82E', dark: '#FFCB47', ink: '#2B2118', shape: 'triangle', pattern: 'zigzag' },
  { id: 'teal', name: '청록', hex: 0x13A597, css: '#13A597', dark: '#2FCBB8', ink: '#2B2118', shape: 'star', pattern: 'stars' },
];

export const INK = '#2B2118';

/**
 * 말 캐릭터 8종 — 설빔(팀색 저고리) 입은 동물 친구들.
 * yut: 이 동물이 뜻하는 윷 결과(있으면), zodiac: 띠
 */
export const SPECIES = [
  { id: 'horse', animal: '말', name: '모모', yut: '모', zodiac: '오', intro: '다섯 칸을 달리는 병오년 말', cry: '히힝' },
  { id: 'tiger', animal: '호랑이', name: '어흥이', yut: null, zodiac: '인', intro: '민화 속 까치호랑이', cry: '어흥' },
  { id: 'rabbit', animal: '토끼', name: '옥토', yut: null, zodiac: '묘', intro: '달나라에서 온 깡총 토끼', cry: '뿅' },
  { id: 'pig', animal: '돼지', name: '도야', yut: '도', zodiac: '해', intro: "윷놀이 '도'의 주인공", cry: '꿀꿀' },
  { id: 'dog', animal: '개', name: '복실이', yut: '개', zodiac: '술', intro: '우리 토종 삽살개', cry: '멍멍' },
  { id: 'sheep', animal: '양', name: '몽실이', yut: '걸', zodiac: '미', intro: '몽실몽실 구름 양', cry: '매애' },
  { id: 'cow', animal: '소', name: '누렁이', yut: '윷', zodiac: '축', intro: '딸랑딸랑 워낭 한우', cry: '음매' },
  { id: 'rooster', animal: '닭', name: '꼬꼬', yut: null, zodiac: '유', intro: '새벽을 깨우는 꼬꼬닭', cry: '꼬끼오' },
];
export const speciesById = id => SPECIES.find(s => s.id === id) || SPECIES[0];

/** 윷 결과 → 그 결과가 뜻하는 동물 (도=돼지, 개=개, 걸=양, 윷=소, 모=말) */
export const RESULT_SPECIES = { '-1': 'pig', 1: 'pig', 2: 'dog', 3: 'sheep', 4: 'cow', 5: 'horse' };

/** 한 칸마다 올라가는 5음계(궁상각치우) */
export const STEP_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0];
