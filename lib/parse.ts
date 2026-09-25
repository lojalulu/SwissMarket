// lib/parse.ts — leitura das páginas do Ricardo.ch a partir do HTML completo (page.content()).
//
// Três fontes, da mais estruturada para a mais frágil, fundidas por ID do anúncio:
//   1. <script id="__NEXT_DATA__">   (estado do Next.js do Ricardo: lances, data de fim, condição)
//   2. <script type="application/ld+json"> (schema.org: nome, URL, preço)
//   3. Os próprios cards <a href="/de/a/…-123456789/"> (texto visível: "76.00 (9 Gebote) 230.00 Sofort kaufen")
//
// Não depende de classes CSS (que mudam a cada deploy do Ricardo). Funções puras → testáveis em Node.

import { parseChf } from './text';
import type { DetailSignals, SaleMode, ScrapedListing } from './types';

// RICARDO_BASE só é alterado em testes locais (servidor falso).
export const RICARDO_BASE = (typeof process !== 'undefined' && process.env?.RICARDO_BASE) || 'https://www.ricardo.ch';

// ───────────────────────────── utilidades ─────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** HTML → texto, com " | " a separar blocos (cada tag vira um separador). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' | '),
  )
    .replace(/\s+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .trim();
}

export function isChallengePage(html: string): boolean {
  return /<title>\s*(Just a moment|Attention Required|Einen Moment)/i.test(html) || /cf-chl-|challenge-platform\/h\//i.test(html);
}

/** URL de pesquisa SEM "?" (o robots.txt do Ricardo proíbe parâmetros em /s/). */
export function searchUrl(term: string): string {
  return `${RICARDO_BASE}/de/s/${encodeURIComponent(term.trim())}/`;
}

export function idFromUrl(url: string): string | null {
  return url.match(/\/a\/[^"'?#]*?-(\d{6,})\/?(?:[?#].*)?$/)?.[1] ?? null;
}

function absoluteUrl(href: string): string {
  const clean = decodeEntities(href);
  return clean.startsWith('http') ? clean : RICARDO_BASE + clean;
}

function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Número a partir de 12.5 | "12.50" | {amount: 12.5} | {value: "12.50"}. */
function priceValue(v: unknown): number | null {
  if (typeof v === 'number' || typeof v === 'string') return parseChf(v as string | number);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['amount', 'value', 'price', 'amountValue']) {
      if (k in o) return priceValue(o[k]);
    }
  }
  return null;
}

// ─────────────────────── JSON embutido na página ───────────────────────

/**
 * O Ricardo usa o App Router do Next.js: os dados vêm em `self.__next_f.push([1,"…"])` (payload RSC),
 * incluindo o estado do React Query com cada anúncio {id,title,bidPrice,buyNowPrice,bidsCount,endDate,…}.
 */
export function extractRscRoots(html: string): unknown[] {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let text = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { text += JSON.parse(`"${m[1]}"`); } catch { /* chunk inválido */ }
  }
  return text ? parseRscText(text) : [];
}

