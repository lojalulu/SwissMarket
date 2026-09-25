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
  image: string | null;
  mode: ListingRecord['mode'];
  /** buynow = comprar já · auction = leilão a terminar · offer = aceita proposta de preço */
  kind: 'buynow' | 'auction' | 'offer';
  /** Preço atual (Sofort ou lance). */
  price: number;
  shipping: number | null;
  pickup: boolean;
  city: string | null;
  /** Retirada perto de ti (HOME_ZIPS). */
  nearby: boolean;
  /** Preço + portes (0 se retirada perto). */
  cost: number;
  bids: number;
  endDate: string | null;
  minutesLeft: number | null;
  discountPct: number;
  estProfit: number;
  roiPct: number;
  /** Para "offer": valor a propor ao vendedor. */
  offerPrice: number | null;
  /** 0–100: lucro, liquidez, confiança e urgência. */
  score: number;
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
    /** Anúncios ativos ÷ vendas por dia: quantos dias de "estoque" o mercado tem. */
    daysOfSupply: number | null;
  };
  /** Sugestões para quem vai REVENDER. */
  sell: { buyNowPrice: number | null; note: string; bestEndSlots: { slot: string; median: number; n: number }[] };
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

/** Prefixos de código postal considerados "perto" (retirada sem portes). Ex.: HOME_ZIPS=30,31,32,36,38 */
function homeZipPrefixes(): string[] {
  const raw = (typeof process !== 'undefined' && process.env?.HOME_ZIPS) || '30,31,32,33,34,36,37,38';
  return raw.split(',').map((z) => z.trim()).filter(Boolean);
}

