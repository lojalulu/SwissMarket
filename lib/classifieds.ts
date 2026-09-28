// lib/classifieds.ts — leitura de anúncios classificados (Tutti.ch / Anibis.ch) para o lado da COMPRA.
//
// Regras (robots.txt de ambos, iguais): /de/q/… (pesquisa) e /de/vi/… (anúncio) são permitidos;
// /api/, /user, /de/li/, /de/listings, mensagens e pagamentos não. Nunca entramos em contas nem enviamos mensagens.
//
// Duas fontes de dados por página, como no Ricardo:
//   1. JSON embutido (Next.js __NEXT_DATA__ / cache Apollo): objetos com listingID + title + preço + código postal
//   2. HTML dos cards (plano B): link /de/vi/<id>, "Localidade, 3600, Heute 10:54", "590.-"
import { decodeEntities, htmlToText, zurichToIso } from './parse';
import { parseChf } from './text';

export type BuySource = 'tutti' | 'anibis';

export const BUY_SOURCES: Record<BuySource, { base: string; label: string }> = {
  tutti: { base: 'https://www.tutti.ch', label: 'Tutti' },
  anibis: { base: 'https://www.anibis.ch', label: 'Anibis' },
};

export function isBuySource(s: unknown): s is BuySource {
  return typeof s === 'string' && s in BUY_SOURCES;
}

/** Pesquisa (ordenada pelos mais recentes, que é o padrão do site). */
export function classifiedSearchUrl(source: BuySource, term: string): string {
  return `${BUY_SOURCES[source].base}/de/q/suche?query=${encodeURIComponent(term.trim())}`;
}

export function classifiedUrl(source: BuySource, id: string): string {
  return `${BUY_SOURCES[source].base}/de/vi/${id}`;
}

export interface ClassifiedListing {
  source: BuySource;
  id: string;
  title: string;
  url: string;
  /** CHF; null = "Auf Anfrage", "Gratis", troca… */
  price: number | null;
  zip: string | null;
  place: string | null;
  /** Data de publicação (ISO) quando conhecida. */
  postedAt: string | null;
  image?: string | null;
  description?: string | null;
  sellerName?: string | null;
  from: 'json' | 'html';
}

export interface ClassifiedSeller {
  name: string | null;
  /** Texto original, ex.: "2019" ou "März 2021". */
  memberSince: string | null;
  company: boolean | null;
  verified: boolean | null;
  listings: number | null;
}

export interface ClassifiedDetail {
  id: string;
  /** false = anúncio já não existe (vendido/apagado). */
  active: boolean | null;
  price: number | null;
  zip: string | null;
  place: string | null;
  seller: ClassifiedSeller;
}

// ───────────────────────────── JSON ─────────────────────────────

type Obj = Record<string, unknown>;

function jsonBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*(?:id="__NEXT_DATA__"|type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch { /* bloco inválido */ }
  }
  // window.__APOLLO_STATE__ = {...};
  const ap = html.match(/__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (ap) { try { out.push(JSON.parse(ap[1])); } catch { /* ignora */ } }
  return out;
}

function walk(v: unknown, visit: (o: Obj) => void, depth = 0) {
  if (depth > 40 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) walk(x, visit, depth + 1); return; }
  visit(v as Obj);
  for (const x of Object.values(v as Obj)) walk(x, visit, depth + 1);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function isoFrom(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v === 'string') {
    if (/^\d{10,13}$/.test(v)) return isoFrom(Number(v));
    const d = Date.parse(v);
    if (!isNaN(d) && /\d{4}-\d{2}-\d{2}/.test(v)) return new Date(d).toISOString();
  }
  return null;
}

function imageFrom(o: Obj): string | null {
  const cands = [o.thumbnail, o.image, o.primaryImage, Array.isArray(o.images) ? o.images[0] : undefined];
  for (const c of cands) {
    if (typeof c === 'string' && /^https?:/.test(c)) return c;
    if (c && typeof c === 'object') {
      let found: string | null = null;
      walk(c, (x) => { if (!found) { const s = str(pick(x, ['src', 'url'])); if (s && /^https?:/.test(s)) found = s; } });
      if (found) return found;
    }
  }
  return null;
}