/** Texto RSC "cru" (linhas "<id>:<json>") → objetos JSON. Também serve para respostas de navegação cliente (?_rsc=). */
export function parseRscText(text: string): unknown[] {
  const roots: unknown[] = [];
  // 1) cada linha RSC é "<id>:<json>"
  for (const line of text.split('\n')) {
    const c = line.indexOf(':');
    if (c < 1 || c > 8) continue;
    const payload = line.slice(c + 1);
    if (!/^[\[{]/.test(payload)) continue;
    try { roots.push(JSON.parse(payload)); } catch { /* linha partida ou não-JSON */ }
  }
  // 2) plano B: extrai objetos {"id":"123456…",…} com chavetas equilibradas
  if (!roots.length) {
    const idRe = /\{"id":"?\d{6,}/g;
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(text))) {
      const obj = balancedObject(text, im.index);
      if (obj) { try { roots.push(JSON.parse(obj)); } catch { /* ignora */ } }
    }
  }
  return roots;
}

function balancedObject(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length && i - start < 20000; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export function extractJsonBlobs(html: string): { nextData: unknown | null; ldJson: unknown[]; rsc: unknown[] } {
  let nextData: unknown | null = null;
  const nd = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nd) {
    try { nextData = JSON.parse(nd[1]); } catch { nextData = null; }
  }
  const ldJson: unknown[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { ldJson.push(JSON.parse(m[1])); } catch { /* ignora bloco inválido */ }
  }
  return { nextData, ldJson, rsc: extractRscRoots(html) };
}

type Obj = Record<string, unknown>;

/** Percorre qualquer JSON (iterativo, com limite) e devolve todos os objetos. */
function* objects(root: unknown, limit = 300_000): Generator<Obj> {
  const stack: unknown[] = [root];
  let n = 0;
  while (stack.length && n < limit) {
    const cur = stack.pop();
    n++;
    if (Array.isArray(cur)) { for (const x of cur) stack.push(x); continue; }
    if (cur && typeof cur === 'object') {
      yield cur as Obj;
      for (const v of Object.values(cur as Obj)) if (v && typeof v === 'object') stack.push(v);
    }
  }
}

const K = {
  id: /^(id|articleId|offerId|listingId|article_id|offer_id)$/i,
  title: /^(title|name|articleTitle|headline)$/i,
  url: /^(url|href|link|articleUrl|canonicalUrl|@id)$/i,
  buyNow: /^(buyNowPrice|buy_now_price|buyNow|fixPrice|fixedPrice|priceBuyNow|instantBuyPrice)$/i,
  bid: /^(bidPrice|currentBid|currentBidPrice|highestBid|currentPrice|auctionPrice|bid_price|current_bid)$/i,
  start: /^(startPrice|startingPrice|minimumBid|start_price)$/i,
  bids: /^(bidsCount|bidCount|bids_count|numberOfBids|nrOfBids|bidsNumber|bids)$/i,
  end: /^(endDate|endTime|endsAt|end_date|closingDate|auctionEnd|endingAt|availabilityEnds)$/i,
  cond: /^(condition|conditionKey|itemCondition|condition_key|conditionLabel)$/i,
  start_: /^(startDate|creationDate|start_date|createdAt)$/i,
  hasAuction: /^(hasAuction|isAuction|has_auction|auction)$/i,
  hasBuyNow: /^(hasBuyNow|isBuyNow|has_buy_now|buyNowEnabled)$/i,
  ended: /^(hasEnded|isEnded|ended|isClosed|isFinished|is_ended)$/i,
  sold: /^(isSold|sold|hasBeenSold|is_sold)$/i,
  status: /^(status|state|offerStatus|articleStatus)$/i,
  offers: /^offers$/i,
};

function pick(o: Obj, re: RegExp): unknown {
  for (const [k, v] of Object.entries(o)) if (re.test(k)) return v;
  return undefined;
}

function conditionText(v: unknown): string | null {
  if (typeof v === 'string' && v.length < 60) return v.replace(/^https?:\/\/schema\.org\//, '');
  if (v && typeof v === 'object') {
    const o = v as Obj;
    const s = o.label ?? o.name ?? o.key ?? o.value;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

/** Converte um objeto JSON "parecido com anúncio" num ScrapedListing parcial. */
function listingFromObject(o: Obj, source: string): Partial<ScrapedListing> & { id: string } | null {
  let id: string | null = null;
  const rawId = pick(o, K.id);
  if ((typeof rawId === 'number' || typeof rawId === 'string') && /^\d{6,}$/.test(String(rawId))) id = String(rawId);
  const rawUrl = pick(o, K.url);
  const url = typeof rawUrl === 'string' && /\/a\//.test(rawUrl) ? absoluteUrl(rawUrl) : null;
  if (!id && url) id = idFromUrl(url);
  if (!id) return null;

  const title = pick(o, K.title);
  if (typeof title !== 'string' || title.trim().length < 3) return null;

  let buyNow = priceValue(pick(o, K.buyNow));
  let bid = priceValue(pick(o, K.bid));
  const start = priceValue(pick(o, K.start));
  const bidsRaw = pick(o, K.bids);
  const bids = typeof bidsRaw === 'number' ? bidsRaw
    : Array.isArray(bidsRaw) ? bidsRaw.length
    : typeof bidsRaw === 'string' && /^\d+$/.test(bidsRaw) ? Number(bidsRaw) : null;

  // schema.org Product → offers.price
  const offers = pick(o, K.offers);
  if (!buyNow && !bid && offers && typeof offers === 'object') {
    const off = (Array.isArray(offers) ? offers[0] : offers) as Obj | undefined;
    const p = off ? priceValue(off.price ?? off.lowPrice) : null;
    if (p) buyNow = p;
  }

  const hasAuction = pick(o, K.hasAuction);
  const hasBuyNow = pick(o, K.hasBuyNow);
  if (!bid && start && (hasAuction === true || (bids ?? 0) === 0)) bid = start;
  if (hasBuyNow === false) buyNow = null;

  let mode: SaleMode | undefined;
  if (hasAuction === false) mode = buyNow ? 'buynow' : undefined;
  else if (hasAuction === true || bid || (bids ?? 0) > 0) mode = buyNow ? 'hybrid' : 'auction';
  else if (buyNow) mode = 'buynow';

  return {
    id,
    title: decodeEntities(title.trim()).slice(0, 200),
    url: url ?? undefined,
    mode,
    bidPrice: bid,
    buyNowPrice: buyNow,
    bids: bids ?? undefined,
    endDate: toIso(pick(o, K.end)),
    startDate: toIso(pick(o, K.start_)),
    condition: conditionText(pick(o, K.cond)),
    source,
    ...extrasFromObject(o),
  };
}

/** Frete, retirada, localização, propostas, foto e vendedor (payload RSC do Ricardo). */
function extrasFromObject(o: Obj): Partial<ScrapedListing> {
  const out: Partial<ScrapedListing> = {};
  const ship = o.shipping;
  if (Array.isArray(ship) && ship.length) {
    const opts = ship.filter((x): x is Obj => !!x && typeof x === 'object');
    out.pickup = opts.some((x) => /get_by_buyer|pickup|abholung/i.test(String(x.key ?? '')));
    const costs = opts.filter((x) => !/get_by_buyer|pickup|abholung/i.test(String(x.key ?? '')))
      .map((x) => Number(x.cost)).filter((n) => Number.isFinite(n) && n >= 0);
    out.shippingCost = costs.length ? Math.min(...costs) : null;
    const loc = opts.find((x) => x.zipCode || x.city);
    if (loc) { out.zip = loc.zipCode ? String(loc.zipCode) : null; out.city = loc.city ? String(loc.city) : null; }
  }
  if (typeof o.canMakeAnOffer === 'boolean') out.canOffer = o.canMakeAnOffer;
  if (typeof o.image === 'string' && /^https?:/.test(o.image)) out.image = o.image;
  if (typeof o.sellerId === 'string' || typeof o.sellerId === 'number') out.sellerId = String(o.sellerId);
  return out;
}

function listingsFromJson(root: unknown, source: string): Map<string, Partial<ScrapedListing> & { id: string }> {
  const out = new Map<string, Partial<ScrapedListing> & { id: string }>();
  for (const o of objects(root)) {
    const l = listingFromObject(o, source);
    if (!l) continue;
    const prev = out.get(l.id);
    // O mesmo anúncio pode aparecer várias vezes no estado: fica o objeto com mais campos.
    const score = (x: Partial<ScrapedListing>) =>
      [x.bidPrice, x.buyNowPrice, x.bids, x.endDate, x.condition, x.url].filter((v) => v !== null && v !== undefined).length;
    if (!prev || score(l) > score(prev)) out.set(l.id, l);
  }
  return out;
}

// ─────────────────────── Cards HTML (fallback visual) ───────────────────────

const PRICE_RE = /(?<![\d'’])\d{1,3}(?:['’]\d{3})*(?:\.\d{2}|\.[-–])(?!\d)/g;
const PRICE_TEST = new RegExp(PRICE_RE.source);
const BIDS_RE = /\(?\s*(\d+)\s*(?:Gebote?|offres?|offerte?|bids?)\s*\)?/i;
const BUYNOW_RE = /Sofort kaufen|Achat imm[ée]diat|Acquista subito|Compra subito|Buy now/i;

const BADGES = /^(Beliebt|Boost|Neuheit|Neu|Top|Highlight|Populaire|Nouveau|Popolare|Novit[aà])$/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mär: 2, maer: 2, apr: 3, mai: 4, may: 4, jun: 5, jul: 6, aug: 7, sep: 8,
  okt: 9, oct: 9, nov: 10, dez: 11, dec: 11, janv: 0, fevr: 1, févr: 1, avr: 3, juin: 5, juil: 6, aout: 7, août: 7,
  gen: 0, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, dic: 11,
};

/** Converte data/hora "de parede" em Zurique para ISO UTC (trata horário de verão). */
export function zurichToIso(y: number, mo: number, d: number, h: number, mi: number): string {
  const guess = Date.UTC(y, mo, d, h, mi);
  let offsetMin = 60;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(guess)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const m = parts.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (m) offsetMin = Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0);
  } catch {
    offsetMin = mo >= 3 && mo <= 9 ? 120 : 60; // aproximação sem Intl
  }
  return new Date(guess - offsetMin * 60e3).toISOString();
}

function zurichToday(now: Date): { y: number; mo: number; d: number } {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const [y, mo, d] = f.split('-').map(Number);
    return { y, mo: mo - 1, d };
  } catch {
    return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() };
  }
}

