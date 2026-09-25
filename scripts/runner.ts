// scripts/runner.ts — recolha no Ricardo.ch a partir do telemóvel (Termux + Chromium) → API da VPS.
//
// Uso:
//   npx tsx scripts/runner.ts                     # 1 ciclo completo (pesquisa + verificação de vendas)
//   npx tsx scripts/runner.ts --loop 180          # repete a cada ~180 min (com variação aleatória)
//   npx tsx scripts/runner.ts --only iphone-13,ps5
//   npx tsx scripts/runner.ts --inspect "iphone 13 128gb"   # diagnóstico: grava o HTML e mostra o que foi lido
//   npx tsx scripts/runner.ts --inspect https://www.ricardo.ch/de/a/...   # diagnóstico de um anúncio
//   npx tsx scripts/runner.ts --dry-run           # não envia nada para a VPS
//   npx tsx scripts/runner.ts --recheck           # tenta abrir anúncios terminados (a Cloudflare costuma bloquear)
//   npx tsx scripts/runner.ts --no-closing        # não espreita leilões antes do fim entre ciclos
//
// Configuração: ficheiro .env na raiz (ver .env.example) ou variáveis de ambiente.
//
// Porquê a verificação de vendas? Os preços pedidos NÃO são preços de mercado. O que interessa
// para revenda é o preço FINAL dos leilões que terminaram com lances e os "Sofort kaufen" que
// foram comprados. O runner reabre esses anúncios (páginas /de/a/…, permitidas no robots.txt)
// e a VPS regista a venda confirmada.

import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type HTTPResponse, type Page } from 'puppeteer-core';
import { activeProducts, getProduct, type ProductConfig } from '../config/products';
import { isChallengePage, parseDetailPage, parseRscText, parseSearchPage, searchUrl } from '../lib/parse';
import { checkRelevance } from '../lib/text';
import type { DetailSignals, IngestPayload, ScrapedListing } from '../lib/types';

const VERSION = '3.3.0';
const ROOT = path.resolve(__dirname, '..');