function listingFromJson(o: Obj, source: BuySource): ClassifiedListing | null {
  const id = str(pick(o, ['listingID', 'listingId', 'adId']));
  const title = str(o.title ?? o.subject);
  if (!id || !/^\d{5,}$/.test(id) || !title) return null;
  const priceRaw = pick(o, ['formattedPrice', 'price', 'priceValue']);
  let price: number | null = null;
  if (typeof priceRaw === 'string') price = /gratis|anfrage|tausch/i.test(priceRaw) ? null : parseChf(priceRaw.replace(/\.[-–]\+?$/, '').replace(/\+$/, ''));
  else if (typeof priceRaw === 'number') price = priceRaw > 0 ? priceRaw : null;
  else if (priceRaw && typeof priceRaw === 'object') price = parseChf(str(pick(priceRaw as Obj, ['value', 'amount'])) ?? '');
  const loc = (pick(o, ['postcodeInformation', 'location', 'address']) ?? {}) as Obj;
  const zip = str(pick(loc, ['postcode', 'zipCode', 'zip', 'postalCode'])) ?? str(pick(o, ['postcode', 'zipCode', 'zip']));
  const place = str(pick(loc, ['locationName', 'city', 'town', 'name'])) ?? str(pick(o, ['locationName', 'city']));
  const seller = (pick(o, ['sellerInfo', 'seller', 'user']) ?? {}) as Obj;
  return {
    source, id, title: decodeEntities(title),
    url: classifiedUrl(source, id),
    price, zip: zip && /^\d{4}$/.test(zip) ? zip : null, place,
    postedAt: isoFrom(pick(o, ['timestamp', 'publishedAt', 'createdAt', 'publicationDate', 'date'])),
    image: imageFrom(o),
    description: str(pick(o, ['body', 'description']))?.slice(0, 300) ?? null,
    sellerName: str(pick(seller, ['alias', 'name', 'displayName'])),
    from: 'json',
  };
}

// ───────────────────────────── HTML (plano B) ─────────────────────────────

const LINK_RE = /<a\b[^>]*href="((?:https?:\/\/[^"\/]+)?\/(?:de|fr|it)\/vi\/(?:[^"?#]*\/)?(\d{5,})[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

/** "Heute 10:54" · "Gestern, 18:03" · "26.09.2026" · "26.09.26 18:03" → ISO (hora de Zurique). */
export function parsePosted(text: string, now = new Date()): string | null {
  const zDay = (offsetDays: number) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now.getTime() - offsetDays * 864e5));
    const [y, mo, d] = f.split('-').map(Number);
    return { y, mo: mo - 1, d };
  };
  const hm = text.match(/(\d{1,2}):(\d{2})/);
  const h = hm ? Number(hm[1]) : 12, mi = hm ? Number(hm[2]) : 0;
  if (/\b(heute|aujourd|oggi)/i.test(text)) { const t = zDay(0); return zurichToIso(t.y, t.mo, t.d, h, mi); }
  if (/\b(gestern|hier|ieri)/i.test(text)) { const t = zDay(1); return zurichToIso(t.y, t.mo, t.d, h, mi); }
  const dm = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dm) {
    const y = Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]);
    return zurichToIso(y, Number(dm[2]) - 1, Number(dm[1]), h, mi);
  }
  const ago = text.match(/vor\s+(\d+)\s*(Min|Std|Stunde)/i);
  if (ago) return new Date(now.getTime() - Number(ago[1]) * (/min/i.test(ago[2]) ? 60e3 : 3600e3)).toISOString();
  return null;
}