/**
 * Data de fim escrita no card → ISO. Formatos vistos no Ricardo:
 *   "Di, 29 Sep., 16:00" · "Morgen, 13:37" · "Heute, 21:30" · "3T 4Std" · "5Std 12Min"
 */
export function parseTimeLeft(text: string, now: Date): string | null {
  const t = zurichToday(now);
  const abs = text.match(/(\d{1,2})\.?\s+([A-Za-zÄäÖöÜüéû]{3,5})\.?,?\s+(\d{1,2}):(\d{2})/);
  if (abs) {
    const key = abs[2].toLowerCase();
    const mo = MONTHS[key.slice(0, 4)] ?? MONTHS[key.slice(0, 3)];
    if (mo !== undefined) {
      let y = t.y;
      if (mo < t.mo - 6) y++; // dezembro → janeiro
      return zurichToIso(y, mo, Number(abs[1]), Number(abs[3]), Number(abs[4]));
    }
  }
  const hm = text.match(/(heute|morgen|aujourd'hui|demain|oggi|domani)[,\s|]*(\d{1,2}):(\d{2})/i);
  if (hm) {
    const add = /morgen|demain|domani/i.test(hm[1]) ? 1 : 0;
    const base = new Date(Date.UTC(t.y, t.mo, t.d + add));
    return zurichToIso(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), Number(hm[2]), Number(hm[3]));
  }
  const days = text.match(/(\d+)\s*(?:T|Tage?|j|jours?|g|giorni?)\b/i);
  const hours = text.match(/(\d+)\s*(?:Std|h|Stunden?|heures?|ore)\b/i);
  const mins = text.match(/(\d+)\s*(?:Min|m|Minuten?)\b/i);
  if (!days && !hours && !mins) return null;
  const ms = (Number(days?.[1] ?? 0) * 24 + Number(hours?.[1] ?? 0)) * 3600e3 + Number(mins?.[1] ?? 0) * 60e3;
  if (ms <= 0 || ms > 40 * 24 * 3600e3) return null;
  return new Date(now.getTime() + ms).toISOString();
}

export function parseCardsHtml(html: string, now = new Date()): Map<string, ScrapedListing> {
  const out = new Map<string, ScrapedListing>();
  const re = /<a\b[^>]*href="((?:https:\/\/www\.ricardo\.ch)?\/(?:de|fr|it)\/a\/[^"]*?-(\d{6,})\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const [, href, id, inner] = m;
    const text = htmlToText(inner);
    const prices = [...text.matchAll(PRICE_RE)].map((x) => ({ v: parseChf(x[0]), at: x.index ?? 0 }))
      .filter((p): p is { v: number; at: number } => p.v !== null);

    const bidsM = text.match(BIDS_RE);
    const sofortAt = text.search(BUYNOW_RE);
    const before = (pos: number) => { const c = prices.filter((p) => p.at < pos); return c.length ? c[c.length - 1].v : null; };
    const after = (pos: number) => prices.find((p) => p.at > pos)?.v ?? null;

    let bidPrice: number | null = null;
    let buyNowPrice: number | null = null;
    let bids = 0;
    let mode: SaleMode;
    if (bidsM) {
      bids = Number(bidsM[1]);
      bidPrice = before(bidsM.index ?? 0) ?? prices[0]?.v ?? null;
      if (sofortAt >= 0) {
        const candidates = prices.filter((p) => p.v !== bidPrice);
        buyNowPrice = sofortAt > (bidsM.index ?? 0)
          ? (before(sofortAt) !== bidPrice ? before(sofortAt) : null) ?? after(sofortAt)
          : candidates[0]?.v ?? null;
      }
      mode = buyNowPrice ? 'hybrid' : 'auction';
    } else if (sofortAt >= 0) {
      buyNowPrice = before(sofortAt) ?? after(sofortAt);
      mode = 'buynow';
    } else {
      // Card sem "Gebote" nem "Sofort kaufen": trata o 1º preço como preço pedido.
      buyNowPrice = prices[0]?.v ?? null;
      mode = 'buynow';
    }
    const title = extractCardTitle(inner, text, href);
    const listing: ScrapedListing = {
      id,
      title,
      url: absoluteUrl(href),
      mode,
      bidPrice,
      buyNowPrice,
      bids,
      endDate: parseTimeLeft(text.split(title).join(' '), now),
      condition: null,
      source: 'html',
    };

    const prev = out.get(id);
    // O mesmo anúncio aparece em 2 links (imagem + texto): junta os dados.
    if (!prev) out.set(id, listing);
    else out.set(id, mergeListing(prev, listing));
  }
  return out;
}