// ───────────────────────────── configuração ─────────────────────────────

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const CFG = {
  apiUrl: (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://188.245.76.183:3000').replace(/\/+$/, ''),
  token: process.env.INGEST_TOKEN || '',
  chromium: process.env.CHROMIUM_PATH || '',
  delayMs: Number(process.env.DELAY_MS || 7000),
  recheckMax: Number(process.env.RECHECK_MAX || 25),
  navTimeout: Number(process.env.NAV_TIMEOUT_MS || 45000),
  // 1 = Chromium novo a cada página. Observado no Ricardo: a 1ª página de um browser novo passa
  // sem desafio; navegar de novo no mesmo browser dispara a Cloudflare.
  restartEvery: Number(process.env.RESTART_BROWSER_EVERY || 1),
  singleProcess: (process.env.SINGLE_PROCESS ?? '1') !== '0',
  loopMinutes: Number(opt('loop') ?? process.env.LOOP_MINUTES ?? 0),
  only: (opt('only') ?? process.env.PRODUCTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  dryRun: flag('dry-run'),
  // Páginas de anúncio estão sempre atrás da Cloudflare → verificação direta desligada por omissão (--recheck liga).
  recheck: flag('recheck'),
  // Espreitar leilões ~10 min antes do fim, entre ciclos (--no-closing desliga).
  closing: !flag('no-closing'),
  // Quantos minutos antes do fim fazer a leitura final (o Chromium do telemóvel precisa de ~30 s).
  closingLeadMs: Number(process.env.CLOSING_LEAD_MIN || 4) * 60e3,
  inspect: opt('inspect'),
  debugDir: path.join(ROOT, 'data', 'debug'),
  // Perfil antigo (v2.0.1) — apagado ao arrancar: um perfil reutilizado era MAIS bloqueado.
  oldProfileDir: path.join(ROOT, 'data', 'chrome-profile'),
  outboxDir: path.join(ROOT, 'data', 'outbox'),
};

const CHROMIUM_CANDIDATES = [
  '/data/data/com.termux/files/usr/bin/chromium-browser',
  '/data/data/com.termux/files/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium',
];

// ───────────────────────────── utilidades ─────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => Math.round(ms * (0.7 + Math.random() * 0.6));
const ts = () => new Date().toLocaleTimeString('de-CH');
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);
const warn = (...a: unknown[]) => console.warn(`[${ts()}] ⚠️ `, ...a);

function chromiumPath(): string {
  if (CFG.chromium) return CFG.chromium;
  const found = CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chromium não encontrado. Defina CHROMIUM_PATH no .env (Termux: pkg install chromium).');
  return found;
}

// Recursos inúteis para ler preços (poupa dados móveis e memória do telemóvel).
const BLOCK_TYPES = new Set(['image', 'media', 'font']);
const BLOCK_HOSTS = /googletagmanager|google-analytics|doubleclick|googlesyndication|adservice|criteo|facebook|hotjar|taboola|outbrain|adnxs|onetrust\.com\/.*logos|bing\.com|tiktok|pinterest|snapchat|yieldlove|amazon-adsystem/i;

// ───────────────────────────── browser ─────────────────────────────

class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private uses = 0;
  private cookiesAccepted = false;

  constructor(private maxUses = CFG.restartEvery) {}

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.browser?.connected && this.uses < this.maxUses) {
      this.uses++;
      return this.page;
    }
    await this.close();
    const exe = chromiumPath();
    this.browser = await puppeteer.launch({
      executablePath: exe,
      headless: true,
      protocolTimeout: 120_000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-software-rasterizer', '--no-first-run', '--no-zygote', '--mute-audio',
        '--disable-extensions', '--disable-background-networking', '--disable-sync',
        '--blink-settings=imagesEnabled=false', '--lang=de-CH', '--window-size=1366,900',
        ...(CFG.singleProcess ? ['--single-process'] : []),
      ],
    });
    const page = await this.browser.newPage();
    const ua = (await this.browser.userAgent()).replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6' });
    await page.setViewport({ width: 1366, height: 900 });
    page.setDefaultNavigationTimeout(CFG.navTimeout);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (BLOCK_TYPES.has(req.resourceType()) || BLOCK_HOSTS.test(req.url())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    this.page = page;
    this.uses = 1;
    this.cookiesAccepted = false;
    return page;
  }

  async acceptCookies(page: Page) {
    if (this.cookiesAccepted) return;
    try {
      const btn = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 2500 });
      await btn?.click();
      this.cookiesAccepted = true;
      await sleep(600);
    } catch { /* sem banner */ }
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.page = null;
    if (!b) return;
    // No Termux o browser.close() às vezes fica pendurado → máximo 8 s, depois mata o processo.
    const closed = await Promise.race([b.close().then(() => true, () => false), sleep(8000).then(() => false)]);
    if (!closed) { try { b.process()?.kill('SIGKILL'); } catch { /* já morreu */ } }
  }
}

type LoadResult = { html: string; status: number; finalUrl: string; challenge: boolean };

async function load(session: BrowserSession, url: string, waitForCards: boolean): Promise<LoadResult> {
  const page = await session.getPage();
  let resp: HTTPResponse | null = null;
  resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.navTimeout });
  const status = resp?.status() ?? 0;

  // Desafio Cloudflare: o Chromium real costuma resolvê-lo sozinho em alguns segundos.
  let html = await page.content();
  if (isChallengePage(html)) {
    log('   🛡️  Desafio Cloudflare — a aguardar (até 30 s)…');
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      await sleep(1500);
      try {
        html = await page.content();
        if (!isChallengePage(html)) break;
      } catch { /* a página está a recarregar (o desafio faz isso) — tenta de novo */ }
    }
    await sleep(1500);
    try { html = await page.content(); } catch { /* ignora */ }
    if (isChallengePage(html)) return { html, status, finalUrl: page.url(), challenge: true };
    log('   ✅ Desafio resolvido.');
  }

  await session.acceptCookies(page);
  if (waitForCards) {
    await page.waitForSelector('a[href*="/a/"]', { timeout: 15_000 }).catch(() => {});
    // Scroll em passos para disparar lazy-loading dos cards.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await sleep(800);
  } else {
    await sleep(1500);
  }
  html = await page.content();
  return { html, status, finalUrl: page.url(), challenge: isChallengePage(html) };
}

