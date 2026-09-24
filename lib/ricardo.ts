// Caminho no repositório: lib/ricardo.ts
// SwissMarket Pulse — "motor" compartilhado: leitura das páginas do Ricardo.ch,
// estatísticas (mediana sem outliers), proxy de liquidez e fórmula do Preço Teto.
// Usado por: scripts/fetchRicardoData.ts (coleta diária) e app/api/search/route.ts ("Buscar agora").
// Sem dependências externas: só fetch nativo do Node 20.

// ───────────────────────────── Tipos ─────────────────────────────

export type Mode = "auction" | "buynow";

export interface Listing {
  id: string;
  title: string;
  url: string;
  mode: Mode;              // auction = tem lances/leilão | buynow = só preço fixo
  price: number;           // auction: lance atual | buynow: preço Sofort-Kaufen
  buyNowPrice: number | null; // preço Sofort-Kaufen (também existe em leilões híbridos)
  bids: number;            // número de lances (0 para buynow puro)
  condition: string;       // "Neu", "Wie neu", "Gebraucht"... ou "Unbekannt"
}

export interface ListingDetail {
  status: "active" | "ended" | "removed" | "unknown";
  condition: string | null;
  currentPrice: number | null;
  bids: number;
  bidSpanHours: number | null; // tempo entre o 1º e o último lance
}

export interface ModeStats {
  count: number;          // amostras usadas (após remover outliers)
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface LiquidityProxy {
  auctions: number;             // leilões na amostra
  auctionsWithBidsPct: number;  // % de leilões com pelo menos 1 lance
  avgBids: number;              // média de lances por leilão
  label: "rapido" | "medio" | "lento" | "sem_dados";
}

// ─────────────────────────── Configuração ───────────────────────────

export const RICARDO_BASE = "https://www.ricardo.ch";

// Só leilões com esse nº mínimo de lances entram na mediana de Leilão.
// Leilões com 0–1 lance ainda estão no preço inicial e puxariam a mediana para baixo.
export const AUCTION_MIN_BIDS = 3;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "de-CH,de;q=0.9,en;q=0.5",
};

export class BlockedError extends Error {}