function extractCardTitle(inner: string, text: string, href: string): string {
  // Foto do produto (ignora ícones/etiquetas como "Beliebt", "Boost", "Neuheit")
  for (const img of inner.match(/<img\b[^>]*>/gi) ?? []) {
    const src = img.match(/\bsrc="([^"]*)"/i)?.[1] ?? '';
    const alt = img.match(/\balt="([^"]{4,})"/i)?.[1];
    if (alt && !/\/icons?\/|\.svg/i.test(src) && !/icon|logo|avatar/i.test(alt)) return decodeEntities(alt).slice(0, 200);
  }
  const titleAttr = inner.match(/\btitle="([^"]{4,})"/i)?.[1];
  if (titleAttr) return decodeEntities(titleAttr).slice(0, 200);
  // 1º bloco de texto que não é preço / lances / tempo
  const block = text.split(' | ').map((s) => s.trim()).find((s) => !BADGES.test(s) &&
    s.length >= 6 && !PRICE_TEST.test(s) && !BIDS_RE.test(s) && !BUYNOW_RE.test(s) && /[a-z]{3}/i.test(s));
  if (block) return block.slice(0, 200);
  const slug = href.match(/\/a\/(.*?)-\d{6,}/)?.[1] ?? '';
  try { return decodeURIComponent(slug).replace(/-/g, ' '); } catch { return slug.replace(/-/g, ' '); }
}

