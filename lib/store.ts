// lib/store.ts — base de dados em ficheiro JSON na VPS (sem dependências nativas).
// • Um único ficheiro: $DATA_DIR/db.json (por omissão ./data/db.json)
// • Escrita atómica (tmp + rename) → um crash nunca deixa o ficheiro corrompido
// • Singleton em globalThis → todas as rotas do Next.js partilham o mesmo estado em memória
import fs from 'fs';
import path from 'path';
import { getProduct, type ProductConfig } from '../config/products';
import { checkRelevance } from './text';
import type { DetailSignals, IngestPayload, ListingRecord, ProductRun, ScrapedListing } from './types';

interface DB {
  version: 2;
  products: Record<string, { runs: ProductRun[] }>;
  /** chave = `${productId}:${listingId}` (o mesmo anúncio pode aparecer em pesquisas diferentes) */
  listings: Record<string, ListingRecord & { missedRuns?: number }>;
  /** Alertas já enviados (anti-spam): chave → quando e a que preço. */
  alerts?: Record<string, { at: string; price: number }>;
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_RUNS = 400;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const g = globalThis as unknown as { __swissmarketDb?: DB };

function load(): DB {
  if (g.__swissmarketDb) return g.__swissmarketDb;
  let db: DB = { version: 2, products: {}, listings: {} };
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed?.version === 2) db = parsed;
    }
  } catch (e) {
    const bad = `${DB_FILE}.corrupt-${Date.now()}`;
    console.error(`[store] db.json ilegível, guardado como ${bad}`, e);
    try { fs.renameSync(DB_FILE, bad); } catch { /* ignore */ }
  }
  g.__swissmarketDb = db;
  return db;
}

function save(db: DB) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function getDb(): Readonly<DB> {
  return load();
}

const key = (productId: string, id: string) => `${productId}:${id}`;

/** Só copia os extras que vieram definidos (não apaga dados antigos com undefined). */
function extras(item: ScrapedListing): Partial<ListingRecord> {
  const out: Partial<ListingRecord> = {};
  for (const k of ['image', 'shippingCost', 'pickup', 'zip', 'city', 'canOffer', 'sellerId', 'categoryId', 'productType'] as const) {
    if (item[k] !== undefined) (out as any)[k] = item[k];
  }
  return out;
}

/** Preço dentro da faixa? (lance de leilão abaixo do piso é normal no início → aceita) */
function priceReason(item: ScrapedListing, p: ProductConfig): string | undefined {
  const isAuction = item.mode !== 'buynow';
  // Leilão híbrido com "Sofort" exagerado (ex.: lance 200, Sofort 2'000) continua válido pelo lance;
  // o Sofort fora da faixa é simplesmente ignorado nas médias.
  if (item.buyNowPrice !== null && (item.buyNowPrice < p.priceFloor || (!isAuction && item.buyNowPrice > p.priceCeil))) {
    return `preço fora da faixa (${item.buyNowPrice})`;
  }
  if (item.buyNowPrice === null && item.bidPrice !== null && item.bidPrice > p.priceCeil) {
    return `lance acima do teto (${item.bidPrice})`;
  }
  if (item.buyNowPrice === null && item.bids >= 5 && item.bidPrice !== null && item.bidPrice < p.priceFloor * 0.4) {
    return `lance muito baixo com muitos lances (${item.bidPrice}) — provável acessório`;
  }
  return undefined;
}

/** Estado declarado pelo vendedor que indica defeito (não serve como referência de revenda). */
export function badCondition(cond: string | null | undefined): boolean {
  return !!cond && /damag|defect|broken|parts|bastler|kaputt|beschädigt/i.test(cond);
}

/**
 * Categorias do Ricardo aceites para um produto, APRENDIDAS dos próprios anúncios:
 * "âncoras" = título certo + preço Sofort dentro da faixa (ou seja, o produto a sério).
 * Ex.: Switch 2 → categoria "Konsolen"; jogos ("Games") e comandos ficam de fora.
 * Devolve null enquanto houver menos de 5 âncoras (sem filtro).
 */