// ─────────────────────────── Utilidades ───────────────────────────

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Converte "1'250.00" / "1’250.00" / "127" em número. */
export function parseChf(s: string): number | null {
  const n = Number(s.replace(/['’\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** Remove tags HTML, trocando cada tag por " | " para manter os blocos de texto separados. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " | ")
  )
    .replace(/\s+/g, " ")
    .replace(/(\s*\|\s*)+/g, " | ")
    .trim();
}

/** URL de busca SEM "?" (o robots.txt do Ricardo proíbe parâmetros na busca). */
export function searchUrl(term: string): string {
  return `${RICARDO_BASE}/de/s/${encodeURIComponent(term.trim())}/`;
}

/** Baixa uma página. Lança BlockedError se a Cloudflare bloquear. Retorna null em 404/410. */
export async function fetchHtml(url: string, retries = 1): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) { await sleep(15000); continue; }
      throw new Error(`HTTP ${res.status} em ${url}`);
    }
    const html = await res.text();
    const challenge = /cf-chl|challenge-platform|Just a moment|Attention Required/i.test(html);
    if (res.status === 403 || res.status === 503 || challenge) {
      throw new BlockedError(`Bloqueado (HTTP ${res.status}) em ${url}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return html;
  }
  return null;
}

// ─────────────────────── Leitura da página de busca ───────────────────────

const PRICE_RE = /\d{1,3}(?:['’]\d{3})*\.\d{2}/g;

/**
 * Extrai os anúncios da 1ª página de resultados.
 * Cada card é um link <a href="/de/a/titulo-do-anuncio-1330404348/">…</a> com
 * título, preço, "(N Gebote)" e/ou "Sofort kaufen" no texto.
 */
export function parseSearchHtml(html: string): Listing[] {
  const out = new Map<string, Listing>();
  const re = /<a\b[^>]*href="((?:https:\/\/www\.ricardo\.ch)?\/(?:de|fr|it)\/a\/([^"]*?)-(\d{6,})\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const [, href, slug, id, inner] = m;
    const text = htmlToText(inner);
    const prices = [...text.matchAll(PRICE_RE)].map((x) => ({ v: parseChf(x[0])!, at: x.index! }));
    if (prices.length === 0) continue; // link sem preço (ex.: só imagem) — ignora

    const bidsM = text.match(/\((\d+)\s*Gebot(?:e)?\)/i);
    const sofortAt = text.search(/Sofort kaufen/i);
    const priceBefore = (pos: number) => {
      const c = prices.filter((p) => p.at < pos);
      return c.length ? c[c.length - 1].v : null;
    };

    let mode: Mode, price: number | null, buyNowPrice: number | null = null, bids = 0;
    if (bidsM) {
      mode = "auction";
      bids = Number(bidsM[1]);
      price = priceBefore(bidsM.index!);
      if (sofortAt > bidsM.index!) buyNowPrice = priceBefore(sofortAt);
    } else {
      mode = "buynow";
      buyNowPrice = sofortAt >= 0 ? priceBefore(sofortAt) : prices[0].v;
      price = buyNowPrice;
    }
    if (!price) continue;

    // Título: alt da imagem, se existir; senão, reconstruído a partir da URL.
    const alt = inner.match(/alt="([^"]{4,})"/i)?.[1];
    const title = alt && !/icon$/i.test(alt)
      ? decodeEntities(alt)
      : decodeURIComponent(slug).replace(/-/g, " ");

    const prev = out.get(id);
    // O mesmo anúncio pode aparecer em 2 links (imagem + texto): fica o mais completo.
    if (!prev || (prev.bids === 0 && bids > 0) || (!prev.buyNowPrice && buyNowPrice)) {
      out.set(id, {
        id,
        title: title.slice(0, 140),
        url: href.startsWith("http") ? href : RICARDO_BASE + href,
        mode,
        price,
        buyNowPrice,
        bids,
        condition: "Unbekannt",
      });
    }
  }
  return [...out.values()];
}

/** Filtros contra acessórios/peças: preço mínimo e palavras excluídas (no título e na URL). */
export function filterListings(
  listings: Listing[],
  opts: { minPrice?: number; maxPrice?: number; excludeKeywords?: string[] }
): Listing[] {
  const excl = (opts.excludeKeywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  return listings.filter((l) => {
    const ref = l.buyNowPrice ?? l.price;
    if (opts.minPrice && ref < opts.minPrice) return false;
    if (opts.maxPrice && ref > opts.maxPrice) return false;
    const hay = (l.title + " " + l.url).toLowerCase();
    return !excl.some((k) => hay.includes(k));
  });
}

// ─────────────────────── Leitura da página do anúncio ───────────────────────

const MESES: Record<string, number> = {
  jan: 0, feb: 1, mär: 2, mar: 2, apr: 3, mai: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dez: 11,
};

/** Lê condição, status (ativo/encerrado), preço atual, lances e intervalo entre lances. */
export function parseDetailHtml(html: string): ListingDetail {
  const metaDesc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i)?.[1] ?? "";
  const titleTag = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const text = htmlToText(html);

  const condition =
    decodeEntities(metaDesc).match(/Zustand:\s*([^|]+)/i)?.[1].trim() ??
    text.match(/\|\s*Zustand\s*\|\s*([^|]{2,30})\|/i)?.[1].trim() ??
    null;

  const currentPrice =
    parseChf(titleTag.match(/für CHF\s*([\d'’.]+)/i)?.[1] ?? "") ??
    parseChf(decodeEntities(metaDesc).match(/CHF\s*([\d'’.]+)/i)?.[1] ?? "");

  const bids = Number(text.match(/Bisherige Gebote\s*\|?\s*\((\d+)\)/i)?.[1] ?? 0);

  // Datas dos lances: "23. Sep. 2026, 21:44"
  const stamps = [...text.matchAll(/(\d{1,2})\.\s*([A-Za-zäÄ]{3})[a-zä]*\.?\s*(\d{4}),\s*(\d{1,2}):(\d{2})/g)]
    .map((d) => {
      const mo = MESES[d[2].toLowerCase()];
      return mo === undefined ? null : Date.UTC(+d[3], mo, +d[1], +d[4], +d[5]);
    })
    .filter((x): x is number => x !== null);
  const bidSpanHours = stamps.length >= 2
    ? Math.round(((Math.max(...stamps) - Math.min(...stamps)) / 36e5) * 10) / 10
    : null;

  const ended = /Angebot (?:ist )?beendet|Dieses Angebot ist (?:leider )?(?:nicht mehr verfügbar|beendet)|Verkauft am|Auktion beendet/i.test(text);
  const active = /Nächstes Gebot|\|\s*Bieten\s*\||In den Warenkorb|Jetzt kaufen/i.test(text);
  const status: ListingDetail["status"] = ended ? "ended" : active ? "active" : "unknown";

  return { status, condition, currentPrice, bids, bidSpanHours };
}

// ─────────────────────────── Estatística ───────────────────────────

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Remove valores fora de [Q1 − 1.5·IQR, Q3 + 1.5·IQR]. Com menos de 4 valores, não remove nada. */
export function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const s = [...values].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
  return s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

export function statsOf(values: number[]): ModeStats {
  const clean = removeOutliers(values);
  const med = median(clean);
  return {
    count: clean.length,
    median: med === null ? null : Math.round(med * 100) / 100,
    min: clean.length ? Math.min(...clean) : null,
    max: clean.length ? Math.max(...clean) : null,
  };
}

/** Preços de referência por modalidade:
 *  - Leilão: lance atual de leilões com >= AUCTION_MIN_BIDS lances (+ preços finais reais, se houver).
 *  - Sofort-Kaufen: preço fixo de anúncios buynow e de leilões híbridos. */
export function samplesByMode(listings: Listing[], condition?: string) {
  const pool = condition ? listings.filter((l) => l.condition === condition) : listings;
  return {
    auction: pool.filter((l) => l.mode === "auction" && l.bids >= AUCTION_MIN_BIDS).map((l) => l.price),
    buynow: pool.map((l) => l.buyNowPrice).filter((p): p is number => typeof p === "number"),
  };
}

/** Liquidez estimada a partir dos anúncios ativos (funciona desde o 1º dia). */
export function liquidityProxy(listings: Listing[]): LiquidityProxy {
  const auctions = listings.filter((l) => l.mode === "auction");
  if (auctions.length < 3) {
    return { auctions: auctions.length, auctionsWithBidsPct: 0, avgBids: 0, label: "sem_dados" };
  }
  const withBids = auctions.filter((l) => l.bids > 0).length;
  const pct = Math.round((withBids / auctions.length) * 100);
  const avgBids = Math.round((auctions.reduce((a, l) => a + l.bids, 0) / auctions.length) * 10) / 10;
  const label = pct >= 60 && avgBids >= 5 ? "rapido" : pct >= 30 && avgBids >= 2 ? "medio" : "lento";
  return { auctions: auctions.length, auctionsWithBidsPct: pct, avgBids, label };
}

// ─────────────────────── Regra de ouro: Preço Teto ───────────────────────

/**
 * Preço Teto de Compra = Mediana × (1 − taxa) × (1 − margem)
 * taxa: 0.10 (vender no Ricardo) | 0 (venda direta/cash)
 * margem: 0.20 / 0.25 / 0.30 / 0.35 — sobre a receita líquida pós-taxa.
 */
export function ceilingPrice(medianPrice: number, fee: number, margin: number): number {
  return Math.floor(medianPrice * (1 - fee) * (1 - margin));
}