function mergeListing(a: ScrapedListing, b: Partial<ScrapedListing>): ScrapedListing {
  const pickNum = (x: number | null | undefined, y: number | null | undefined) => (x ?? null) !== null ? x! : (y ?? null);
  const bids = Math.max(a.bids ?? 0, b.bids ?? 0);
  const bidPrice = pickNum(a.bidPrice, b.bidPrice);
  const buyNowPrice = pickNum(a.buyNowPrice, b.buyNowPrice);
  const isAuction = bids > 0 || bidPrice !== null || a.mode !== 'buynow' || (b.mode !== undefined && b.mode !== 'buynow');
  return {
    ...a,
    title: a.title.length >= (b.title?.length ?? 0) ? a.title : b.title!,
    url: a.url || b.url || '',
    bids,
    bidPrice,
    buyNowPrice,
    mode: isAuction ? (buyNowPrice ? 'hybrid' : 'auction') : 'buynow',
    endDate: a.endDate ?? b.endDate ?? null,
    condition: a.condition ?? b.condition ?? null,
    source: a.source === b.source || !b.source ? a.source : `${a.source}+${b.source}`,
  };
}

/** Os valores do JSON às vezes estão em cêntimos: se diferirem ~100× do preço visível, confia no visível. */
function reconcilePrice(json: number | null | undefined, html: number | null | undefined): number | null {
  if (html && json && (json / html > 50 || html / json > 50)) return html;
  return json ?? html ?? null;
}

