// Caminho no repositório: scripts/fetchRicardoData.ts
// SwissMarket Pulse — coleta diária (roda SÓ no GitHub Actions, nunca no celular).
//
// O que faz, por produto de data/products.json:
//   1. Baixa a 1ª página da busca no Ricardo (sem "?", respeitando o robots.txt).
//   2. Filtra acessórios (minPrice / maxPrice / excludeKeywords).
//   3. Abre a página de alguns anúncios novos para descobrir a condição (Zustand).
//   4. Calcula o proxy de liquidez (lances nos leilões ativos).
// E, para o histórico (data/history.json):
//   5. Revisita anúncios que sumiram da busca para saber se foram vendidos e por quanto.
//   6. Calcula a liquidez "confirmada" (vendas reais nos últimos 60 dias).
//
// Segurança dos dados: se um produto falhar, os dados antigos dele são mantidos.
// Se TODOS falharem (ex.: bloqueio da Cloudflare), o script sai com erro e nada é commitado.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  BlockedError, Listing, fetchHtml, parseSearchHtml, parseDetailHtml,
  filterListings, liquidityProxy, median, searchUrl, sleep,
} from "../lib/ricardo";

// ─────────────── Configuração (vem do workflow, com valores padrão) ───────────────
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 4000);   // pausa entre requisições
const RECHECK_MAX = Number(process.env.RECHECK_MAX ?? 40);      // revisitas de sumidos / execução
const DETAIL_MAX = Number(process.env.DETAIL_MAX ?? 15);        // páginas de anúncio novas / produto
const HISTORY_DAYS = 90;                                        // apaga do histórico o que for mais velho
const SOLD_WINDOW_DAYS = 60;                                    // janela da liquidez confirmada
const MIN_SOLD_FOR_CONFIRMED = 5;                               // vendas mínimas para "confirmada"

const PRODUCTS_PATH = "data/products.json";
const HISTORY_PATH = "data/history.json";
const DAY = 86_400_000;

// ─────────────────────────────── Tipos dos arquivos ───────────────────────────────
interface Product {
  id: string;
  name: string;
  searchTerm: string;
  minPrice: number;
  maxPrice?: number;
  excludeKeywords: string[];
  listings: Listing[];
  liquidityProxy?: ReturnType<typeof liquidityProxy>;
  liquidity?: {
    status: "confirmada" | "coletando_dados";
    soldLast60d: number;
    medianDaysToSell: number | null;
    label: "rapido" | "medio" | "lento" | "sem_dados";
  };
  sold?: { price: number; mode: "auction" | "buynow"; condition: string; endedAt: string }[];
  lastScrapeOk?: string;   // última coleta bem-sucedida deste produto
  lastError?: string;
}

interface HistoryEntry {
  productId: string;
  title: string;
  url: string;
  mode: "auction" | "buynow";
  condition: string;
  firstSeen: string;
  lastSeen: string;        // última vez que apareceu na busca
  lastChecked?: string;    // última revisita da página do anúncio
  lastPrice: number;
  buyNowPrice: number | null;
  bids: number;
  bidSpanHours?: number | null;
  status: "active" | "sold" | "unsold" | "ended" | "removed";
  finalPrice?: number;
  endedAt?: string;
}

type History = Record<string, HistoryEntry>;

// ─────────────────────────────────── Helpers ───────────────────────────────────
const nowIso = () => new Date().toISOString();
const jitter = () => DELAY_MS + Math.floor(Math.random() * 1500);
let requests = 0;