/** Último preço "590.-" / "1'250.–" / "CHF 590" no texto de um card. */
function priceFromCardText(text: string): { price: number | null; free: boolean } {
  if (/\b(gratis|zu verschenken|gratuit)\b/i.test(text)) return { price: null, free: true };
  const all = [...text.matchAll(/(?:^|[\s|])(\d{1,3}(?:['’]\d{3})+|\d{1,6})\s?\.\s?[-–—]\s?\+?(?=\s|\||$)/g)];
  if (all.length) return { price: parseChf(all[all.length - 1][1]), free: false };
  const chf = [...text.matchAll(/CHF\s*(\d{1,3}(?:['’]\d{3})+|\d{1,6})(?:\.(\d{2}))?/g)];
  if (chf.length) return { price: parseChf(chf[chf.length - 1][1]), free: false };
  return { price: null, free: false };
}

function parseCards(html: string, source: BuySource, now: Date): Map<string, ClassifiedListing> {
  const links: { id: string; href: string; inner: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html))) links.push({ id: m[2], href: m[1], inner: m[3], index: m.index });
  const out = new Map<string, ClassifiedListing>();
  // Cada card = do 1º link desse id até ao 1º link do id seguinte.
  const starts: { id: string; index: number }[] = [];
  for (const l of links) if (!starts.length || starts[starts.length - 1].id !== l.id) starts.push({ id: l.id, index: l.index });
  for (let i = 0; i < starts.length; i++) {
    const { id } = starts[i];
    if (out.has(id)) continue;
    const seg = html.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : starts[i].index + 6000);
    const text = htmlToText(seg);
    const titles = links.filter((l) => l.id === id)
      .map((l) => htmlToText(l.inner).replace(/\s*\|\s*/g, ' ').replace(/\s+\d{1,2}$/, '').trim())
      .filter((t) => t.length >= 3);
    const alt = seg.match(/<img[^>]*alt="([^"]{3,})"/i)?.[1];
    const title = [...titles, ...(alt ? [decodeEntities(alt)] : [])].sort((a, b) => a.length - b.length)[0];
    if (!title) continue;
    const loc = text.match(/([A-Za-zÀ-ÿ.'’\-\/() ]{2,40}),\s*([1-9]\d{3})\b(?:,\s*([^|]{3,40}))?/);
    const { price } = priceFromCardText(text.replace(title, ' '));
    const href = links.find((l) => l.id === id)!.href;
    const img = seg.match(/<img[^>]*src="(https?:[^"]+)"/i)?.[1] ?? null;
    out.set(id, {
      source, id, title,
      url: href.startsWith('http') ? decodeEntities(href) : BUY_SOURCES[source].base + decodeEntities(href),
      price,
      zip: loc?.[2] ?? null,
      place: loc?.[1]?.trim() ?? null,
      postedAt: loc?.[3] ? parsePosted(loc[3], now) : parsePosted(text, now),
      image: img ? decodeEntities(img) : null,
      from: 'html',
    });
  }
  return out;
}

export interface ClassifiedSearchResult {
  items: ClassifiedListing[];
  sources: { json: number; html: number };
}

export function parseClassifiedSearch(html: string, source: BuySource, now = new Date()): ClassifiedSearchResult {
  const cards = parseCards(html, source, now);
  const fromJson = new Map<string, ClassifiedListing>();
  for (const block of jsonBlocks(html)) {
    walk(block, (o) => {
      const l = listingFromJson(o, source);
      if (l && !fromJson.has(l.id)) fromJson.set(l.id, l);
    });
  }
  const items: ClassifiedListing[] = [];
  // Com cards visíveis, só contam os ids que estão na página (evita "anúncios semelhantes" escondidos no JSON).
  const ids = cards.size ? [...cards.keys()] : [...fromJson.keys()];
  for (const id of ids) {
    const j = fromJson.get(id), c = cards.get(id);
    const merged = j && c
      ? { ...c, ...Object.fromEntries(Object.entries(j).filter(([, v]) => v !== null && v !== undefined)), from: 'json' as const }
      : (j ?? c)!;
    items.push(merged as ClassifiedListing);
  }
  return { items, sources: { json: fromJson.size, html: cards.size } };
}

// ───────────────────────────── página do anúncio (vendedor) ─────────────────────────────

const SINCE_RE = /(?:Mitglied|Dabei|Aktiv|Registriert|Auf (?:tutti|anibis)(?:\.ch)?)\s+seit\s*:?\s*((?:\d{1,2}\.\s?)?(?:\d{1,2}\.|[A-Za-zäéû]+\.?)?\s?\d{4})|(?:Membre|Inscrit)\s+depuis\s+(?:le\s+)?([^|]{4,20}\d{4})/i;

export function parseClassifiedDetail(id: string, html: string, status = 200): ClassifiedDetail {
  const seller: ClassifiedSeller = { name: null, memberSince: null, company: null, verified: null, listings: null };
  let price: number | null = null, zip: string | null = null, place: string | null = null;
  if (status === 404 || status === 410) return { id, active: false, price, zip, place, seller };

  for (const block of jsonBlocks(html)) {
    walk(block, (o) => {
      const l = listingFromJson(o, 'tutti');
      if (l && l.id === id) {
        price ??= l.price; zip ??= l.zip; place ??= l.place;
        seller.name ??= l.sellerName ?? null;
      }
      const s = (o.sellerInfo ?? o.seller) as Obj | undefined;
      if (s && typeof s === 'object') {
        seller.name ??= str(pick(s, ['alias', 'name', 'displayName']));
        const since = pick(s, ['memberSince', 'registrationDate', 'createdAt', 'registeredSince', 'since']);
        if (since && !seller.memberSince) seller.memberSince = isoFrom(since)?.slice(0, 4) ?? str(since);
        const comp = pick(s, ['isCompany', 'company', 'isProfessional', 'professional']);
        if (typeof comp === 'boolean') seller.company = comp;
        const ver = pick(s, ['verified', 'isVerified', 'phoneVerified', 'identityVerified']);
        if (typeof ver === 'boolean') seller.verified = ver;
        const n = pick(s, ['numberOfListings', 'listingsCount', 'activeListings', 'numberOfActiveListings']);
        if (typeof n === 'number') seller.listings = n;
      }
    });
  }

  const text = htmlToText(html);
  if (/(Inserat|Anzeige) (ist )?(nicht mehr (verfügbar|aktiv|online)|wurde (gelöscht|entfernt|deaktiviert))|n'est plus disponible|non è più disponibile/i.test(text)) {
    return { id, active: false, price, zip, place, seller };
  }
  const sm = text.match(SINCE_RE);
  if (sm && !seller.memberSince) seller.memberSince = (sm[1] ?? sm[2]).trim();
  if (sm && !seller.name) {
    // O nome costuma vir no bloco imediatamente antes de "Mitglied seit…".
    const before = text.slice(0, sm.index).split('|').map((s) => s.trim()).filter(Boolean);
    const cand = before[before.length - 1];
    if (cand && cand.length >= 2 && cand.length <= 40 && !/kontakt|nachricht|anbieter|verkäufer|inserent|profil/i.test(cand)) seller.name = cand;
  }
  if (seller.verified === null && /\b(verifiziert|verified|vérifié)\b/i.test(text)) seller.verified = true;
  if (seller.company === null && /\b(Firma|Händler|Geschäft|Unternehmen|Gewerblich)\b/.test(text)) seller.company = true;
  const nl = text.match(/(\d{1,4})\s+(?:aktive\s+)?(?:Inserate|Anzeigen|annonces)/i);
  if (nl && seller.listings === null) seller.listings = Number(nl[1]);
  if (!zip) {
    const loc = text.match(/\b([1-9]\d{3})\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ.'’\-\/() ]{1,30})/);
    if (loc) { zip = loc[1]; place = loc[2].trim(); }
  }
  return { id, active: true, price, zip, place, seller };
}

/** Classificação de confiança no vendedor (a regra do Lucas: só perfis visíveis). */
export function sellerTrust(s: ClassifiedSeller | null | undefined): 'visivel' | 'parcial' | 'desconhecido' {
  if (!s || (!s.name && !s.memberSince)) return 'desconhecido';
  return s.name && s.memberSince ? 'visivel' : 'parcial';
}