// ─────────────────────── API pública: página de pesquisa ───────────────────────

export interface SearchParseResult {
  items: ScrapedListing[];
  challenge: boolean;
  sources: { nextData: number; ldJson: number; html: number };
}

export function parseSearchPage(html: string, now = new Date()): SearchParseResult {
  if (isChallengePage(html)) return { items: [], challenge: true, sources: { nextData: 0, ldJson: 0, html: 0 } };

  const cards = parseCardsHtml(html, now);
  const { nextData, ldJson, rsc } = extractJsonBlobs(html);
  const fromNext = nextData ? listingsFromJson(nextData, 'next-data') : new Map<string, Partial<ScrapedListing> & { id: string }>();
  // Payload RSC (App Router): mesma riqueza do __NEXT_DATA__ → trata como "next-data"
  if (rsc.length) for (const [k, v] of listingsFromJson(rsc, 'next-data')) if (!fromNext.has(k)) fromNext.set(k, v);
  const fromLd = new Map<string, Partial<ScrapedListing> & { id: string }>();
  for (const blob of ldJson) for (const [k, v] of listingsFromJson(blob, 'json-ld')) fromLd.set(k, v);

  // Só aceita IDs do JSON que também aparecem como card visível (evita "recomendados"/"vistos
  // recentemente" escondidos no estado) — a menos que não haja nenhum card (layout mudou).
  const allowed = cards.size > 0 ? new Set(cards.keys()) : new Set([...fromNext.keys(), ...fromLd.keys()]);

  const items: ScrapedListing[] = [];
  for (const id of allowed) {
    const card = cards.get(id);
    const nx = fromNext.get(id);
    const ld = fromLd.get(id);
    // JSON-LD (schema.org) só tem um "price" genérico: usa-o como preço apenas se o card não tiver nenhum.
    const ldUsable = ld && (!card || (card.bidPrice === null && card.buyNowPrice === null))
      ? ld : ld ? { ...ld, bidPrice: undefined, buyNowPrice: undefined, mode: undefined } : undefined;
    const json = { ...(ldUsable ?? {}), ...(nx ?? {}) } as Partial<ScrapedListing>;
    let base: ScrapedListing = card ?? {
      id, title: json.title ?? '', url: json.url ?? `${RICARDO_BASE}/de/a/-${id}/`,
      mode: json.mode ?? 'buynow', bidPrice: null, buyNowPrice: null, bids: 0,
      endDate: null, condition: null, source: nx ? 'next-data' : 'json-ld',
    };
    if (nx || ldUsable) {
      const merged = mergeListing(base, { ...json, bids: json.bids ?? base.bids });
      merged.bidPrice = reconcilePrice(json.bidPrice, card?.bidPrice);
      merged.buyNowPrice = reconcilePrice(json.buyNowPrice, card?.buyNowPrice);
      if (json.bids !== undefined && json.bids !== null) merged.bids = json.bids;
      if (json.endDate) merged.endDate = json.endDate;           // data exata > estimativa do card
      if (json.title && json.title.length > 3) merged.title = json.title;
      merged.mode = json.mode === 'buynow'
        ? 'buynow'
        : merged.bids > 0 || merged.bidPrice !== null
          ? (merged.buyNowPrice ? 'hybrid' : 'auction')
          : 'buynow';
      if (merged.mode === 'buynow') { merged.bidPrice = null; merged.bids = 0; }
      if (json.startDate) merged.startDate = json.startDate;
      for (const k of ['image', 'shippingCost', 'pickup', 'zip', 'city', 'canOffer', 'sellerId'] as const) {
        if (json[k] !== undefined) (merged as any)[k] = json[k];
      }
      base = merged;
    }
    if (!base.title || (base.bidPrice === null && base.buyNowPrice === null)) continue;
    items.push(base);
  }

  return {
    items,
    challenge: false,
    sources: { nextData: fromNext.size, ldJson: fromLd.size, html: cards.size },
  };
}

// ─────────────────────── API pública: página do anúncio ───────────────────────

