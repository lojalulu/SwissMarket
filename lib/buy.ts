// lib/buy.ts — lado da COMPRA: anúncios do Tutti/Anibis comparados com o preço de revenda no Ricardo.
//
// Para cada anúncio relevante:
//   custo real   = preço pedido + viagem (ida e volta de carro, ou só o desvio se for no caminho do trabalho)
//   "comprar já" = custo ≤ "comprar até" do Ricardo
//   "negociar"   = preço até 25 % acima → propor (comprar até − viagem); em classificados negociar é normal
//   lucro        = líquido da revenda no Ricardo (depois da comissão) − preço pago − viagem
import { getAuctionModel } from './auction-model';
import { activeProducts, getProduct, type ProductConfig } from '../config/products';
import { type BuySource, type ClassifiedSeller, sellerTrust } from './classifieds';
import { estimateDrive, maxDriveMin, osrmDrive, travelCost, type DriveInfo } from './geo';
import { computeProductStats, type ProductStats } from './stats';
import { effectiveRecords, runsFor, withDb } from './store';
import { checkRelevance, findDefect } from './text';
import type { BuyDetailResult, BuyIngestPayload, BuyRecord } from './types';

const DAY = 864e5;
const env = (k: string) => (process.env[k] ?? '').trim();
const floor5 = (n: number) => Math.floor(n / 5) * 5;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function enabledBuySources(): BuySource[] {
  return (env('BUY_SOURCES') || 'tutti').split(',').map((s) => s.trim()).filter((s): s is BuySource => s === 'tutti' || s === 'anibis');
}

// ───────────────────────────── tempos de carro (cache) ─────────────────────────────

export function driveFor(zip: string | null): DriveInfo | null {
  if (!zip) return null;
  const cached = withDb((db) => db.geo?.[zip]);
  if (cached) return cached;
  return estimateDrive(zip);
}

/** Pede ao OSRM os tempos reais dos códigos postais ainda sem cache (máx. `max`, ~1 pedido/s). */
export async function refineDrives(zips: string[], max = 8, budgetMs = 10_000): Promise<number> {
  const todo = [...new Set(zips)].filter((z) => z && !withDb((db) => db.geo?.[z]?.via === 'osrm')).slice(0, max);
  const until = Date.now() + budgetMs;
  let done = 0;
  for (const z of todo) {
    if (Date.now() > until) break;
    const d = await osrmDrive(z, Math.min(6000, until - Date.now()));
    if (!d) break; // OSRM indisponível → fica a estimativa (tenta de novo noutra altura)
    withDb((db) => { (db.geo ??= {})[z] = { ...d, at: new Date().toISOString() }; }, true);
    done++;
    await new Promise((r) => setTimeout(r, 1100));
  }
  return done;
}

// ───────────────────────────── ingest ─────────────────────────────

const bkey = (source: string, productId: string, id: string) => `${source}:${productId}:${id}`;

function priceReason(price: number | null, p: ProductConfig): string | undefined {
  if (price === null) return 'sem preço';
  // Abaixo de metade do piso = quase sempre acessório/peça; acima do teto = outro modelo/bundle.
  if (price < p.priceFloor * 0.5) return `preço muito baixo (${price}) — provável acessório`;
  if (price > p.priceCeil) return `acima do teto (${price})`;
  return undefined;
}

export interface BuyIngestResult {
  received: number;
  relevant: number;
  new: number;
  rejected: { reason: string; count: number }[];
}