async function politeFetch(url: string): Promise<string | null> {
  if (requests++ > 0) await sleep(jitter());
  return fetchHtml(url);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// ──────────────────────────────────── Main ────────────────────────────────────
async function main() {
  const db = readJson<{ updatedAt: string; products: Product[] }>(PRODUCTS_PATH, { updatedAt: "", products: [] });
  const history = readJson<History>(HISTORY_PATH, {});
  if (!db.products.length) throw new Error("data/products.json sem produtos cadastrados.");

  const today = nowIso();
  const okProducts = new Set<string>();
  let blocked = false;

  // ── 1–4: coleta por produto ──
  for (const p of db.products) {
    if (blocked) break;
    try {
      console.log(`\n▶ ${p.name} — busca: "${p.searchTerm}"`);
      const html = await politeFetch(searchUrl(p.searchTerm));
      if (html === null) throw new Error("página de busca não encontrada (404)");

      const raw = parseSearchHtml(html);
      const listings = filterListings(raw, p);
      console.log(`  ${raw.length} anúncios na página, ${listings.length} após filtros`);
      if (raw.length === 0) console.warn("  ⚠ nenhum anúncio lido — o layout do Ricardo pode ter mudado");

      // Condição: reaproveita do histórico; abre a página só dos novos (até DETAIL_MAX)
      let details = 0;
      const spans = new Map<string, number | null>();
      for (const l of listings) {
        const h = history[l.id];
        if (h?.condition && h.condition !== "Unbekannt") { l.condition = h.condition; continue; }
        if (details >= DETAIL_MAX) continue;
        details++;
        const dh = await politeFetch(l.url);
        if (!dh) continue;
        const d = parseDetailHtml(dh);
        if (d.condition) l.condition = d.condition;
        spans.set(l.id, d.bidSpanHours);
      }
      console.log(`  ${details} páginas de anúncio abertas para ler a condição`);

      // Atualiza o histórico
      for (const l of listings) {
        const h = history[l.id];
        history[l.id] = {
          ...(h ?? { firstSeen: today, status: "active" as const }),
          productId: p.id,
          title: l.title,
          url: l.url,
          mode: l.mode,
          condition: l.condition,
          lastSeen: today,
          lastPrice: l.price,
          buyNowPrice: l.buyNowPrice,
          bids: l.bids,
          bidSpanHours: spans.has(l.id) ? spans.get(l.id) : h?.bidSpanHours ?? null,
          status: "active",
        };
      }

      p.listings = listings;
      p.liquidityProxy = liquidityProxy(listings);
      p.lastScrapeOk = today;
      delete p.lastError;
      okProducts.add(p.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✖ ${p.name}: ${msg} (dados anteriores mantidos)`);
      p.lastError = `${today}: ${msg}`;
      if (e instanceof BlockedError) blocked = true; // bloqueado: para tudo, não insiste
    }
  }

  if (okProducts.size === 0) {
    console.error("\n✖ Nenhum produto coletado com sucesso. Abortando sem gravar nada.");
    process.exit(1);
  }

  // ── 5: revisita anúncios que sumiram da 1ª página de busca ──
  const candidates = Object.entries(history)
    .filter(([, h]) => h.status === "active" && h.lastSeen !== today && okProducts.has(h.productId))
    .sort(([, a], [, b]) => (a.lastChecked ?? "").localeCompare(b.lastChecked ?? "")) // os menos revisitados primeiro
    .slice(0, blocked ? 0 : RECHECK_MAX);

  console.log(`\n▶ Revisitando ${candidates.length} anúncio(s) que sumiram da busca`);
  for (const [id, h] of candidates) {
    try {
      const html = await politeFetch(h.url);
      h.lastChecked = today;
      if (html === null) { h.status = "removed"; h.endedAt = today; continue; }
      const d = parseDetailHtml(html);
      if (d.condition && h.condition === "Unbekannt") h.condition = d.condition;
      if (d.status !== "ended") continue; // ainda ativo (só saiu da 1ª página) ou incerto

      h.endedAt = today;
      const bids = Math.max(d.bids, h.bids);
      if (h.mode === "auction") {
        h.status = bids > 0 ? "sold" : "unsold";
        if (bids > 0) h.finalPrice = d.currentPrice ?? h.lastPrice;
      } else {
        // Preço fixo encerrado: pode ser venda ou retirada. Contamos como venda provável.
        h.status = "sold";
        h.finalPrice = h.buyNowPrice ?? h.lastPrice;
      }
      console.log(`  ${id}: ${h.status}${h.finalPrice ? " por CHF " + h.finalPrice : ""}`);
    } catch (e) {
      console.error(`  ✖ revisita ${id}: ${e instanceof Error ? e.message : e}`);
      if (e instanceof BlockedError) break;
    }
  }

  // ── 6: liquidez confirmada + vendas reais por produto ──
  const now = Date.now();
  for (const p of db.products) {
    const sold = Object.values(history).filter(
      (h) => h.productId === p.id && h.status === "sold" && h.endedAt &&
        now - Date.parse(h.endedAt) <= SOLD_WINDOW_DAYS * DAY
    );
    const days = sold.map((h) => (Date.parse(h.endedAt!) - Date.parse(h.firstSeen)) / DAY);
    const medDays = median(days);
    const confirmed = sold.length >= MIN_SOLD_FOR_CONFIRMED && medDays !== null;

    p.sold = sold
      .sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))
      .slice(0, 100)
      .map((h) => ({ price: h.finalPrice!, mode: h.mode, condition: h.condition, endedAt: h.endedAt! }));

    p.liquidity = {
      status: confirmed ? "confirmada" : "coletando_dados",
      soldLast60d: sold.length,
      medianDaysToSell: medDays === null ? null : Math.round(medDays * 10) / 10,
      label: !confirmed ? "sem_dados" : medDays! <= 5 ? "rapido" : medDays! <= 14 ? "medio" : "lento",
    };
  }

  // Limpa histórico antigo
  for (const [id, h] of Object.entries(history)) {
    if (now - Date.parse(h.lastSeen) > HISTORY_DAYS * DAY) delete history[id];
  }

  db.updatedAt = today;
  writeFileSync(PRODUCTS_PATH, JSON.stringify(db, null, 2) + "\n");
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  console.log(`\n✔ Concluído: ${okProducts.size}/${db.products.length} produtos, ${requests} requisições.`);
}

main().catch((e) => {
  console.error("✖ Erro fatal:", e);
  process.exit(1);
});