const ENDED_RE = /Angebot (?:ist )?beendet|Dieses Angebot ist (?:leider )?(?:nicht mehr verfügbar|beendet|abgelaufen)|Auktion beendet|Angebot abgelaufen|Offre terminée|Cette offre est terminée|Offerta terminata|L'offerta è terminata/i;
const SOLD_RE = /\bVerkauft\b(?! wird)|Artikel wurde verkauft|wurde verkauft|Sofort gekauft|\bVendu\b|\bVenduto\b/i;
const ACTIVE_RE = /Nächstes Gebot|Gebot abgeben|\|\s*Bieten\s*\||In den Warenkorb|Jetzt kaufen|Sofort kaufen|Enchérir|Fare un'offerta/i;

export function parseDetailPage(id: string, html: string, finalUrl?: string, extraRoots: unknown[] = []): DetailSignals {
  const base: DetailSignals = {
    id, removed: false, ended: null, soldMarker: false, bids: null,
    currentPrice: null, buyNowPrice: null, condition: null, endDate: null,
  };
  if (finalUrl && idFromUrl(finalUrl) !== id && !finalUrl.includes(id)) return { ...base, removed: true };

  const { nextData, ldJson, rsc } = extractJsonBlobs(html);
  const text = htmlToText(html);

  // 1) JSON estruturado — procura o objeto do próprio anúncio.
  let endedFlag: boolean | null = null;
  let soldFlag = false;
  for (const root of [nextData, ...ldJson, ...rsc, ...extraRoots]) {
    if (!root) continue;
    for (const o of objects(root)) {
      const oid = pick(o, K.id);
      const ourl = pick(o, K.url);
      const matches = String(oid ?? '') === id || (typeof ourl === 'string' && ourl.includes(id));
      if (!matches) continue;
      const l = listingFromObject(o, 'detail');
      if (l) {
        base.bids = l.bids ?? base.bids;
        base.currentPrice = l.bidPrice ?? base.currentPrice;
        base.buyNowPrice = l.buyNowPrice ?? base.buyNowPrice;
        base.condition = l.condition ?? base.condition;
        base.endDate = l.endDate ?? base.endDate;
      }
      const e = pick(o, K.ended);
      if (typeof e === 'boolean') endedFlag = endedFlag === true ? true : e;
      const s = pick(o, K.sold);
      if (s === true) soldFlag = true;
      const st = pick(o, K.status);
      if (typeof st === 'string') {
        if (/sold|verkauft/i.test(st)) { soldFlag = true; endedFlag = true; }
        else if (/closed|ended|finished|expired|inactive/i.test(st)) endedFlag = true;
        else if (/^(active|open|running|live)$/i.test(st) && endedFlag === null) endedFlag = false;
      }
    }
  }

  // 2) Texto visível — confirma/complementa.
  const metaDesc = decodeEntities(
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i)?.[1] ?? '');
  const titleTag = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');

  base.condition ??= metaDesc.match(/Zustand:\s*([^|,.]+)/i)?.[1].trim()
    ?? text.match(/\|\s*Zustand\s*\|\s*([^|]{2,30})\|/i)?.[1].trim() ?? null;

  if (base.bids === null) {
    const b = text.match(/Bisherige Gebote\s*\|?\s*\(?(\d+)\)?/i) ?? text.match(/\((\d+)\s*Gebote?\)/i) ?? text.match(/(\d+)\s*Gebote?\b/i);
    if (b) base.bids = Number(b[1]);
  }
  base.currentPrice ??= parseChf(titleTag.match(/für CHF\s*([\d'’.]+)/i)?.[1] ?? '')
    ?? parseChf(metaDesc.match(/CHF\s*([\d'’.]+)/i)?.[1] ?? '');

  const textEnded = ENDED_RE.test(text);
  const textSold = SOLD_RE.test(text);
  const textActive = ACTIVE_RE.test(text);

  base.soldMarker = soldFlag || textSold;
  base.ended = endedFlag ?? (textEnded || textSold ? true : textActive ? false : null);
  if (base.endDate && base.ended === null && new Date(base.endDate).getTime() < Date.now() - 5 * 60e3) base.ended = true;
  return base;
}
