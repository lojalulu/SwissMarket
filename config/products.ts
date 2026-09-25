export interface ProductConfig {
  id: string;
  name: string;
  searchTerm: string;
  minPrice: number;
  maxPrice: number;
}

export const MONITORED_PRODUCTS: ProductConfig[] = [
  // 10 Electronics
  { id: 'iphone-13', name: 'iPhone 13 128GB', searchTerm: 'iphone 13 128gb', minPrice: 0, maxPrice: 9999 },
  { id: 'iphone-14', name: 'iPhone 14 128GB', searchTerm: 'iphone 14 128gb', minPrice: 0, maxPrice: 9999 },
  { id: 'macbook-air-m1', name: 'MacBook Air M1', searchTerm: 'macbook air m1', minPrice: 0, maxPrice: 9999 },
  { id: 'macbook-air-m2', name: 'MacBook Air M2 13"', searchTerm: 'macbook air m2', minPrice: 0, maxPrice: 9999 },
  { id: 'airpods-pro-2', name: 'AirPods Pro 2', searchTerm: 'airpods pro 2', minPrice: 0, maxPrice: 9999 },
  { id: 'ps5', name: 'PlayStation 5 (Disc)', searchTerm: 'playstation 5 konsole', minPrice: 0, maxPrice: 9999 },
  { id: 'switch-oled', name: 'Nintendo Switch OLED', searchTerm: 'nintendo switch oled', minPrice: 0, maxPrice: 9999 },
  { id: 'steam-deck', name: 'Steam Deck', searchTerm: 'steam deck', minPrice: 0, maxPrice: 9999 },
  { id: 'dji-mini-3-pro', name: 'DJI Mini 3 Pro', searchTerm: 'dji mini 3 pro', minPrice: 0, maxPrice: 9999 },
  { id: 'dji-mini-4-pro', name: 'DJI Mini 4 Pro', searchTerm: 'dji mini 4 pro', minPrice: 0, maxPrice: 9999 },

  // 5 Bags
  { id: 'lv-neverfull', name: 'Louis Vuitton Neverfull', searchTerm: 'louis vuitton neverfull', minPrice: 0, maxPrice: 99999 },
  { id: 'lv-pochette-metis', name: 'Louis Vuitton Pochette Métis', searchTerm: 'louis vuitton pochette metis', minPrice: 0, maxPrice: 99999 },
  { id: 'lv-speedy', name: 'Louis Vuitton Speedy', searchTerm: 'louis vuitton speedy', minPrice: 0, maxPrice: 99999 },
  { id: 'gucci-marmont', name: 'Gucci GG Marmont', searchTerm: 'gucci marmont', minPrice: 0, maxPrice: 99999 },
  { id: 'gucci-dionysus', name: 'Gucci Dionysus', searchTerm: 'gucci dionysus', minPrice: 0, maxPrice: 99999 },
];