// ───────────────────────────── API da VPS (com fila offline) ─────────────────────────────

async function api<T>(method: 'GET' | 'POST', p: string, body?: unknown, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${CFG.apiUrl}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(CFG.token ? { 'x-ingest-token': CFG.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { throw new Error(`Resposta não-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`); }
      if (res.status === 401) throw Object.assign(new Error('Token inválido (INGEST_TOKEN diferente na VPS e no telemóvel).'), { fatal: true });
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      return json as T;
    } catch (e: any) {
      lastErr = e;
      if (e?.fatal) break;
      if (i < attempts - 1) await sleep(3000 * (i + 1));
    }
  }
  throw lastErr;
}

function queueOffline(kind: 'ingest' | 'details', body: unknown) {
  fs.mkdirSync(CFG.outboxDir, { recursive: true });
  const f = path.join(CFG.outboxDir, `${Date.now()}-${kind}.json`);
  fs.writeFileSync(f, JSON.stringify({ kind, body }));
  warn(`VPS inacessível — guardado em ${path.relative(ROOT, f)} (reenvio automático no próximo ciclo).`);
}

async function flushOutbox() {
  if (!fs.existsSync(CFG.outboxDir)) return;
  const files = fs.readdirSync(CFG.outboxDir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return;
  log(`📮 A reenviar ${files.length} envio(s) pendente(s)…`);
  for (const f of files) {
    const full = path.join(CFG.outboxDir, f);
    try {
      const { kind, body } = JSON.parse(fs.readFileSync(full, 'utf8'));
      await api('POST', kind === 'ingest' ? '/api/ingest' : '/api/ingest/details', body, 2);
      fs.unlinkSync(full);
    } catch (e) {
      warn(`Ainda sem ligação à VPS (${(e as Error).message}). Fica para o próximo ciclo.`);
      return;
    }
  }
}

// ───────────────────────────── pesquisa ─────────────────────────────

let consecutiveBlocks = 0;

async function scrapeTerm(session: BrowserSession, term: string): Promise<{ items: ScrapedListing[]; ok: boolean }> {
  const url = searchUrl(term);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await load(session, url, true);
      if (res.challenge) {
        consecutiveBlocks++;
        warn(`Bloqueado pela Cloudflare (tentativa ${attempt}).`);
        await session.close(); // browser novo = nova tentativa limpa
        await sleep(jitter(15_000 * attempt));
        continue;
      }
      consecutiveBlocks = 0;
      if (res.status === 404) return { items: [], ok: true };
      const parsed = parseSearchPage(res.html);
      if (parsed.items.length === 0) {
        fs.mkdirSync(CFG.debugDir, { recursive: true });
        const f = path.join(CFG.debugDir, `vazio-${term.replace(/\W+/g, '_')}.html`);
        fs.writeFileSync(f, res.html);
        warn(`0 anúncios lidos (HTTP ${res.status}). HTML guardado em ${path.relative(ROOT, f)} para diagnóstico.`);
        if (attempt < 3) { await sleep(jitter(8000)); continue; }
        return { items: [], ok: false };
      }
      log(`   fontes → next-data:${parsed.sources.nextData} json-ld:${parsed.sources.ldJson} cards:${parsed.sources.html}`);
      return { items: parsed.items, ok: true };
    } catch (e) {
      warn(`Erro a carregar "${term}" (tentativa ${attempt}): ${(e as Error).message}`);
      await session.close(); // recomeça com browser limpo (resolve "Target closed"/"Session closed")
      await sleep(jitter(10_000 * attempt));
    }
  }
  return { items: [], ok: false };
}

interface Summary { product: string; found: number; relevant: number; newCount: number; status: string }