/** Mediana do preço final por faixa de dia/hora de fim do leilão (hora de Zurique). */
function endSlots(sold: ListingRecord[]): { slot: string; median: number; n: number }[] {
  if (sold.length < 12) return [];
  const slotOf = (iso: string) => {
    const d = new Date(iso);
    let wd = d.getUTCDay(), h = d.getUTCHours();
    try {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      h = Number(f.find((x) => x.type === 'hour')?.value ?? h);
      wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(f.find((x) => x.type === 'weekday')?.value ?? '');
    } catch { /* sem Intl */ }
    const day = wd === 0 || wd === 6 ? 'fim de semana' : 'dia útil';
    const part = h < 6 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
    return `${day} · ${part}`;
  };
  const groups = new Map<string, number[]>();
  for (const r of sold) {
    if (!r.closedAt || r.finalPrice === null) continue;
    const k = slotOf(r.closedAt);
    groups.set(k, [...(groups.get(k) ?? []), r.finalPrice]);
  }
  return [...groups.entries()].filter(([, v]) => v.length >= 3)
    .map(([slot, v]) => ({ slot, median: dist(v).median!, n: v.length }))
    .sort((a, b) => b.median - a.median);
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
    liquidity = { label: score >= 65 ? 'rapido' : score >= 40 ? 'medio' : 'lento', score, basis: 'vendas', salesPer30d, sellThroughPct: sellThrough, medianDaysToSell: medDays, daysOfSupply: salesPer30d > 0 ? r2(fresh.length / (salesPer30d / 30)) : null };
  } else if (auctionsWithBidsPct !== null && avgBids !== null && auctions.length >= 5) {
    // Estimativa pelos leilões ativos, "encolhida" para 50 quando há poucos leilões (evita 90 com 3 anúncios).
    const raw = auctionsWithBidsPct * 0.5 + Math.min(avgBids, 10) * 5;
    const score = Math.round(50 + (raw - 50) * Math.min(1, auctions.length / 15));
    liquidity = { label: score >= 65 ? 'rapido' : score >= 40 ? 'medio' : 'lento', score, basis: 'estimada', salesPer30d: null, sellThroughPct: null, medianDaysToSell: null, daysOfSupply: null };
  } else {
    liquidity = { label: 'sem_dados', score: null, basis: 'sem_dados', salesPer30d: null, sellThroughPct: null, medianDaysToSell: null, daysOfSupply: null };
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

  // ── oportunidades ativas agora
  const opportunities: Opportunity[] = [];
  if (recommended?.maxBuy && median) {
    const limit = recommended.maxBuy;
    const homeZips = homeZipPrefixes();
    const confBonus = confidence === 'alta' ? 12 : confidence === 'media' ? 6 : 0;
    const make = (r: ListingRecord, kind: Opportunity['kind'], price: number, offerPrice: number | null): Opportunity => {
      const nearby = !!r.pickup && !!r.zip && homeZips.some((z) => r.zip!.startsWith(z));
      const cost = r2(price + (nearby ? 0 : r.shippingCost ?? 0));
      const buyAt = offerPrice ?? cost;
      const profit = r2(recommended.net - buyAt);
      const roi = Math.round((profit / Math.max(buyAt, 1)) * 100);
      const minutesLeft = r.endDate ? Math.round((new Date(r.endDate).getTime() - nowMs) / 60e3) : null;
      const urgency = kind === 'auction' && minutesLeft !== null ? Math.max(0, 15 - minutesLeft / 24) : 0;
      const score = Math.round(Math.max(0, Math.min(100,
        Math.min(roi, 80) * 0.6 + (liquidity.score ?? 30) * 0.3 + confBonus + urgency + (nearby ? 4 : 0))));
      return {
        id: r.id, title: r.title, url: r.url, image: r.image ?? null, mode: r.mode, kind, price,
        shipping: r.shippingCost ?? null, pickup: !!r.pickup, city: r.city ?? null, nearby, cost, bids: r.bids,
        endDate: r.endDate, minutesLeft, discountPct: Math.round((1 - buyAt / median) * 100),
        estProfit: profit, roiPct: roi, offerPrice, score,
      };
    };
    for (const r of fresh) {
      const endMs = r.endDate ? new Date(r.endDate).getTime() : null;
      if (endMs !== null && endMs <= nowMs) continue;
      if (r.buyNowPrice && r.buyNowPrice >= p.priceFloor * 0.6) {
        const o = make(r, 'buynow', r.buyNowPrice, null);
        if (o.cost <= limit) { opportunities.push(o); continue; }
        // Vendedor aceita propostas e o preço está até 25 % acima do teto → propor o teto.
        if (r.canOffer && o.cost <= limit * 1.25) { opportunities.push(make(r, 'offer', r.buyNowPrice, limit)); continue; }
      }
      // Leilão a terminar nas próximas 6 h com lance ainda bem abaixo do teto (margem para subir).
      if (r.mode !== 'buynow' && r.bidPrice && endMs !== null && endMs - nowMs < 6 * 3600e3) {
        const o = make(r, 'auction', r.bidPrice, null);
        if (o.cost <= limit * 0.85) opportunities.push(o);
      }
    }
    opportunities.sort((a, b) => b.score - a.score || b.estProfit - a.estProfit);
  }

  // ── sugestões para revender
  const soldPrices = sold.map((r) => r.finalPrice!).sort((a, b) => a - b);
  const sellBuyNow = soldPrices.length >= 5 ? Math.round(quantile(soldPrices, 0.65))
    : asking.length >= 3 ? Math.round(dist(asking).median!) : null;
  const sellNote = !sellBuyNow ? 'Sem dados suficientes para sugerir preço de venda.'
    : liquidity.label === 'rapido'
      ? `Sofort kaufen a ~CHF ${sellBuyNow}, ou leilão a partir de CHF 1 (10 % de desconto na comissão) — há procura suficiente.`
      : `Sofort kaufen a ~CHF ${sellBuyNow} com "aceita propostas"; evite leilão a CHF 1 (pouca procura).`;
  const bestEndSlots = endSlots(sold.filter((r) => r.soldVia === 'auction'));

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
    sell: { buyNowPrice: sellBuyNow, note: sellNote, bestEndSlots },
    pricing: { basis, confidence, resaleMedian: median, resaleQuick: quick === null ? null : r2(quick), recommended, ceiling },
    opportunities: opportunities.slice(0, 20),
    weekly,
    verdict,
  };
}
