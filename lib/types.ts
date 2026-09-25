// lib/types.ts — tipos partilhados entre o runner (Termux) e a API (VPS).

export type SaleMode = 'auction' | 'buynow' | 'hybrid';

/** Anúncio lido de uma página de pesquisa do Ricardo (antes do filtro de relevância). */
export interface ScrapedListing {
  id: string;
  title: string;
  url: string;
  mode: SaleMode;
  /** Lance atual (leilão/híbrido). */
  bidPrice: number | null;
  /** Preço "Sofort kaufen" (compra imediata). */
  buyNowPrice: number | null;
  bids: number;
  /** ISO 8601, quando conhecido. */
  endDate: string | null;
  condition: string | null;
  /** De onde veio o dado: next-data | json-ld | html */
  source: string;
}

/** Sinais lidos na página de um anúncio (a decisão final é feita em lib/store.ts). */
export interface DetailSignals {
  id: string;
  /** 404/410 ou redirecionado para fora do anúncio. */
  removed: boolean;
  /** true = terminou · false = ainda ativo · null = não deu para saber */
  ended: boolean | null;
  /** Texto/flag explícito de "vendido". */
  soldMarker: boolean;
  bids: number | null;
  currentPrice: number | null;
  buyNowPrice: number | null;
  condition: string | null;
  endDate: string | null;
}

/** Corpo do POST /api/ingest (enviado pelo runner). */
export interface IngestPayload {
  productId: string;
  searchTerm: string;
  scrapedAt: string;
  items: ScrapedListing[];
  /** true se a página foi lida por completo (usado para detetar anúncios que desapareceram). */
  complete: boolean;
  runnerVersion?: string;
}

export type ListingStatus = 'active' | 'sold' | 'ended_unsold' | 'gone';

/** Registo persistido na VPS. */
export interface ListingRecord {
  id: string;
  productId: string;
  title: string;
  url: string;
  mode: SaleMode;
  bidPrice: number | null;
  buyNowPrice: number | null;
  bids: number;
  endDate: string | null;
  condition: string | null;
  relevant: boolean;
  rejectReason?: string;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
  /** Últimos preços observados (máx. 20) — para ver a evolução dos lances. */
  history: { at: string; bid: number | null; buyNow: number | null; bids: number }[];
  status: ListingStatus;
  finalPrice: number | null;
  soldVia: 'auction' | 'buynow' | null;
  /** detail = confirmado na página do anúncio | inferred = deduzido (sumiu/terminou com lances) */
  soldEvidence: 'detail' | 'inferred' | null;
  closedAt: string | null;
  checkAttempts: number;
  lastCheckAt: string | null;
}

export interface ProductRun {
  at: string;
  found: number;
  relevant: number;
  complete: boolean;
}