async function scrapeProduct(session: BrowserSession, p: ProductConfig): Promise<Summary> {
  const terms = [p.searchTerm, ...(p.extraSearchTerms ?? [])];
  const all = new Map<string, ScrapedListing>();
  let complete = true;
  for (const [i, term] of terms.entries()) {
    if (i > 0) await sleep(jitter(CFG.delayMs));
    log(`🔍 ${p.name} — "${term}"`);
    const { items, ok } = await scrapeTerm(session, term);
    complete &&= ok;
    for (const it of items) if (!all.has(it.id)) all.set(it.id, it);
  }
  const items = [...all.values()];
  const localRelevant = items.filter((it) => checkRelevance(it.title, it.url, p).relevant).length;
  const withBids = items.filter((it) => it.bids > 0).length;
  log(`   📦 ${items.length} anúncios (${localRelevant} relevantes pelo título, ${withBids} com lances)`);

  if (!items.length) return { product: p.name, found: 0, relevant: 0, newCount: 0, status: complete ? 'sem resultados' : 'FALHOU' };

  const payload: IngestPayload = {
    productId: p.id, searchTerm: p.searchTerm, scrapedAt: new Date().toISOString(),
    items, complete, runnerVersion: VERSION,
  };
  if (CFG.dryRun) {
    for (const it of items.slice(0, 5)) log(`     · ${it.title.slice(0, 60)} | bid ${it.bidPrice ?? '—'} (${it.bids}) | sofort ${it.buyNowPrice ?? '—'} | fim ${it.endDate ?? '—'}`);
    return { product: p.name, found: items.length, relevant: localRelevant, newCount: 0, status: 'dry-run' };
  }
  try {
    const r = await api<{ relevant: number; new: number; alerts?: number; rejected: { reason: string; count: number }[] }>('POST', '/api/ingest', payload);
    const rej = r.rejected.slice(0, 3).map((x) => `${x.reason}×${x.count}`).join(', ');
    log(`   ✅ VPS: ${r.relevant} relevantes, ${r.new} novos${rej ? ` · rejeitados: ${rej}` : ''}${r.alerts && r.alerts > 0 ? ` · 🔔 ${r.alerts} alerta(s) enviado(s)` : ''}`);
    return { product: p.name, found: items.length, relevant: r.relevant, newCount: r.new, status: 'ok' };
  } catch (e) {
    if ((e as any)?.fatal) throw e;
    queueOffline('ingest', payload);
    return { product: p.name, found: items.length, relevant: localRelevant, newCount: 0, status: 'em fila' };
  }
}


// ───────────────────────────── abrir anúncio "à maneira humana" ─────────────────────────────
//
// Abrir /de/a/… diretamente (goto) dispara a Cloudflare. Mas uma pessoa normalmente chega ao anúncio
// A PARTIR da pesquisa, e o site do Ricardo navega "por dentro" (navegação do Next.js, sem recarregar
// a página). Fazemos o mesmo: abrimos 1 pesquisa (que passa) e depois navegamos por dentro até cada anúncio.

type DetailOpen = { html: string; finalUrl: string; status: number; challenge: boolean; roots: unknown[]; method: 'app' | 'goto' };

class DetailNavigator {
  private session = new BrowserSession(10_000);
  private warmed = false;

  async open(item: { productId: string; id: string; url: string }): Promise<DetailOpen> {
    if (!this.warmed) {
      const term = getProduct(item.productId)?.searchTerm ?? 'iphone';
      const res = await load(this.session, searchUrl(term), true);
      if (res.challenge) return { ...res, roots: [], method: 'app' };
      this.warmed = true;
      await sleep(jitter(3000));
    }
    const page = await this.session.getPage();
    const bodies: string[] = [];
    const onResp = async (resp: HTTPResponse) => {
      const ct = resp.headers()['content-type'] ?? '';
      if (ct.includes('text/x-component') || (resp.url().includes(item.id) && resp.request().resourceType() !== 'document')) {
        try { bodies.push(await resp.text()); } catch { /* resposta sem corpo */ }
      }
    };
    page.on('response', onResp);
    try {
      const path = new URL(item.url).pathname;
      const pushed = await page.evaluate((p: string) => {
        const n = (window as any).next;
        if (n?.router?.push) { n.router.push(p); return true; }
        return false;
      }, path).catch(() => false);

      if (!pushed) {
        const res = await load(this.session, item.url, false);
        return { ...res, roots: [], method: 'goto' };
      }
      await page.waitForFunction((id: string) => location.pathname.includes(id), { timeout: 15_000 }, item.id).catch(() => {});
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 12_000 }).catch(() => {});
      await sleep(1000);
      const html = await page.content();
      return {
        html, finalUrl: page.url(), status: 200, challenge: isChallengePage(html),
        roots: bodies.flatMap((b) => parseRscText(b)), method: 'app',
      };
    } finally {
      page.off('response', onResp);
    }
  }

  async close() { await this.session.close(); this.warmed = false; }
}

