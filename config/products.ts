export interface ProductRule {
  id: string;
  name: string;
  category: 'eletronicos' | 'bolsas';
  searchTerm: string;
  minPrice: number;
  maxPrice: number;
}

export const MONITORED_PRODUCTS: ProductRule[] = [
  // 📱 Eletrônicos
  { id: 'iphone-13-128gb', name: 'iPhone 13 128GB', category: 'eletronicos', searchTerm: 'iphone 13 128gb', minPrice: 150, maxPrice: 700 },
  { id: 'iphone-14-128gb', name: 'iPhone 14 128GB', category: 'eletronicos', searchTerm: 'iphone 14 128gb', minPrice: 200, maxPrice: 800 },
  { id: 'macbook-air-m1', name: 'MacBook Air M1', category: 'eletronicos', searchTerm: 'macbook air m1', minPrice: 250, maxPrice: 1000 },
  { id: 'macbook-air-m2', name: 'MacBook Air M2 13"', category: 'eletronicos', searchTerm: 'macbook air m2', minPrice: 350, maxPrice: 1300 },
  { id: 'airpods-pro-2', name: 'AirPods Pro 2', category: 'eletronicos', searchTerm: 'airpods pro 2', minPrice: 60, maxPrice: 250 },
  { id: 'ps5-disc', name: 'PlayStation 5 (Disc)', category: 'eletronicos', searchTerm: 'playstation 5 konsole', minPrice: 200, maxPrice: 700 },
  { id: 'nintendo-switch-oled', name: 'Nintendo Switch OLED', category: 'eletronicos', searchTerm: 'nintendo switch oled', minPrice: 120, maxPrice: 450 },
  { id: 'steam-deck', name: 'Steam Deck', category: 'eletronicos', searchTerm: 'steam deck', minPrice: 250, maxPrice: 900 },
  { id: 'dji-mini-3-pro', name: 'DJI Mini 3 Pro', category: 'eletronicos', searchTerm: 'dji mini 3 pro', minPrice: 200, maxPrice: 700 },
  { id: 'dji-mini-4-pro', name: 'DJI Mini 4 Pro', category: 'eletronicos', searchTerm: 'dji mini 4 pro', minPrice: 350, maxPrice: 1100 },

  // 👜 Bolsas
  { id: 'lv-neverfull', name: 'Louis Vuitton Neverfull', category: 'bolsas', searchTerm: 'louis vuitton neverfull', minPrice: 500, maxPrice: 4000 },
  { id: 'lv-pochette-metis', name: 'Louis Vuitton Pochette Métis', category: 'bolsas', searchTerm: 'louis vuitton pochette metis', minPrice: 800, maxPrice: 4000 },
  { id: 'lv-speedy', name: 'Louis Vuitton Speedy', category: 'bolsas', searchTerm: 'louis vuitton speedy', minPrice: 400, maxPrice: 4000 },
  { id: 'gucci-marmont', name: 'Gucci GG Marmont', category: 'bolsas', searchTerm: 'gucci marmont', minPrice: 400, maxPrice: 3500 },
  { id: 'gucci-dionysus', name: 'Gucci Dionysus', category: 'bolsas', searchTerm: 'gucci dionysus', minPrice: 600, maxPrice: 5000 },
];