export function acceptedCategories(p: ProductConfig, records: ListingRecord[], extra: ScrapedListing[] = []): Set<string> | null {
  const counts = new Map<string, number>();
  const seenIds = new Set<string>();
  const add = (id: string, cat: string | null | undefined, titleOk: boolean, buyNow: number | null) => {
    if (!cat || !titleOk || seenIds.has(id) || buyNow === null || buyNow < p.priceFloor || buyNow > p.priceCeil) return;
    seenIds.add(id);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  };
  for (const it of extra) add(it.id, it.categoryId, checkRelevance(it.title, it.url, p).relevant, it.buyNowPrice);
  for (const r of records) add(r.id, r.categoryId, r.titleOk ?? r.relevant, r.buyNowPrice);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total < 5) return null;
  return new Set([...counts.entries()].filter(([, n]) => n / total >= 0.15).map(([c]) => c));
}

/** Registos com a relevância recalculada pelas regras atuais (categoria + estado), inclusive os antigos. */
export function effectiveRecords(productId: string): ListingRecord[] {
  const p = getProduct(productId);
  const recs = recordsFor(productId);
  if (!p) return recs;
  const cats = acceptedCategories(p, recs);
  return recs.map((r) => {
    if (!r.relevant) return r;
    // Regras de título atuais aplicadas também a registos antigos (ex.: novos termos de acessórios).
    const t = checkRelevance(r.title, r.url, p);
    if (!t.relevant) return { ...r, relevant: false, titleOk: false, rejectReason: t.reason };
    if (cats && r.categoryId && !cats.has(r.categoryId)) return { ...r, relevant: false, rejectReason: `outra categoria (${r.categoryId})` };
    if (badCondition(r.condition)) return { ...r, relevant: false, rejectReason: `estado: ${r.condition}` };
    return r;
  });
}

export interface IngestResult {
  productId: string;
  received: number;
  relevant: number;
  new: number;
  updated: number;
  rejected: { reason: string; count: number }[];
  samplesRejected: { title: string; reason: string }[];
}