// ───────────────────────────── verificação de vendas ─────────────────────────────

async function recheckPhase(session: BrowserSession) {
  let queue: { productId: string; id: string; url: string }[] = [];
  try {
    queue = (await api<{ items: typeof queue }>('GET', `/api/recheck?limit=${CFG.recheckMax}`)).items;
  } catch (e) {
    if ((e as any)?.fatal) throw e;
    warn(`Não consegui obter a fila de verificação: ${(e as Error).message}`);
    return;
  }
  if (!queue.length) { log('🔁 Nada para verificar.'); return; }
  log(`🔁 A verificar ${queue.length} anúncio(s) terminados/desaparecidos…`);

  const results: (DetailSignals & { productId: string })[] = [];
  const flush = async () => {
    if (!results.length) return;
    const batch = results.splice(0);
    try {
      const r = await api<{ sold: number; unsold: number; stillActive: number; unknown: number }>('POST', '/api/ingest/details', { results: batch });
      log(`   ✅ VPS: ${r.sold} vendidos · ${r.unsold} sem venda · ${r.stillActive} ainda ativos · ${r.unknown} indeterminados`);
    } catch (e) {
      if ((e as any)?.fatal) throw e;
      queueOffline('details', { results: batch });
    }
  };

  const nav = new DetailNavigator();
  try {
    for (const item of queue) {
      if (consecutiveBlocks >= 2) { warn('Cloudflare a bloquear as páginas de anúncio — verificação adiada para o próximo ciclo.'); break; }
      try {
        const res = await nav.open(item);
        if (res.challenge) {
          consecutiveBlocks++;
          log(`   · ${item.id} → bloqueado pela Cloudflare (${res.method})`);
          await nav.close();
          await sleep(jitter(20_000));
          continue;
        }
        consecutiveBlocks = 0;
        const sig: DetailSignals = res.status === 404 || res.status === 410
          ? { id: item.id, removed: true, ended: true, soldMarker: false, bids: null, currentPrice: null, buyNowPrice: null, condition: null, endDate: null }
          : parseDetailPage(item.id, res.html, res.finalUrl, res.roots);
        const label = sig.removed ? 'removido' : sig.ended === true ? (sig.soldMarker || (sig.bids ?? 0) > 0 ? 'terminou (vendido?)' : 'terminou') : sig.ended === false ? 'ativo' : '?';
        log(`   · ${item.id} → ${label}${sig.currentPrice ? ` @ CHF ${sig.currentPrice}` : ''}${sig.bids !== null ? ` (${sig.bids} lances)` : ''} [${res.method}]`);
        if (label === '?') {
          fs.mkdirSync(CFG.debugDir, { recursive: true });
          fs.writeFileSync(path.join(CFG.debugDir, `anuncio-${item.id}.html`), res.html);
        }
        results.push({ ...sig, productId: item.productId });
        if (results.length >= 10) await flush();
      } catch (e) {
        warn(`Falha ao abrir ${item.url}: ${(e as Error).message}`);
        await nav.close();
      }
      await sleep(jitter(CFG.delayMs * 0.7));
    }
  } finally {
    await nav.close();
  }
  await flush();
}

// ───────────────────────────── modo diagnóstico ─────────────────────────────

