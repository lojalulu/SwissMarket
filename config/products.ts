// config/products.ts
// Lista de produtos monitorizados no Ricardo.ch.
//
// Como funciona o filtro de relevância (lib/text.ts):
//   • O título do anúncio é normalizado: minúsculas, sem acentos, e letras/números
//     separados ("iPhone13 128GB" → "iphone 13 128 gb").
//   • mustInclude: lista de GRUPOS. Todos os grupos têm de bater; dentro de um grupo
//     basta UMA alternativa. Ex.: [['iphone'], ['13'], ['128 gb','128gb']]
//   • exclude: se QUALQUER termo aparecer, o anúncio é descartado (modelos vizinhos,
//     acessórios, peças). Soma-se à lista global DEFAULT_EXCLUDE.
//   • priceFloor / priceCeil: faixa de sanidade. Abaixo do piso quase sempre é
//     acessório, capa, caixa vazia ou lance inicial de CHF 1.
//
// feeRate = Erfolgsprovision do Ricardo (help.ricardo.ch, 2026):
//   Smartphones 10 % · Eletrónica/PC/Gaming 12 % · Moda 12 % · teto CHF 290 por venda.
//
// Para adicionar um produto: copie um bloco, mude id/searchTerm/mustInclude e os limites.
// O id NUNCA deve mudar depois de ter histórico (é a chave na base de dados).

export type Category = 'smartphone' | 'electronics' | 'gaming' | 'drone' | 'bag';

export interface ProductConfig {
  id: string;
  name: string;
  category: Category;
  /** Termo exato usado na URL https://www.ricardo.ch/de/s/<termo>/ */
  searchTerm: string;
  /** Termos extra pesquisados no mesmo ciclo (mais anúncios sem usar paginação). */
  extraSearchTerms?: string[];
  mustInclude: string[][];
  exclude?: string[];
  priceFloor: number;
  priceCeil: number;
  /** Comissão Ricardo (0.10 = 10 %). */
  feeRate: number;
  /** Custos por venda que ficam contigo: embalagem, portes se ofereceres envio grátis, etc. */
  extraCostCHF?: number;
  /** Margem mínima desejada sobre o preço de compra (0.20 = 20 %). */
  targetMargin?: number;
  /** Lucro mínimo absoluto por negócio em CHF. */
  minProfitCHF?: number;
  enabled?: boolean;
}

export const DEFAULTS = {
  extraCostCHF: 5,
  targetMargin: 0.2,
  minProfitCHF: 40,
  feeCapCHF: 290,
};

/** Termos que quase sempre indicam anúncio que não é o produto em si, ou produto com problema. */
export const DEFAULT_EXCLUDE = [
  'defekt', 'defect', 'kaputt', 'ersatzteil', 'ersatzteile', 'bastler', 'bastlerware',
  'gesperrt', 'icloud lock', 'blockiert', 'attrappe', 'dummy', 'replika', 'replica', 'fake',
  'imitat', 'nur box', 'nur ovp', 'leere', 'leer ovp', 'suche', 'gesucht', 'tausche',
  'display schaden', 'wasserschaden', 'für teile', 'pour pieces', 'pezzi di ricambio',
];

const IPHONE_EXCLUDE = ['pro', 'max', 'mini', 'plus', 'hulle', 'huelle', 'case', 'cover', 'panzerglas', 'schutzglas', 'folie', 'ladekabel'];
const MACBOOK_EXCLUDE = ['pro', 'm1 pro', 'm1 max', 'ipad', 'hulle', 'case', 'sleeve', 'tasche', 'netzteil', 'ladegerat', 'tastatur', 'keyboard', 'akku', 'battery'];