export function ingestBuy(payload: BuyIngestPayload, now = new Date()): BuyIngestResult {
  const p = getProduct(payload.productId);
  if (!p) throw new Error(`Produto desconhecido: ${payload.productId}`);
  const iso = now.toISOString();
  let relevant = 0, fresh = 0;
  const reasons = new Map<string, number>();
  withDb((db) => {
    db.buy ??= {};
    for (const it of payload.items) {
      if (!it?.id || !/^\d{5,}$/.test(String(it.id)) || !it.title) continue;
      const rel = checkRelevance(it.title, it.url ?? '', p);
      const defect = findDefect(`${it.title} ${it.description ?? ''}`);
      const reason = !rel.relevant ? rel.reason : defect ? `defeito: ${defect}` : priceReason(it.price, p);
      if (reason) { const b = reason.replace(/\s*\(.*$/, '').replace(/:.*/, ''); reasons.set(b, (reasons.get(b) ?? 0) + 1); }
      else relevant++;
      const k = bkey(payload.source, p.id, it.id);
      const prev = db.buy[k];
      if (!prev) {
        fresh++;
        db.buy[k] = {
          ...it, source: payload.source, productId: p.id, relevant: !reason, rejectReason: reason,
          firstSeen: iso, lastSeen: iso, seenCount: 1, status: 'active',
          priceHistory: [{ at: iso, price: it.price }], seller: it.sellerName ? { name: it.sellerName, memberSince: null, company: null, verified: null, listings: null } : null,
          sellerCheckedAt: null,
        };
      } else {
        if (prev.price !== it.price) prev.priceHistory = [...prev.priceHistory, { at: iso, price: it.price }].slice(-10);
        Object.assign(prev, {
          title: it.title, url: it.url || prev.url, price: it.price,
          zip: it.zip ?? prev.zip, place: it.place ?? prev.place, postedAt: it.postedAt ?? prev.postedAt,
          image: it.image ?? prev.image, description: it.description ?? prev.description,
          relevant: !reason, rejectReason: reason, lastSeen: iso, seenCount: prev.seenCount + 1, status: 'active',
        });
      }
    }
    // Limpeza: anúncios não vistos há 14 dias saem.
    for (const [k, r] of Object.entries(db.buy)) if (now.getTime() - Date.parse(r.lastSeen) > 14 * DAY) delete db.buy[k];
  }, true);
  return {
    received: payload.items.length, relevant, new: fresh,
    rejected: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

export function applyBuyDetails(results: BuyDetailResult[], now = new Date()) {
  const iso = now.toISOString();
  const out = { applied: 0, gone: 0, failed: 0 };
  withDb((db) => {
    for (const r of results) {
      for (const rec of Object.values(db.buy ?? {})) {
        if (rec.source !== r.source || rec.id !== r.id) continue;
        out.applied++;
        rec.sellerCheckedAt = iso;
        if (r.failed || !r.detail) { rec.sellerCheckFailed = true; out.failed++; continue; }
        rec.sellerCheckFailed = false;
        if (r.detail.active === false) { rec.status = 'gone'; out.gone++; continue; }
        // Runner ≥ v3.5 envia sempre o campo "defect" (mesmo null) → descrição completa verificada.
        if ('defect' in r.detail) rec.defectChecked = true;
        if (r.detail.defect) { rec.defect = r.detail.defect; rec.relevant = false; rec.rejectReason = `defeito: ${r.detail.defect}`; }
        const s = r.detail.seller;
        if (s && (s.name || s.memberSince)) rec.seller = { ...(rec.seller ?? {}), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null)) } as ClassifiedSeller;
        rec.zip ??= r.detail.zip;
        rec.place ??= r.detail.place;
      }
    }
  }, true);
  return out;
}

// ───────────────────────────── oportunidades ─────────────────────────────

export interface BuyDeal {
  key: string;
  source: BuySource;
  id: string;
  productId: string;
  productName: string;
  title: string;
  url: string;
  image: string | null;
  price: number;
  zip: string | null;
  place: string | null;
  postedAt: string | null;
  firstSeen: string;
  status: 'active' | 'gone';
  drive: DriveInfo | null;
  /** Custo da viagem (CHF) e se compensa fazer no caminho do trabalho. */
  travel: { chf: number; mode: 'caminho' | 'ida' } | null;
  withinRadius: boolean;
  onRoute: boolean;
  maxBuy: number;
  resale: number;
  basis: ProductStats['pricing']['basis'];
  confidence: ProductStats['pricing']['confidence'];
  liquidity: { label: ProductStats['liquidity']['label']; score: number | null };
  /** comprar = já compensa · negociar = propor `offer` · nao = não compensa (só na avaliação manual). */
  kind: 'comprar' | 'negociar' | 'nao';
  /** Proposta sugerida (negociar) — já descontada a viagem. */
  offer: number | null;
  /** Lucro estimado (CHF) comprando ao preço pedido (comprar) ou à proposta (negociar), já sem viagem. */
  profit: number;
  roiPct: number;
  suspicious: boolean;
  seller: ClassifiedSeller | null;
  trust: 'visivel' | 'parcial' | 'desconhecido';
  sellerChecked: boolean;
  score: number;
}

export type Evaluation = Omit<BuyDeal, 'key' | 'source' | 'id' | 'productId' | 'productName' | 'title' | 'url' | 'image' | 'postedAt' | 'firstSeen' | 'status' | 'seller' | 'trust' | 'sellerChecked'> & { verdict: string };

/** Calcula a oportunidade de UM anúncio face às estatísticas do Ricardo desse produto. */
export function evaluateListing(
  input: { price: number; zip: string | null; place?: string | null },
  stats: ProductStats,
): Evaluation | null {
  const rec = stats.pricing.recommended;
  if (!rec?.maxBuy || !stats.pricing.resaleQuick) return null;
  const drive = driveFor(input.zip);
  const travel = drive ? travelCost(drive) : null;
  const tc = travel?.chf ?? 0;
  const maxBuy = rec.maxBuy;
  const within = !!drive && drive.minutes <= maxDriveMin();
  const onRoute = !!drive && drive.detourMin !== null && drive.detourMin <= 12;
  let kind: BuyDeal['kind'] = 'nao';
  let offer: number | null = null;
  if (input.price + tc <= maxBuy) kind = 'comprar';
  else if (input.price <= maxBuy * 1.25) {
    offer = floor5(maxBuy - tc);
    if (offer >= input.price * 0.75 && offer > 0) kind = 'negociar';
  }
  const paid = kind === 'negociar' ? offer! : input.price;
  const profit = r2(rec.net - paid - tc);
  const roiPct = Math.round((profit / Math.max(paid + tc, 1)) * 100);
  const median = stats.pricing.resaleMedian ?? stats.pricing.resaleQuick;
  const suspicious = input.price < median * 0.45;
  const confBonus = stats.pricing.confidence === 'alta' ? 12 : stats.pricing.confidence === 'media' ? 6 : 0;
  const score = Math.round(Math.max(0, Math.min(100,
    Math.min(Math.max(roiPct, 0), 80) * 0.6 + (stats.liquidity.score ?? 30) * 0.3 + confBonus + (onRoute ? 6 : 0) - (kind === 'negociar' ? 8 : 0))) * (suspicious ? 0.4 : 1));
  const placeName = input.place?.trim() || drive?.place || null;
  const where = drive ? `${placeName} · ${drive.minutes} min de carro${onRoute ? ` (no caminho, +${drive.detourMin} min)` : ''}` : 'local desconhecido';
  const verdict = kind === 'comprar'
    ? `Compre: lucro ≈ CHF ${Math.round(profit)} depois da viagem (CHF ${tc}). ${where}.`
    : kind === 'negociar'
      ? `Negocie: proponha CHF ${offer} (pedem ${input.price}). A esse preço o lucro é ≈ CHF ${Math.round(profit)}. ${where}.`
      : `Não compensa: para lucrar tem de pagar no máximo CHF ${Math.max(0, floor5(maxBuy - tc))} (pedem ${input.price}). ${where}.`;
  return {
    price: input.price, zip: input.zip, place: placeName,
    drive, travel, withinRadius: within, onRoute, maxBuy, resale: stats.pricing.resaleQuick,
    basis: stats.pricing.basis, confidence: stats.pricing.confidence,
    liquidity: { label: stats.liquidity.label, score: stats.liquidity.score },
    kind, offer, profit, roiPct, suspicious, score, verdict,
  };
}

const statsCache = new Map<string, { at: number; s: ProductStats }>();
export function productStats(productId: string, now = new Date()): ProductStats | null {
  const p = getProduct(productId);
  if (!p) return null;
  const c = statsCache.get(productId);
  if (c && now.getTime() - c.at < 60e3) return c.s;
  const s = computeProductStats(p, effectiveRecords(p.id), runsFor(p.id), now, 30, getAuctionModel(now));
  statsCache.set(productId, { at: now.getTime(), s });
  return s;
}

/** Todas as oportunidades atuais (ou só as de um produto). */
export function buyDeals(opts: { productId?: string; includeGone?: boolean; maxAgeDays?: number } = {}, now = new Date()): BuyDeal[] {
  const recs = withDb((db) => Object.entries(db.buy ?? {}));
  const out: BuyDeal[] = [];
  const maxAge = (opts.maxAgeDays ?? 3) * DAY;
  for (const [key, r] of recs) {
    if (!r.relevant || r.price === null) continue;
    if (opts.productId && r.productId !== opts.productId) continue;
    if (r.status === 'gone' && !opts.includeGone) continue;
    if (now.getTime() - Date.parse(r.lastSeen) > maxAge) continue;
    // Regras de título atuais também para anúncios já guardados (ex.: novos termos excluídos).
    const prod = getProduct(r.productId);
    if (!prod || !checkRelevance(r.title, r.url, prod).relevant) continue;
    if (r.defect || findDefect(`${r.title} ${r.description ?? ''}`)) continue;
    const stats = productStats(r.productId, now);
    if (!stats) continue;
    const ev = evaluateListing({ price: r.price, zip: r.zip, place: r.place }, stats);
    if (!ev || ev.kind === 'nao') continue;
    out.push({
      ...ev, key, source: r.source, id: r.id, productId: r.productId, productName: stats.name,
      title: r.title, url: r.url, image: r.image ?? null, postedAt: r.postedAt, firstSeen: r.firstSeen, status: r.status,
      seller: r.seller ?? null, trust: sellerTrust(r.seller), sellerChecked: !!r.sellerCheckedAt && !r.sellerCheckFailed,
    });
  }
  return out.sort((a, b) => Number(b.withinRadius) - Number(a.withinRadius) || b.score - a.score);
}

/** Oportunidades que ainda precisam de ver o perfil do vendedor (o runner abre o anúncio). */
export function needSellerCheck(source: BuySource, productId: string, max = 6, now = new Date()) {
  return buyDeals({ productId }, now)
    .filter((d) => d.source === source && d.withinRadius && !d.suspicious)
    // Abre de novo os anúncios verificados antes do filtro de defeitos (sem descrição completa lida).
    .filter((d) => withDb((db) => { const r = db.buy?.[d.key]; return !r?.sellerCheckedAt || !r.defectChecked; }))
    .slice(0, max)
    .map((d) => ({ source: d.source, id: d.id, url: d.url, productId: d.productId }));
}

/** Produtos que vale a pena procurar no Tutti/Anibis (já têm "comprar até" no Ricardo). */
export function buyTargets(now = new Date()) {
  return activeProducts()
    .map((p) => ({ p, s: productStats(p.id, now) }))
    .filter(({ s }) => s?.pricing.recommended?.maxBuy)
    .map(({ p, s }) => ({ id: p.id, name: p.name, terms: [p.searchTerm], maxBuy: s!.pricing.recommended!.maxBuy }));
}

/** Avaliação manual (Facebook Marketplace ou qualquer anúncio colado): tenta descobrir o produto pelo título. */
export function evaluateManual(input: { title: string; price: number; place?: string | null; zip?: string | null; productId?: string | null }, now = new Date()) {
  const candidates = input.productId
    ? [getProduct(input.productId)].filter((p): p is ProductConfig => !!p)
    : activeProducts().filter((p) => checkRelevance(input.title, '', p).relevant);
  // Mais específico primeiro (ex.: "iPhone 15 Pro Max" antes de "iPhone 15 Pro").
  candidates.sort((a, b) => b.mustInclude.flat().join(' ').length - a.mustInclude.flat().join(' ').length);
  return candidates.slice(0, 3).map((p) => {
    const s = productStats(p.id, now);
    const ev = s ? evaluateListing({ price: input.price, zip: input.zip ?? null, place: input.place }, s) : null;
    return { productId: p.id, productName: p.name, stats: s ? { basis: s.pricing.basis, confidence: s.pricing.confidence, sold: s.sold.n } : null, result: ev };
  });
}

export const buyKey = bkey;
export const _test = { priceReason };
export type { BuyRecord };