async function inspect(term: string) {
  const session = new BrowserSession();
  try {
    // --inspect https://www.ricardo.ch/de/a/...  → diagnóstico da página de UM anúncio
    if (/^https?:\/\//.test(term)) {
      const id = term.match(/-(\d{6,})\/?/)?.[1] ?? 'x';
      const productId = CFG.only[0] ?? activeProducts()[0].id;
      const nav = new DetailNavigator();
      const res = await nav.open({ productId, id, url: term });
      await nav.close();
      fs.mkdirSync(CFG.debugDir, { recursive: true });
      const f = path.join(CFG.debugDir, `inspect-anuncio-${id}.html`);
      fs.writeFileSync(f, res.html);
      log(`método: ${res.method} · desafio: ${res.challenge ? 'SIM' : 'não'} · RSC capturado: ${res.roots.length} blocos → ${path.relative(ROOT, f)}`);
      console.log(parseDetailPage(id, res.html, res.finalUrl, res.roots));
      return;
    }
    log(`🧪 Diagnóstico de "${term}" → ${searchUrl(term)}`);
    const res = await load(session, searchUrl(term), true);
    fs.mkdirSync(CFG.debugDir, { recursive: true });
    const f = path.join(CFG.debugDir, `inspect-${term.replace(/\W+/g, '_')}.html`);
    fs.writeFileSync(f, res.html);
    log(`HTTP ${res.status} · desafio Cloudflare: ${res.challenge ? 'SIM' : 'não'} · ${Math.round(res.html.length / 1024)} KB → ${path.relative(ROOT, f)}`);
    const parsed = parseSearchPage(res.html);
    log(`Fontes: next-data=${parsed.sources.nextData} json-ld=${parsed.sources.ldJson} cards=${parsed.sources.html} → ${parsed.items.length} anúncios`);
    const product = activeProducts().find((p) => p.searchTerm === term) ?? activeProducts()[0];
    for (const it of parsed.items.slice(0, 15)) {
      const rel = checkRelevance(it.title, it.url, product);
      console.log(`  ${rel.relevant ? '✔' : '✘'} [${it.mode.padEnd(6)}] bid=${String(it.bidPrice ?? '—').padStart(7)} (${String(it.bids).padStart(2)}) sofort=${String(it.buyNowPrice ?? '—').padStart(7)} fim=${it.endDate?.slice(0, 16) ?? '—'} | ${it.title.slice(0, 55)}${rel.reason ? `  ← ${rel.reason}` : ''}`);
    }
  } finally {
    await session.close();
  }
}

// ───────────────────────────── ciclo ─────────────────────────────

async function cycle() {
  const products = CFG.only.length
    ? CFG.only.map((id) => getProduct(id)).filter((p): p is ProductConfig => !!p)
    : activeProducts();
  log(`🚀 SwissMarket runner v${VERSION} — ${products.length} produtos → ${CFG.apiUrl}${CFG.dryRun ? ' (dry-run)' : ''}`);
  if (!CFG.token && !CFG.dryRun) warn('INGEST_TOKEN vazio: funciona só se a VPS também não tiver token.');

  try { fs.rmSync(CFG.oldProfileDir, { recursive: true, force: true }); } catch { /* ignora */ }
  if (!CFG.dryRun) await flushOutbox();
  const session = new BrowserSession();
  const summary: Summary[] = [];
  const started = Date.now();
  try {
    // Verificação de vendas PRIMEIRO: no início do ciclo o IP está "frio" e a Cloudflare deixa passar.
    // (No fim de 30+ páginas seguidas, as páginas de anúncio passaram a pedir desafio.)
    if (CFG.recheck && !CFG.dryRun) {
      await recheckPhase(session);
      consecutiveBlocks = 0;
      await session.close();
      await sleep(jitter(CFG.delayMs));
    }
    for (const [i, p] of products.entries()) {
      if (consecutiveBlocks >= 3) {
        warn('3 bloqueios seguidos — pausa de 10 min antes de continuar.');
        await session.close();
        await sleep(10 * 60e3);
        consecutiveBlocks = 0;
      }
      summary.push(await scrapeProduct(session, p));
      if (i < products.length - 1) await sleep(jitter(CFG.delayMs));
    }
  } finally {
    await session.close();
  }

  console.log('\n┌──────────────────────────────── Resumo ────────────────────────────────');
  for (const s of summary) {
    console.log(`│ ${s.product.padEnd(30)} ${String(s.found).padStart(4)} lidos ${String(s.relevant).padStart(4)} relevantes ${String(s.newCount).padStart(3)} novos  ${s.status}`);
  }
  console.log(`└─ ${Math.round((Date.now() - started) / 1000)} s · dashboard: ${CFG.apiUrl}\n`);
}

