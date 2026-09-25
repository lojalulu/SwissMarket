// lib/stats.ts — estatística de preços, liquidez e Preço Máximo de Compra.
import { DEFAULTS, type ProductConfig } from '../config/products';
import { searchUrl } from './parse';
import type { ListingRecord, ProductRun } from './types';

// ───────────────────────────── estatística básica ─────────────────────────────

export interface Dist {
  n: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  /** Quantos valores foram descartados como outliers. */
  outliers: number;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Remove outliers por IQR (Tukey, k=1.5). Com menos de 5 valores não remove nada. */
export function removeOutliers(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  if (s.length < 5) return s;
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
  return s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function dist(values: number[]): Dist {
  const clean = removeOutliers(values.filter((v) => Number.isFinite(v) && v > 0));
  if (!clean.length) return { n: 0, mean: null, median: null, p25: null, p75: null, min: null, max: null, outliers: values.length };
  return {
    n: clean.length,
    mean: r2(clean.reduce((a, b) => a + b, 0) / clean.length),
    median: r2(quantile(clean, 0.5)),
    p25: r2(quantile(clean, 0.25)),
    p75: r2(quantile(clean, 0.75)),
    min: clean[0],
    max: clean[clean.length - 1],
    outliers: values.length - clean.length,
  };
}

// ───────────────────────────── Preço Máximo de Compra ─────────────────────────────

export interface PriceBreakdown {
  salePrice: number;
  fee: number;
  extraCost: number;
  net: number;
  maxBuy: number | null;
  profitAtMaxBuy: number | null;
}

/**
 * Preço máximo de compra para um preço de revenda:
 *   líquido  = venda − comissão Ricardo (feeRate, teto CHF 290) − custos extra
 *   maxBuy   = min( líquido / (1 + margem),  líquido − lucro mínimo )   arredondado para baixo a CHF 5
 */
export function maxBuyFor(salePrice: number, p: ProductConfig): PriceBreakdown {
  const fee = Math.min(salePrice * p.feeRate, DEFAULTS.feeCapCHF);
  const extraCost = p.extraCostCHF ?? DEFAULTS.extraCostCHF;
  const net = salePrice - fee - extraCost;
  const margin = p.targetMargin ?? DEFAULTS.targetMargin;
  const minProfit = p.minProfitCHF ?? DEFAULTS.minProfitCHF;
  const raw = Math.min(net / (1 + margin), net - minProfit);
  const maxBuy = raw > 0 ? Math.floor(raw / 5) * 5 : null;
  return {
    salePrice: r2(salePrice),
    fee: r2(fee),
    extraCost,
    net: r2(net),
    maxBuy,
    profitAtMaxBuy: maxBuy === null ? null : r2(net - maxBuy),
  };
}

// ───────────────────────────── estatísticas por produto ─────────────────────────────

export type LiquidityLabel = 'rapido' | 'medio' | 'lento' | 'sem_dados';
export type Confidence = 'alta' | 'media' | 'baixa' | 'nenhuma';

export interface Opportunity {
  id: string;
  title: string;
  url: string;
  mode: ListingRecord['mode'];
  price: number;
  kind: 'buynow' | 'auction';
  bids: number;
  endDate: string | null;
  discountPct: number;
  estProfit: number;
}

export interface ProductStats {
  productId: string;
  name: string;
  category: string;
  searchUrl: string;
  feeRate: number;
  tracking: { firstRun: string | null; lastRun: string | null; daysTracked: number; runs24h: number; lastFound: number; lastRelevant: number };
  counts: { active: number; rejectedActive: number; soldConfirmed: number; soldInferred: number; probableSales: number; endedUnsold: number; pendingCheck: number };
  active: { askingBuyNow: Dist; auctionBids: Dist; auctionsWithBidsPct: number | null; avgBids: number | null; auctions: number };
  sold: Dist;
  liquidity: {
    label: LiquidityLabel;
    score: number | null;
    basis: 'vendas' | 'estimada' | 'sem_dados';
    salesPer30d: number | null;
    sellThroughPct: number | null;
    medianDaysToSell: number | null;
  };
  pricing: {
    basis: 'vendidos' | 'misto' | 'pedidos' | 'sem_dados';
    confidence: Confidence;
    /** Preço de revenda típico (mediana). */
    resaleMedian: number | null;
    /** Preço de revenda para vender RÁPIDO (entre p25 e mediana). */
    resaleQuick: number | null;
    /** Recomendado: calculado sobre resaleQuick. */
    recommended: PriceBreakdown | null;
    /** Teto absoluto: calculado sobre a mediana. */
    ceiling: PriceBreakdown | null;
  };
  opportunities: Opportunity[];
  weekly: { week: string; median: number | null; n: number }[];
  verdict: string;
}

const DAY = 24 * 3600e3;

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export function computeProductStats(
  p: ProductConfig,
  records: ListingRecord[],
  runs: ProductRun[],
  now = new Date(),
  windowDays = 30,
): ProductStats {
  const nowMs = now.getTime();
  const since = nowMs - windowDays * DAY;
  const relevant = records.filter((r) => r.relevant);
  const inBand = (v: number | null | undefined) => typeof v === 'number' && v >= p.priceFloor && v <= p.priceCeil;

  // ── ativos
  const active = relevant.filter((r) => r.status === 'active');
  const lastRunAt = runs.length ? runs.reduce((m, r) => (r.at > m ? r.at : m), runs[0].at) : null;
  // "Ativo agora" = visto na última hora de recolha (os outros podem ter saído da 1ª página).
  const freshCut = lastRunAt ? new Date(lastRunAt).getTime() - 2 * 3600e3 : 0;
  const fresh = active.filter((r) => new Date(r.lastSeen).getTime() >= freshCut);
  const asking = fresh.map((r) => r.buyNowPrice).filter(inBand) as number[];
  const auctions = fresh.filter((r) => r.mode !== 'buynow');
  // Só leilões a menos de 24 h do fim: antes disso o lance atual ainda está muito abaixo do preço final.
  const endsWithin24h = (r: ListingRecord) => !r.endDate || new Date(r.endDate).getTime() - nowMs < DAY;
  const hotBids = auctions.filter((r) => r.bids >= 3 && endsWithin24h(r)).map((r) => r.bidPrice).filter(inBand) as number[];
  const auctionsWithBidsPct = auctions.length >= 3 ? Math.round((auctions.filter((r) => r.bids > 0).length / auctions.length) * 100) : null;
  const avgBids = auctions.length >= 3 ? r2(auctions.reduce((a, r) => a + r.bids, 0) / auctions.length) : null;

  // ── fechados na janela
  const closedInWindow = relevant.filter((r) => r.closedAt && new Date(r.closedAt).getTime() >= since);
  const sold = closedInWindow.filter((r) => r.status === 'sold' && inBand(r.finalPrice));
  const soldConfirmed = sold.filter((r) => r.soldEvidence === 'detail');
  const probable = closedInWindow.filter((r) => r.status === 'gone' && r.mode === 'buynow');
  const endedUnsold = closedInWindow.filter((r) => r.status === 'ended_unsold');
  const soldDist = dist(sold.map((r) => r.finalPrice!));
  const pendingCheck = relevant.filter((r) => r.status === 'active' && r.endDate && new Date(r.endDate).getTime() < nowMs).length;

  // ── tempo de acompanhamento
  const firstRun = runs.length ? runs.reduce((m, r) => (r.at < m ? r.at : m), runs[0].at) : null;
  const daysTracked = firstRun ? Math.max(0, (nowMs - new Date(firstRun).getTime()) / DAY) : 0;
  const runs24h = runs.filter((r) => new Date(r.at).getTime() >= nowMs - DAY).length;

  // ── liquidez
  const effDays = Math.min(windowDays, Math.max(daysTracked, 1));
  const salesCount = sold.length + 0.5 * probable.length;
  const closedCount = sold.length + endedUnsold.length;
  let liquidity: ProductStats['liquidity'];
  if (daysTracked >= 3 && closedCount + probable.length >= 3) {
    const salesPer30d = r2((salesCount / effDays) * 30);
    const sellThrough = closedCount ? Math.round((sold.length / closedCount) * 100) : null;
    const daysToSell = sold.map((r) => (new Date(r.closedAt!).getTime() - new Date(r.startDate ?? r.firstSeen).getTime()) / DAY).filter((d) => d >= 0).sort((a, b) => a - b);
    const medDays = daysToSell.length ? Math.round(quantile(daysToSell, 0.5) * 10) / 10 : null;
    const score = Math.round(
      Math.min(salesPer30d * 2.5, 50) +
      (sellThrough ?? 50) * 0.3 +
      (medDays === null ? 8 : medDays <= 3 ? 20 : medDays <= 7 ? 12 : medDays <= 14 ? 6 : 0),
    );
    liquidity = { label: score >= 65 ? 'rapido' : score >= 40 ? 'medio' : 'lento', score, basis: 'vendas', salesPer30d, sellThroughPct: sellThrough, medianDaysToSell: medDays };
  } else if (auctionsWithBidsPct !== null && avgBids !== null) {
    const score = Math.round(auctionsWithBidsPct * 0.5 + Math.min(avgBids, 10) * 5);
    liquidity = { label: score >= 65 ? 'rapido' : score >= 40 ? 'medio' : 'lento', score, basis: 'estimada', salesPer30d: null, sellThroughPct: null, medianDaysToSell: null };
  } else {
    liquidity = { label: 'sem_dados', score: null, basis: 'sem_dados', salesPer30d: null, sellThroughPct: null, medianDaysToSell: null };
  }

  // ── preço de revenda de referência
  let basis: ProductStats['pricing']['basis'] = 'sem_dados';
  let confidence: Confidence = 'nenhuma';
  let median: number | null = null;
  let quick: number | null = null;
  if (soldDist.n >= 5) {
    basis = 'vendidos';
    confidence = soldDist.n >= 10 ? 'alta' : 'media';
    median = soldDist.median;
    quick = (soldDist.p25! + soldDist.median!) / 2;
  } else if (soldDist.n + hotBids.length >= 3) {
    // Lances atuais subestimam o preço final → mistura com as vendas já registadas.
    const mix = dist([...sold.map((r) => r.finalPrice!), ...hotBids]);
    basis = 'misto';
    confidence = mix.n >= 6 ? 'media' : 'baixa';
    median = mix.median;
    quick = mix.p25 !== null && mix.median !== null ? (mix.p25 + mix.median) / 2 : mix.median;
  } else {
    const ask = dist(asking);
    if (ask.n >= 3) {
      // Preços pedidos ficam acima do preço real de venda → desconto de 10 %.
      basis = 'pedidos';
      confidence = 'baixa';
      median = r2(ask.median! * 0.9);
      quick = r2(ask.p25! * 0.9);
    }
  }
  const recommended = quick ? maxBuyFor(quick, p) : null;
  const ceiling = median ? maxBuyFor(median, p) : null;

  // ── oportunidades ativas agora (abaixo do preço máximo recomendado)
  const opportunities: Opportunity[] = [];
  if (recommended?.maxBuy && median) {
    const limit = recommended.maxBuy;
    for (const r of fresh) {
      if (r.buyNowPrice && r.buyNowPrice <= limit && r.buyNowPrice >= p.priceFloor * 0.6) {
        opportunities.push({
          id: r.id, title: r.title, url: r.url, mode: r.mode, price: r.buyNowPrice, kind: 'buynow', bids: r.bids,
          endDate: r.endDate, discountPct: Math.round((1 - r.buyNowPrice / median) * 100),
          estProfit: r2(recommended.net - r.buyNowPrice),
        });
      }
      const endsSoon = r.endDate && new Date(r.endDate).getTime() - nowMs < 12 * 3600e3 && new Date(r.endDate).getTime() > nowMs;
      const alreadyBuyNow = opportunities.some((o) => o.id === r.id);
      if (r.mode !== 'buynow' && endsSoon && !alreadyBuyNow && r.bidPrice && r.bidPrice <= limit * 0.85) {
        opportunities.push({
          id: r.id, title: r.title, url: r.url, mode: r.mode, price: r.bidPrice, kind: 'auction', bids: r.bids,
          endDate: r.endDate, discountPct: Math.round((1 - r.bidPrice / median) * 100),
          estProfit: r2(recommended.net - r.bidPrice),
        });
      }
    }
    opportunities.sort((a, b) => b.estProfit - a.estProfit);
  }

  // ── série semanal (8 semanas) de preços vendidos
  const byWeek = new Map<string, number[]>();
  for (const r of relevant) {
    if (r.status !== 'sold' || !r.closedAt || !inBand(r.finalPrice)) continue;
    const t = new Date(r.closedAt);
    if (t.getTime() < nowMs - 56 * DAY) continue;
    const k = isoWeek(t);
    byWeek.set(k, [...(byWeek.get(k) ?? []), r.finalPrice!]);
  }
  const weekly = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, median: dist(v).median, n: v.length }));

  // ── veredito em linguagem simples
  let verdict: string;
  if (!recommended?.maxBuy) verdict = 'Ainda sem dados suficientes — deixe o runner recolher mais ciclos.';
  else if (liquidity.label === 'lento') verdict = `Giro lento: só compre muito abaixo de CHF ${recommended.maxBuy}.`;
  else verdict = `Compre até CHF ${recommended.maxBuy} para revender a ~CHF ${Math.round(quick!)} com lucro ≈ CHF ${Math.round(recommended.profitAtMaxBuy!)}.`;
  if (confidence === 'baixa') verdict += ' (Confiança baixa: baseado em poucos dados.)';

  const last = runs.find((r) => r.at === lastRunAt);
  return {
    productId: p.id,
    name: p.name,
    category: p.category,
    searchUrl: searchUrl(p.searchTerm),
    feeRate: p.feeRate,
    tracking: { firstRun, lastRun: lastRunAt, daysTracked: r2(daysTracked), runs24h, lastFound: last?.found ?? 0, lastRelevant: last?.relevant ?? 0 },
    counts: {
      active: fresh.length,
      rejectedActive: records.filter((r) => !r.relevant && r.status === 'active' && new Date(r.lastSeen).getTime() >= freshCut).length,
      soldConfirmed: soldConfirmed.length,
      soldInferred: sold.length - soldConfirmed.length,
      probableSales: probable.length,
      endedUnsold: endedUnsold.length,
      pendingCheck,
    },
    active: { askingBuyNow: dist(asking), auctionBids: dist(hotBids), auctionsWithBidsPct, avgBids, auctions: auctions.length },
    sold: soldDist,
    liquidity,
    pricing: { basis, confidence, resaleMedian: median, resaleQuick: quick === null ? null : r2(quick), recommended, ceiling },
    opportunities: opportunities.slice(0, 15),
    weekly,
    verdict,
  };
}