export function ingest(payload: IngestPayload): IngestResult {
  const p = getProduct(payload.productId);
  if (!p) throw new Error(`Produto desconhecido: ${payload.productId}`);
  const db = load();
  const now = payload.scrapedAt && !isNaN(Date.parse(payload.scrapedAt)) ? payload.scrapedAt : new Date().toISOString();

  let fresh = 0, updated = 0, relevantCount = 0;
  const reasons = new Map<string, number>();
  const samples: { title: string; reason: string }[] = [];
  const seen = new Set<string>();

  const cats = acceptedCategories(p, Object.values(db.listings).filter((r) => r.productId === p.id), payload.items);

  for (const item of payload.items) {
    if (!item?.id || !/^\d{6,}$/.test(String(item.id))) continue;
    const rel = checkRelevance(item.title ?? '', item.url ?? '', p);
    const reason = !rel.relevant ? rel.reason
      : cats && item.categoryId && !cats.has(item.categoryId) ? `outra categoria (${item.categoryId})`
      : badCondition(item.condition) ? `estado: ${item.condition}`
      : priceReason(item, p);
    const relevant = !reason;
    const titleOk = rel.relevant;
    if (relevant) relevantCount++;
    else {
      const bucket = reason!.replace(/\s*\(.*$/, '').replace(/:.*/, '');
      reasons.set(bucket, (reasons.get(bucket) ?? 0) + 1);
      if (samples.length < 8) samples.push({ title: item.title, reason: reason! });
    }

    const k = key(p.id, item.id);
    seen.add(k);
    const prev = db.listings[k];
    const snap = { at: now, bid: item.bidPrice, buyNow: item.buyNowPrice, bids: item.bids };
    if (!prev) {
      fresh++;
      db.listings[k] = {
        id: item.id, productId: p.id, title: item.title, url: item.url, mode: item.mode,
        bidPrice: item.bidPrice, buyNowPrice: item.buyNowPrice, bids: item.bids,
        endDate: item.endDate, startDate: item.startDate ?? null, condition: item.condition,
        ...extras(item),
        relevant, rejectReason: reason, titleOk,
        firstSeen: now, lastSeen: now, seenCount: 1, history: [snap],
        status: 'active', finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null,
        checkAttempts: 0, lastCheckAt: null, missedRuns: 0,
      };
    } else {
      updated++;
      const last = prev.history[prev.history.length - 1];
      if (!last || last.bid !== snap.bid || last.buyNow !== snap.buyNow || last.bids !== snap.bids) {
        prev.history = [...prev.history, snap].slice(-20);
      }
      Object.assign(prev, {
        title: item.title || prev.title,
        url: item.url || prev.url,
        mode: item.mode,
        bidPrice: item.bidPrice ?? prev.bidPrice,
        buyNowPrice: item.buyNowPrice,
        bids: Math.max(item.bids, item.mode === 'buynow' ? 0 : prev.bids),
        // Data exata vinda do JSON > estimativa pelo texto do card (que varia a cada leitura)
        endDate: item.endDate && (item.source.includes('next') || !prev.endDate) ? item.endDate : prev.endDate,
        condition: item.condition ?? prev.condition,
        startDate: item.startDate ?? prev.startDate ?? null,
        ...extras(item),
        relevant, rejectReason: reason, titleOk,
        lastSeen: now,
        seenCount: prev.seenCount + 1,
        missedRuns: 0,
      });
      // Reapareceu na pesquisa → continua ativo (ex.: fecho inferido cedo demais).
      if (prev.status !== 'active' && prev.soldEvidence !== 'detail') {
        Object.assign(prev, { status: 'active', closedAt: null, finalPrice: null, soldVia: null, soldEvidence: null });
      }
    }
  }

  // Anúncios que não apareceram nesta leitura completa → contador.
  if (payload.complete && payload.items.length > 0) {
    // Página NÃO cheia (< 55 anúncios) = vimos TODO o inventário deste produto. Então um "Sofort kaufen"
    // que desaparece 2 leituras seguidas antes do fim previsto foi, muito provavelmente, vendido.
    const fullInventory = payload.items.length < 55;
    const nowMs = Date.parse(now);
    for (const [k, r] of Object.entries(db.listings)) {
      if (r.productId !== p.id || r.status !== 'active' || seen.has(k)) continue;
      r.missedRuns = (r.missedRuns ?? 0) + 1;
      const endsLater = !r.endDate || Date.parse(r.endDate) > nowMs + 30 * 60e3;
      if (fullInventory && r.mode === 'buynow' && r.missedRuns >= 2 && endsLater) {
        closeAs(r, now, 'gone', null, null, null); // "venda Sofort provável" (preço = buyNowPrice)
      }
    }
  }

  const prod = (db.products[p.id] ??= { runs: [] });
  prod.runs = [...prod.runs, { at: now, found: payload.items.length, relevant: relevantCount, complete: payload.complete }].slice(-MAX_RUNS);

  closeStale(db, new Date());
  prune(db, new Date());
  save(db);

  return {
    productId: p.id,
    received: payload.items.length,
    relevant: relevantCount,
    new: fresh,
    updated,
    rejected: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    samplesRejected: samples,
  };
}

/** Fila de anúncios que o runner deve abrir para confirmar se venderam. */
export function recheckQueue(limit: number, now = new Date()) {
  const db = load();
  const nowMs = now.getTime();
  const due = Object.entries(db.listings)
    .filter(([, r]) => r.relevant && r.status === 'active')
    .filter(([, r]) => !r.lastCheckAt || nowMs - new Date(r.lastCheckAt).getTime() > 6 * HOUR)
    .map(([k, r]) => {
      const ended = r.endDate ? new Date(r.endDate).getTime() < nowMs - 10 * 60e3 : false;
      const missing = (r.missedRuns ?? 0) >= 2;
      // prioridade: terminou (mais antigo primeiro) > desapareceu da pesquisa
      const prio = ended ? 2e13 - new Date(r.endDate!).getTime() : missing ? 1e13 - new Date(r.lastSeen).getTime() : -1;
      return { k, r, prio };
    })
    .filter((x) => x.prio > 0)
    .sort((a, b) => b.prio - a.prio)
    .slice(0, limit);
  return due.map(({ r }) => ({ productId: r.productId, id: r.id, url: r.url }));
}

/** Leilões relevantes, com lances, que terminam nos próximos `withinMin` minutos (para o runner espreitar antes do fim). */
export function closingSoon(withinMin: number, now = new Date()) {
  const db = load();
  const nowMs = now.getTime();
  return Object.values(db.listings)
    .filter((r) => r.relevant && r.status === 'active' && r.mode !== 'buynow' && r.bids > 0 && r.endDate)
    .map((r) => ({ productId: r.productId, id: r.id, endDate: r.endDate!, bids: r.bids }))
    .filter((x) => { const t = new Date(x.endDate).getTime(); return t > nowMs && t - nowMs <= withinMin * 60e3; })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

/** Aplica o resultado de abrir a página de um anúncio. */
export function applyDetails(results: (DetailSignals & { productId: string })[], now = new Date()) {
  const db = load();
  const iso = now.toISOString();
  const out = { applied: 0, sold: 0, unsold: 0, stillActive: 0, unknown: 0 };
  for (const s of results) {
    const r = db.listings[key(s.productId, s.id)];
    if (!r) continue;
    out.applied++;
    r.lastCheckAt = iso;
    if (s.bids !== null && s.bids >= r.bids) r.bids = s.bids;
    if (s.condition) r.condition = s.condition;
    if (s.endDate) r.endDate = s.endDate;

    const endPassed = r.endDate ? new Date(r.endDate).getTime() <= now.getTime() : false;

    if (s.removed) {
      closeAs(r, iso, r.mode !== 'buynow' && r.bids > 0 && endPassed ? 'sold' : 'gone', r.bidPrice, 'auction', 'inferred');
      r.status === 'sold' ? out.sold++ : out.unknown++;
    } else if (s.ended === false) {
      if (s.currentPrice && r.mode !== 'buynow') r.bidPrice = s.currentPrice;
      if (s.buyNowPrice) r.buyNowPrice = s.buyNowPrice;
      out.stillActive++;
    } else if (s.ended === true) {
      const bids = s.bids ?? r.bids;
      if (r.mode !== 'buynow' && bids > 0) {
        const price = s.currentPrice ?? r.bidPrice;
        const viaBuyNow = s.soldMarker && r.buyNowPrice !== null && price !== null && Math.abs(price - r.buyNowPrice) < 0.5;
        closeAs(r, iso, 'sold', price, viaBuyNow ? 'buynow' : 'auction', 'detail');
        out.sold++;
      } else if (s.soldMarker) {
        closeAs(r, iso, 'sold', s.buyNowPrice ?? r.buyNowPrice ?? s.currentPrice, 'buynow', 'detail');
        out.sold++;
      } else if (r.mode === 'buynow' && !endPassed) {
        // Preço fixo que terminou antes do prazo: quase sempre é venda.
        closeAs(r, iso, 'sold', r.buyNowPrice, 'buynow', 'inferred');
        out.sold++;
      } else {
        closeAs(r, iso, 'ended_unsold', null, null, null);
        out.unsold++;
      }
    } else {
      r.checkAttempts++;
      out.unknown++;
    }
  }
  closeStale(db, now);
  save(db);
  return out;
}

function closeAs(
  r: ListingRecord, at: string, status: ListingRecord['status'],
  price: number | null, via: ListingRecord['soldVia'], evidence: ListingRecord['soldEvidence'],
) {
  r.status = status;
  r.closedAt = r.endDate && new Date(r.endDate).getTime() < new Date(at).getTime() && status !== 'gone' ? r.endDate : at;
  r.finalPrice = status === 'sold' ? price : null;
  r.soldVia = status === 'sold' ? via : null;
  r.soldEvidence = status === 'sold' ? evidence : null;
}

/** Fecha por inferência o que já não dá para verificar (runner sem acesso, anúncio antigo). */
function closeStale(db: DB, now: Date) {
  const nowMs = now.getTime();
  const iso = now.toISOString();
  for (const r of Object.values(db.listings)) {
    if (r.status !== 'active') continue;
    const endMs = r.endDate ? new Date(r.endDate).getTime() : null;
    const lastSeenMs = new Date(r.lastSeen).getTime();
    // Visto na pesquisa até ≤ 75 min antes do fim e já terminou há 30 min → o último lance visto
    // é uma boa estimativa do preço final (as páginas de anúncio estão bloqueadas pela Cloudflare).
    const seenNearEnd = endMs !== null && endMs - lastSeenMs <= 75 * 60e3 && lastSeenMs <= endMs + 5 * 60e3;
    if (endMs && endMs < nowMs - 30 * 60e3 && seenNearEnd && r.mode !== 'buynow') {
      if (r.bids > 0) closeAs(r, iso, 'sold', r.bidPrice, 'auction', 'inferred');
      else closeAs(r, iso, 'ended_unsold', null, null, null);
    } else if (endMs && endMs < nowMs - 48 * HOUR && (r.checkAttempts >= 3 || nowMs - lastSeenMs > 48 * HOUR)) {
      if (r.mode !== 'buynow' && r.bids > 0) closeAs(r, iso, 'sold', r.bidPrice, 'auction', 'inferred');
      else closeAs(r, iso, 'ended_unsold', null, null, null);
    } else if (!endMs && nowMs - lastSeenMs > 10 * DAY && (r.missedRuns ?? 0) >= 6) {
      closeAs(r, iso, 'gone', null, null, null);
    }
  }
}

/** Fecha leilões terminados sem esperar pelo próximo envio do runner (chamado ao abrir o painel; no máx. 1×/2 min). */
let lastMaintain = 0;
export function maintain(now = new Date()) {
  if (now.getTime() - lastMaintain < 2 * 60e3) return;
  lastMaintain = now.getTime();
  const db = load();
  const before = JSON.stringify(Object.values(db.listings).map((r) => r.status));
  closeStale(db, now);
  if (JSON.stringify(Object.values(db.listings).map((r) => r.status)) !== before) save(db);
}

/** Mantém o ficheiro pequeno: rejeitados antigos e fechados muito antigos saem. */
function prune(db: DB, now: Date) {
  const nowMs = now.getTime();
  for (const [k, r] of Object.entries(db.listings)) {
    const age = nowMs - new Date(r.lastSeen).getTime();
    if (!r.relevant && age > 7 * DAY) delete db.listings[k];
    else if (r.status !== 'active' && r.closedAt && nowMs - new Date(r.closedAt).getTime() > 180 * DAY) delete db.listings[k];
  }
}

/** Devolve true se este alerta ainda não foi enviado (ou se o preço caiu ≥ 5 % desde o último). */
export function shouldAlert(alertKey: string, price: number, now = new Date()): boolean {
  const db = load();
  const prev = db.alerts?.[alertKey];
  if (!prev) return true;
  return price <= prev.price * 0.95 && now.getTime() - new Date(prev.at).getTime() > 3600e3;
}

export function markAlerted(entries: { key: string; price: number }[], now = new Date()) {
  if (!entries.length) return;
  const db = load();
  db.alerts ??= {};
  for (const e of entries) db.alerts[e.key] = { at: now.toISOString(), price: e.price };
  // limpa alertas com mais de 30 dias
  for (const [k, v] of Object.entries(db.alerts)) if (now.getTime() - new Date(v.at).getTime() > 30 * DAY) delete db.alerts[k];
  save(db);
}

export function recordsFor(productId: string): ListingRecord[] {
  return Object.values(load().listings).filter((r) => r.productId === productId);
}

export function runsFor(productId: string): ProductRun[] {
  return load().products[productId]?.runs ?? [];
}