// ───────────────────────────── espreitar leilões antes do fim ─────────────────────────────
//
// Entre ciclos, para cada leilão com lances que acaba antes do próximo ciclo, o runner relê a pesquisa
// desse produto ~10 min antes do fim. O lance visto nessa altura ≈ preço final (sem abrir o anúncio,
// que a Cloudflare bloqueia). Leilões que terminam juntos (±20 min) partilham a mesma leitura.

async function closingWatch(until: number, stopped: () => boolean) {
  let items: { productId: string; id: string; endDate: string; bids: number }[] = [];
  try {
    const within = Math.ceil((until - Date.now()) / 60e3) + 15;
    items = (await api<{ items: typeof items }>('GET', `/api/closing?within=${within}`)).items;
  } catch (e) {
    warn(`Espreitar leilões: sem lista (${(e as Error).message})`);
    return;
  }
  // Agrupa por produto: leilões que acabam até 6 min depois do 1º do grupo partilham a mesma leitura.
  type Slot = { productId: string; firstEnd: number; lastEnd: number; count: number; maxBids: number; at: number; followUp: boolean };
  const slots: Slot[] = [];
  for (const it of items.sort((a, b) => a.endDate.localeCompare(b.endDate))) {
    const end = new Date(it.endDate).getTime();
    const s = slots.find((x) => x.productId === it.productId && !x.followUp && end - x.firstEnd <= 6 * 60e3);
    if (s) { s.count++; s.lastEnd = Math.max(s.lastEnd, end); s.maxBids = Math.max(s.maxBids, it.bids); }
    else slots.push({ productId: it.productId, firstEnd: end, lastEnd: end, count: 1, maxBids: it.bids, at: end - CFG.closingLeadMs, followUp: false });
  }
  const plan = slots.slice(0, 30);
  if (!plan.length) return;
  log(`⏱  ${items.length} leilão(ões) acabam antes do próximo ciclo → ${plan.length} leitura(s) agendada(s) ~${Math.round(CFG.closingLeadMs / 60e3)} min antes do fim`);

  const peek = async (slot: Slot) => {
    const p = getProduct(slot.productId);
    if (!p) return;
    log(`⏱  ${p.name}: ${slot.count} leilão(ões) ${slot.followUp ? 'prolongado(s)? — 2ª leitura' : 'a acabar — leitura final'}…`);
    const session = new BrowserSession();
    try { await scrapeProduct(session, { ...p, extraSearchTerms: [] }); }
    catch (e) { warn(`Leitura falhou: ${(e as Error).message}`); }
    finally { await session.close(); }
  };

  while (plan.length) {
    plan.sort((a, b) => a.at - b.at);
    const slot = plan.shift()!;
    while (!stopped() && Date.now() < slot.at) await sleep(3000);
    if (stopped() || Date.now() > until) return;
    await peek(slot);
    // Leilão disputado: no Ricardo, um lance nos últimos 3 min prolonga +3 min (repetidamente).
    // 2ª leitura logo após o fim previsto: se ainda aparecer na pesquisa, apanhamos o lance mais recente.
    if (!slot.followUp && slot.maxBids >= 5) {
      plan.push({ ...slot, followUp: true, at: slot.lastEnd + 2 * 60e3 });
    }
  }
}

async function main() {
  if (CFG.inspect) return inspect(CFG.inspect);
  let stop = false;
  process.on('SIGINT', () => { if (stop) process.exit(1); stop = true; log('⏹  A terminar depois deste passo (Ctrl+C de novo para sair já)…'); });

  do {
    try {
      await cycle();
    } catch (e) {
      console.error(`[${ts()}] ❌ Erro fatal no ciclo:`, (e as Error).message);
      if ((e as any)?.fatal) process.exit(1);
    }
    if (!CFG.loopMinutes || stop) break;
    const wait = jitter(CFG.loopMinutes * 60e3);
    log(`😴 Próximo ciclo às ${new Date(Date.now() + wait).toLocaleTimeString('de-CH')}`);
    const until = Date.now() + wait;
    if (CFG.closing && !CFG.dryRun) await closingWatch(until, () => stop);
    while (!stop && Date.now() < until) await sleep(5000);
  } while (!stop);
}

main();
