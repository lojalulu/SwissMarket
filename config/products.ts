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


/** Gera a configuração de um iPhone. baseGB = capacidade base (títulos sem capacidade contam como base). */
function iphone(
  gen: number, variant: '' | 'pro' | 'pro max' | 'plus', baseGB: 128 | 256,
  priceFloor: number, priceCeil: number, extra: Partial<ProductConfig> = {},
): ProductConfig {
  const suffix = variant ? ` ${variant.replace(/\b\w/g, (c) => c.toUpperCase())}` : '';
  const variantInclude: string[][] = variant === 'pro' ? [['pro']] : variant === 'pro max' ? [['pro'], ['max']] : variant === 'plus' ? [['plus']] : [];
  const variantExclude = variant === 'pro' ? ['max', 'mini', 'plus'] : variant === 'pro max' ? ['mini', 'plus'] : variant === 'plus' ? ['pro', 'max', 'mini'] : ['pro', 'max', 'mini', 'plus'];
  const bigger = baseGB === 128 ? ['256', '512', '1 tb'] : ['512', '1 tb'];
  return {
    id: `iphone-${gen}${variant ? '-' + variant.replace(' ', '-') : ''}`,
    name: `iPhone ${gen}${suffix} ${baseGB}GB`,
    category: 'smartphone',
    searchTerm: `iphone ${gen}${variant ? ' ' + variant : ''}`,
    mustInclude: [['iphone', 'i phone'], [String(gen)], ...variantInclude],
    exclude: [...variantExclude, ...bigger, 'hulle', 'huelle', 'case', 'cover', 'panzerglas', 'schutzglas', 'folie', 'ladekabel', 'kamera schutz'],
    priceFloor, priceCeil, feeRate: 0.10,
    ...extra,
  };
}

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

  // iPhones mais caros = mais margem em CHF por negócio. A liquidez real vai aparecer no painel.
  iphone(13, 'pro', 128, 200, 800),
  iphone(13, 'pro max', 128, 250, 900),
  iphone(14, 'pro', 128, 300, 1000),
  iphone(14, 'pro max', 128, 350, 1100),
  iphone(15, '', 128, 300, 900),
  iphone(15, 'pro', 128, 450, 1150),
  iphone(15, 'pro max', 256, 550, 1300),
  iphone(16, '', 128, 450, 1000),
  iphone(16, 'pro', 128, 600, 1400),
  iphone(16, 'pro max', 256, 700, 1600),
  iphone(17, 'pro', 256, 800, 1700),
  iphone(17, 'pro max', 256, 900, 1900),
  {
    id: 'galaxy-s24-ultra', name: 'Samsung Galaxy S24 Ultra', category: 'smartphone',
    searchTerm: 'galaxy s24 ultra',
    mustInclude: [['s 24', 's24'], ['ultra']],
    exclude: ['hulle', 'huelle', 'case', 'cover', 'glas', 'folie', 's 25', 's 23', 'ladekabel', 'pen only', 'nur s pen'],
    priceFloor: 350, priceCeil: 1100, feeRate: 0.10,
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

  {
    id: 'airpods-pro-3', name: 'AirPods Pro 3', category: 'electronics',
    searchTerm: 'airpods pro 3',
    mustInclude: [['airpods', 'air pods'], ['pro'], ['3', '3 gen', '3rd']],
    exclude: ['case only', 'nur case', 'ladecase', 'ladeetui', 'nur etui', 'einzeln', 'links', 'rechts', 'left', 'right', 'hulle', 'huelle', 'max', 'pro 2'],
    priceFloor: 120, priceCeil: 320, feeRate: 0.12,
  },
  {
    id: 'sony-wh1000xm5', name: 'Sony WH-1000XM5', category: 'electronics',
    searchTerm: 'sony wh-1000xm5',
    mustInclude: [['sony'], ['xm 5']],
    exclude: ['xm 4', 'xm 6', 'ohrpolster', 'polster', 'etui', 'case', 'kabel', 'ear pads'],
    priceFloor: 100, priceCeil: 380, feeRate: 0.12,
  },
  {
    id: 'apple-watch-ultra-2', name: 'Apple Watch Ultra 2', category: 'electronics',
    searchTerm: 'apple watch ultra 2',
    mustInclude: [['watch'], ['ultra'], ['2']],
    exclude: ['armband', 'band', 'strap', 'loop', 'hulle', 'huelle', 'case', 'cover', 'schutz', 'glas', 'ladekabel', 'ladegerat', 'ultra 3'],
    priceFloor: 300, priceCeil: 900, feeRate: 0.12,
  },
  {
    id: 'dyson-airwrap', name: 'Dyson Airwrap', category: 'electronics',
    searchTerm: 'dyson airwrap',
    mustInclude: [['dyson'], ['airwrap']],
    exclude: ['aufsatz', 'aufsatze', 'duse', 'buerste', 'burste', 'nur', 'halter', 'stander', 'etui', 'ersatz', 'kabel'],
    priceFloor: 200, priceCeil: 700, feeRate: 0.12,
  },

  // ─────────────── Consolas ───────────────
  {
    id: 'switch-2', name: 'Nintendo Switch 2', category: 'gaming',
    searchTerm: 'nintendo switch 2',
    mustInclude: [['switch 2', 'switch2']],
    exclude: ['oled', 'lite', 'hulle', 'huelle', 'case', 'tasche', 'schutzfolie', 'dock only', 'nur dock', 'joy con only', 'grip', 'spiel', 'game key card'],
    priceFloor: 250, priceCeil: 650, feeRate: 0.12,
  },
  {
    id: 'ps5-pro', name: 'PlayStation 5 Pro', category: 'gaming',
    searchTerm: 'playstation 5 pro',
    extraSearchTerms: ['ps5 pro'],
    mustInclude: [['playstation 5', 'ps 5', 'ps5', 'playstation5'], ['pro']],
    exclude: ['controller', 'dualsense', 'portal', 'vr', 'cover', 'faceplate', 'ladestation', 'headset', 'laufwerk only', 'nur laufwerk'],
    priceFloor: 450, priceCeil: 950, feeRate: 0.12,
  },
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
