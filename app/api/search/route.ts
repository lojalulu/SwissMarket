// Caminho no repositório: app/api/search/route.ts
// SwissMarket Pulse — "Buscar agora": consulta o Ricardo.ch AO VIVO para qualquer produto.
// Uso: /api/search?q=macbook air m1&min=250&max=1000&exclude=defekt,kaputt
// No Netlify, esta rota vira automaticamente uma função serverless.
//
// Faz UMA única requisição ao Ricardo por busca (1ª página, sem "?" na URL do Ricardo),
// para responder rápido (limite de ~10 s das funções grátis) e respeitar o site.
// Por isso a condição (Zustand) não é lida aqui: as medianas são por modalidade.

import { NextRequest, NextResponse } from "next/server";
import {
  BlockedError, fetchHtml, filterListings, liquidityProxy,
  parseSearchHtml, samplesByMode, searchUrl, statsOf,
} from "../../../lib/ricardo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cache curto em memória: repetir a mesma busca em 10 min não gera nova visita ao Ricardo.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

// Intervalo mínimo entre consultas ao Ricardo (proteção contra toques repetidos).
const MIN_GAP_MS = 3000;
let lastCall = 0;

const DEFAULT_EXCLUDE = ["defekt", "kaputt", "ersatzteil", "bastler", "replika", "replica", "fake"];

function num(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().replace(/\s+/g, " ");

  if (q.length < 2 || q.length > 80) {
    return NextResponse.json({ error: "Digite entre 2 e 80 caracteres." }, { status: 400 });
  }

  const minPrice = num(sp.get("min"));
  const maxPrice = num(sp.get("max"));
  const extra = (sp.get("exclude") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const excludeKeywords = [...new Set([...DEFAULT_EXCLUDE, ...extra])];

  const key = JSON.stringify([q.toLowerCase(), minPrice, maxPrice, excludeKeywords]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({ ...(hit.body as object), cached: true });
  }

  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) {
    return NextResponse.json(
      { error: `Aguarde ${Math.ceil(wait / 1000)} s antes de uma nova busca.` },
      { status: 429 }
    );
  }
  lastCall = Date.now();

  try {
    const html = await fetchHtml(searchUrl(q), 0);
    if (html === null) {
      return NextResponse.json({ error: "Busca não encontrada no Ricardo." }, { status: 404 });
    }

    const raw = parseSearchHtml(html);
    const listings = filterListings(raw, { minPrice, maxPrice, excludeKeywords });
    const samples = samplesByMode(listings);

    const body = {
      query: q,
      source: searchUrl(q),
      fetchedAt: new Date().toISOString(),
      totalOnPage: raw.length,
      used: listings.length,
      stats: {
        auction: statsOf(samples.auction), // piso: liquidação rápida
        buynow: statsOf(samples.buynow),   // teto: margem máxima
      },
      liquidity: { ...liquidityProxy(listings), status: "estimada" as const },
      listings: listings
        .sort((a, b) => b.bids - a.bids)
        .slice(0, 30)
        .map(({ id, title, url, mode, price, buyNowPrice, bids }) => ({ id, title, url, mode, price, buyNowPrice, bids })),
      warning:
        raw.length === 0
          ? "Nenhum anúncio lido: termo sem resultados ou layout do Ricardo mudou."
          : listings.length < 5
          ? "Poucos anúncios após os filtros: resultado pouco confiável."
          : null,
    };

    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof BlockedError) {
      return NextResponse.json(
        { error: "O Ricardo bloqueou a consulta automática agora. Use os dados diários ou tente mais tarde." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Falha ao consultar o Ricardo: " + (e instanceof Error ? e.message : String(e)) },
      { status: 502 }
    );
  }
}