export const MONITORED_PRODUCTS: ProductConfig[] = [
  // ─────────────── Smartphones ───────────────
  {
    id: 'iphone-13', name: 'iPhone 13 128GB', category: 'smartphone',
    searchTerm: 'iphone 13 128gb',
    // 128 GB é a capacidade base: títulos sem capacidade contam; 256/512 são excluídos.
    mustInclude: [['iphone', 'i phone'], ['13']],
    exclude: [...IPHONE_EXCLUDE, '256', '512', '64'],
    priceFloor: 150, priceCeil: 700, feeRate: 0.10,
  },
  {
    id: 'iphone-14', name: 'iPhone 14 128GB', category: 'smartphone',
    searchTerm: 'iphone 14 128gb',
    mustInclude: [['iphone', 'i phone'], ['14']],
    exclude: [...IPHONE_EXCLUDE, '256', '512'],
    priceFloor: 200, priceCeil: 850, feeRate: 0.10,
  },

  // ─────────────── Portáteis ───────────────
  {
    id: 'macbook-air-m1', name: 'MacBook Air M1', category: 'electronics',
    searchTerm: 'macbook air m1',
    mustInclude: [['macbook'], ['air'], ['m 1', 'm1']],
    exclude: [...MACBOOK_EXCLUDE, 'm 2', 'm 3', 'm 4'],
    priceFloor: 250, priceCeil: 1100, feeRate: 0.12,
  },
  {
    id: 'macbook-air-m2', name: 'MacBook Air M2 13"', category: 'electronics',
    searchTerm: 'macbook air m2',
    mustInclude: [['macbook'], ['air'], ['m 2', 'm2']],
    exclude: [...MACBOOK_EXCLUDE, 'm 1', 'm 3', 'm 4', '15'],
    priceFloor: 400, priceCeil: 1400, feeRate: 0.12,
  },

  // ─────────────── Áudio ───────────────
  {
    id: 'airpods-pro-2', name: 'AirPods Pro 2', category: 'electronics',
    searchTerm: 'airpods pro 2',
    mustInclude: [['airpods', 'air pods'], ['pro'], ['2', '2 gen', '2nd', 'usb c']],
    exclude: ['case only', 'nur case', 'ladecase', 'ladeetui', 'nur etui', 'einzeln', 'links', 'rechts', 'left', 'right', 'hulle', 'huelle', 'max', 'pro 3'],
    priceFloor: 80, priceCeil: 280, feeRate: 0.12,
  },

  // ─────────────── Consolas ───────────────
  {
    id: 'ps5', name: 'PlayStation 5 (Disc)', category: 'gaming',
    searchTerm: 'playstation 5 konsole',
    extraSearchTerms: ['ps5 konsole'],
    mustInclude: [['playstation 5', 'ps 5', 'ps5', 'playstation5']],
    exclude: ['digital', 'controller only', 'nur controller', 'cover', 'faceplate', 'ladestation', 'headset', 'pro', 'portal', 'vr'],
    priceFloor: 200, priceCeil: 650, feeRate: 0.12,
  },
  {
    id: 'switch-oled', name: 'Nintendo Switch OLED', category: 'gaming',
    searchTerm: 'nintendo switch oled',
    mustInclude: [['switch'], ['oled']],
    exclude: ['hulle', 'huelle', 'case', 'tasche', 'schutzfolie', 'dock only', 'nur dock', 'lite', 'switch 2', 'joy con only'],
    priceFloor: 150, priceCeil: 450, feeRate: 0.12,
  },
  {
    id: 'steam-deck', name: 'Steam Deck', category: 'gaming',
    searchTerm: 'steam deck',
    mustInclude: [['steam deck', 'steamdeck']],
    exclude: ['hulle', 'huelle', 'case', 'tasche', 'dock only', 'nur dock', 'folie', 'skin', 'grip'],
    priceFloor: 200, priceCeil: 750, feeRate: 0.12,
  },

  // ─────────────── Drones ───────────────
  {
    id: 'dji-mini-3-pro', name: 'DJI Mini 3 Pro', category: 'drone',
    searchTerm: 'dji mini 3 pro',
    mustInclude: [['dji'], ['mini'], ['3'], ['pro']],
    exclude: ['akku only', 'nur akku', 'battery only', 'propeller', 'filter', 'tasche', 'mini 4', 'mini 2', 'ersatz'],
    priceFloor: 250, priceCeil: 900, feeRate: 0.12,
  },
  {
    id: 'dji-mini-4-pro', name: 'DJI Mini 4 Pro', category: 'drone',
    searchTerm: 'dji mini 4 pro',
    mustInclude: [['dji'], ['mini'], ['4'], ['pro']],
    exclude: ['akku only', 'nur akku', 'battery only', 'propeller', 'filter', 'tasche', 'mini 3', 'mini 2', 'ersatz'],
    priceFloor: 400, priceCeil: 1300, feeRate: 0.12,
  },

  // ─────────────── Malas de luxo ───────────────
  // Atenção: é a categoria com mais falsificações. Compre só com fatura/código de data verificável.
  {
    id: 'lv-neverfull', name: 'Louis Vuitton Neverfull', category: 'bag',
    searchTerm: 'louis vuitton neverfull',
    mustInclude: [['louis vuitton', 'lv'], ['neverfull']],
    exclude: ['pochette only', 'nur pochette', 'organizer', 'insert', 'einsatz', 'staubbeutel', 'dustbag', 'style', 'art', 'look'],
    priceFloor: 500, priceCeil: 3000, feeRate: 0.12,
  },
  {
    id: 'lv-pochette-metis', name: 'Louis Vuitton Pochette Métis', category: 'bag',
    searchTerm: 'louis vuitton pochette metis',
    mustInclude: [['louis vuitton', 'lv'], ['metis']],
    exclude: ['organizer', 'insert', 'einsatz', 'staubbeutel', 'dustbag', 'style', 'art', 'look'],
    priceFloor: 800, priceCeil: 3500, feeRate: 0.12,
  },
  {
    id: 'lv-speedy', name: 'Louis Vuitton Speedy', category: 'bag',
    searchTerm: 'louis vuitton speedy',
    mustInclude: [['louis vuitton', 'lv'], ['speedy']],
    exclude: ['organizer', 'insert', 'einsatz', 'staubbeutel', 'dustbag', 'style', 'art', 'look', 'nano'],
    priceFloor: 300, priceCeil: 2500, feeRate: 0.12,
  },
  {
    id: 'gucci-marmont', name: 'Gucci GG Marmont', category: 'bag',
    searchTerm: 'gucci marmont',
    mustInclude: [['gucci'], ['marmont']],
    exclude: ['gurtel', 'guertel', 'belt', 'sonnenbrille', 'wallet', 'portemonnaie', 'kartenetui', 'style', 'art', 'look'],
    priceFloor: 400, priceCeil: 2500, feeRate: 0.12,
  },
  {
    id: 'gucci-dionysus', name: 'Gucci Dionysus', category: 'bag',
    searchTerm: 'gucci dionysus',
    mustInclude: [['gucci'], ['dionysus']],
    exclude: ['wallet', 'portemonnaie', 'kartenetui', 'style', 'art', 'look'],
    priceFloor: 400, priceCeil: 2500, feeRate: 0.12,
  },
];

export function getProduct(id: string): ProductConfig | undefined {
  return MONITORED_PRODUCTS.find((p) => p.id === id);
}

export function activeProducts(): ProductConfig[] {
  return MONITORED_PRODUCTS.filter((p) => p.enabled !== false);
}
