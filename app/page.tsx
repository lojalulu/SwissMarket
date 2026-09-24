"use client";
// Caminho no repositório: app/page.tsx
// SwissMarket Pulse — painel "Comprar / Não Comprar", calculadora do Preço Teto,
// gerador de negociação (DE/FR) e "Buscar agora". Mobile-first, dark mode.

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Check, CircleAlert, CircleCheck, CircleX, Copy, ExternalLink, Gavel, Loader2,
  Search, ShoppingBag, Smartphone, Tag, TriangleAlert, Zap,
} from "lucide-react";
import db from "../data/products.json";
import {
  AUCTION_MIN_BIDS, ceilingPrice, statsOf, type ModeStats,
} from "../lib/ricardo";

// ─────────────────────────────── Tipos ───────────────────────────────

type Mode = "auction" | "buynow";
type LiqLabel = "rapido" | "medio" | "lento" | "sem_dados";

interface Row {
  id: string; title: string; url: string; mode: Mode;
  price: number; buyNowPrice: number | null; bids: number; condition?: string;
}

interface Product {
  id: string; name: string; category?: string; searchTerm: string;
  listings: Row[];
  liquidityProxy?: { auctions: number; auctionsWithBidsPct: number; avgBids: number; label: LiqLabel };
  liquidity?: { status: "confirmada" | "coletando_dados"; soldLast60d: number; medianDaysToSell: number | null; label: LiqLabel };
  sold?: { price: number; mode: Mode; condition: string; endedAt: string }[];
  lastScrapeOk?: string; lastError?: string;
}

interface Market {
  name: string;
  sourceUrl: string;
  auction: ModeStats;
  buynow: ModeStats;
  liquidity: { label: LiqLabel; status: "confirmada" | "estimada"; detail: string };
  rows: Row[];
  note?: string | null;
}

interface LiveResult {
  query: string; source: string; fetchedAt: string; totalOnPage: number; used: number;
  stats: { auction: ModeStats; buynow: ModeStats };
  liquidity: { auctions: number; auctionsWithBidsPct: number; avgBids: number; label: LiqLabel };
  listings: Row[];
  warning: string | null;
  error?: string;
}

const DATA = db as unknown as { updatedAt: string; products: Product[] };

// ─────────────────────────────── Constantes ───────────────────────────────

const MARGINS = [0.2, 0.25, 0.3, 0.35];
const COLOR_AUCTION = "#3987e5"; // azul — Leilão
const COLOR_BUYNOW = "#d95926";  // laranja — Sofort-Kaufen

const LIQ: Record<LiqLabel, { text: string; cls: string }> = {
  rapido: { text: "Giro Rápido", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" },
  medio: { text: "Giro Médio", cls: "bg-amber-500/15 text-amber-300 ring-amber-400/30" },
  lento: { text: "Giro Lento", cls: "bg-rose-500/15 text-rose-300 ring-rose-400/30" },
  sem_dados: { text: "Sem dados", cls: "bg-slate-500/15 text-slate-300 ring-slate-400/30" },
};

const chf = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "CHF " + Math.round(n).toLocaleString("de-CH");

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

// ─────────────────────── Dados de um produto cadastrado ───────────────────────

function marketFromProduct(p: Product, condition: string): Market {
  const rows = condition === "Todas" ? p.listings : p.listings.filter((l) => l.condition === condition);
  const sold = (p.sold ?? []).filter((s) => condition === "Todas" || s.condition === condition);

  // Leilão: lance atual dos leilões com lances suficientes + preços finais reais já registrados.
  const auction = [
    ...rows.filter((l) => l.mode === "auction" && l.bids >= AUCTION_MIN_BIDS).map((l) => l.price),
    ...sold.filter((s) => s.mode === "auction").map((s) => s.price),
  ];
  // Sofort-Kaufen: preços fixos anunciados + vendas Sofort registradas.
  const buynow = [
    ...rows.map((l) => l.buyNowPrice).filter((v): v is number => typeof v === "number"),
    ...sold.filter((s) => s.mode === "buynow").map((s) => s.price),
  ];

  let liquidity: Market["liquidity"];
  if (p.liquidity?.status === "confirmada") {
    liquidity = {
      label: p.liquidity.label,
      status: "confirmada",
      detail: `${p.liquidity.soldLast60d} vendas em 60 dias · ~${p.liquidity.medianDaysToSell} dias para vender`,
    };
  } else {
    const x = p.liquidityProxy;
    liquidity = {
      label: x?.label ?? "sem_dados",
      status: "estimada",
      detail: x && x.auctions
        ? `${x.auctionsWithBidsPct}% dos leilões com lances · média de ${x.avgBids} lances`
        : "Poucos leilões ativos para estimar",
    };
  }

  return {
    name: p.name,
    sourceUrl: `https://www.ricardo.ch/de/s/${encodeURIComponent(p.searchTerm)}/`,
    auction: statsOf(auction),
    buynow: statsOf(buynow),
    liquidity,
    rows,
    note: p.lastError ? `Última coleta falhou (${p.lastError.slice(0, 16)}). Mostrando os dados anteriores.` : null,
  };
}

// ─────────────────────────────── Página ───────────────────────────────

type Tab = "eletronicos" | "bolsas" | "buscar";

export default function Page() {
  const [tab, setTab] = useState<Tab>("eletronicos");
  const products = DATA.products.filter((p) => (p.category ?? "eletronicos") === tab);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const productId = selected[tab] ?? products[0]?.id;
  const product = DATA.products.find((p) => p.id === productId);
  const [condition, setCondition] = useState("Todas");

  const conditions = useMemo(() => {
    const set = new Set((product?.listings ?? []).map((l) => l.condition).filter((c): c is string => !!c && c !== "Unbekannt"));
    return ["Todas", ...set];
  }, [product]);

  const market = useMemo(
    () => (product ? marketFromProduct(product, conditions.includes(condition) ? condition : "Todas") : null),
    [product, condition, conditions]
  );

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">SwissMarket Pulse</h1>
          <p className="text-xs text-slate-400">Marketplace / Tutti → Ricardo.ch</p>
        </div>
        <p className="text-right text-[11px] leading-tight text-slate-500">
          Dados diários<br />
          <span className="tabular text-slate-400">{fmtDate(DATA.updatedAt)}</span>
        </p>
      </header>

      {/* Abas */}
      <nav className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-white/5 p-1 ring-1 ring-white/10">
        {([
          ["eletronicos", "Eletrônicos", Smartphone],
          ["bolsas", "Bolsas", ShoppingBag],
          ["buscar", "Buscar", Search],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition ${
              tab === id ? "bg-white/15 text-white shadow" : "text-slate-400"
            }`}
          >
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </nav>

      {tab === "buscar" ? (
        <LiveSearch />
      ) : (
        <>
          {/* Seletor de produto */}
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelected({ ...selected, [tab]: p.id }); setCondition("Todas"); }}
                className={`shrink-0 rounded-full px-4 py-2.5 text-sm ring-1 transition ${
                  p.id === productId
                    ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40"
                    : "bg-white/5 text-slate-300 ring-white/10"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {conditions.length > 1 && (
            <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
              {conditions.map((c) => (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ring-1 ${
                    c === condition ? "bg-white/15 text-white ring-white/30" : "bg-transparent text-slate-400 ring-white/10"
                  }`}
                >
                  {c === "Todas" ? "Todas as condições" : c}
                </button>
              ))}
            </div>
          )}

          {tab === "bolsas" && (
            <p className="mb-4 flex gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-400/20">
              <TriangleAlert size={16} className="shrink-0" aria-hidden />
              Risco de réplica: autentique a peça antes de comprar e desconte o custo da autenticação da margem.
            </p>
          )}

          {market && product && (product.listings.length > 0 || (product.sold?.length ?? 0) > 0) ? (
            <Panel market={market} />
          ) : (
            <Card>
              <p className="text-sm text-slate-300">Aguardando a 1ª coleta automática deste produto.</p>
              <p className="mt-1 text-xs text-slate-500">
                Enquanto isso, use a aba <b>Buscar</b> com o termo “{product?.searchTerm}”.
              </p>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

// ─────────────────────────────── Buscar agora ───────────────────────────────

function LiveSearch() {
  const [q, setQ] = useState("");
  const [min, setMin] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<LiveResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (min) params.set("min", min);
      const r = await fetch(`/api/search?${params}`);
      const j = (await r.json()) as LiveResult;
      if (!r.ok || j.error) throw new Error(j.error ?? `Erro ${r.status}`);
      setRes(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const market: Market | null = res && {
    name: res.query,
    sourceUrl: res.source,
    auction: res.stats.auction,
    buynow: res.stats.buynow,
    liquidity: {
      label: res.liquidity.label,
      status: "estimada",
      detail: res.liquidity.auctions
        ? `${res.liquidity.auctionsWithBidsPct}% dos leilões com lances · média de ${res.liquidity.avgBids} lances`
        : "Poucos leilões ativos para estimar",
    },
    rows: res.listings,
    note: [
      `${res.used} de ${res.totalOnPage} anúncios usados · 1ª página do Ricardo · ${fmtDate(res.fetchedAt)}`,
      "Leilão = lance atual (tende a ficar abaixo do preço final).",
      res.warning,
    ].filter(Boolean).join(" "),
  };

  return (
    <>
      <form onSubmit={run} className="mb-4 space-y-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ex.: macbook air m1, dyson v11, gucci jackie"
          className="min-h-12 w-full rounded-xl bg-white/5 px-4 text-base text-white ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
          enterKeyHint="search"
        />
        <div className="flex gap-2">
          <input
            value={min}
            onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Preço mín. CHF"
            aria-label="Preço mínimo em CHF (filtra acessórios)"
            className="min-h-12 flex-1 rounded-xl bg-white/5 px-4 text-sm text-white ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
          />
          <button
            type="submit"
            disabled={loading || q.trim().length < 2}
            className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-500 px-5 font-semibold text-emerald-950 disabled:opacity-40"
          >
            {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Zap size={18} aria-hidden />}
            Buscar
          </button>
        </div>
      </form>

      {err && (
        <p className="mb-4 flex gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-400/20">
          <CircleAlert size={18} className="shrink-0" aria-hidden /> {err}
        </p>
      )}
      {market ? <Panel market={market} /> : !err && (
        <Card>
          <p className="text-sm text-slate-300">Consulta o Ricardo na hora, para qualquer produto.</p>
          <p className="mt-1 text-xs text-slate-500">Dica: termos específicos (“iphone 12 64gb”) dão medianas mais confiáveis.</p>
        </Card>
      )}
    </>
  );
}

// ─────────────────────────────── Painel de decisão ───────────────────────────────

function Panel({ market }: { market: Market }) {
  const [mode, setMode] = useState<Mode>("auction");
  const [fee, setFee] = useState(0.1);
  const [margin, setMargin] = useState(0.25);
  const [asking, setAsking] = useState("");

  const med = (mode === "auction" ? market.auction : market.buynow).median;
  const teto = med ? ceilingPrice(med, fee, margin) : null;
  const liq = LIQ[market.liquidity.label];

  const ask = Number(asking);
  const hasAsk = asking !== "" && ask > 0 && teto !== null && med !== null;
  const profit = hasAsk ? Math.round(med! * (1 - fee) - ask) : 0;
  const verdict = !hasAsk ? null : ask <= teto! ? "buy" : ask <= teto! * 1.15 ? "negotiate" : "skip";

  return (
    <div className="space-y-3">
      {/* Preço Teto — sempre acima da dobra */}
      <Card className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-rose-300">🚨 Preço Teto de Compra</p>
        <p className="tabular mt-1 text-5xl font-extrabold text-white">{teto ? chf(teto) : "—"}</p>
        <p className="mt-1 text-xs text-slate-400">
          {med
            ? `Mediana ${mode === "auction" ? "Leilão" : "Sofort"} ${chf(med)} × (1 − ${fee * 100}%) × (1 − ${margin * 100}%)`
            : `Sem ${mode === "auction" ? "leilões com " + AUCTION_MIN_BIDS + "+ lances" : "preços Sofort"} suficientes. Troque o modo de giro.`}
        </p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${liq.cls}`}>{liq.text}</span>
          <span className="text-[11px] text-slate-500">{market.liquidity.status}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{market.liquidity.detail}</p>
      </Card>

      {/* Controles */}
      <Card className="space-y-3">
        <Segmented
          label="Modo de giro"
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[["auction", "Giro rápido · Leilão"], ["buynow", "Margem máx. · Sofort"]]}
        />
        <Segmented
          label="Canal de venda"
          value={String(fee)}
          onChange={(v) => setFee(Number(v))}
          options={[["0.1", "Ricardo −10%"], ["0", "Direto / cash 0%"]]}
        />
        <Segmented
          label="Margem de lucro líquido"
          value={String(margin)}
          onChange={(v) => setMargin(Number(v))}
          options={MARGINS.map((m) => [String(m), `${m * 100}%`] as [string, string])}
        />
      </Card>

      {/* Comprar / Não comprar */}
      <Card>
        <label className="text-xs text-slate-400" htmlFor="ask">Preço pedido no anúncio (CHF)</label>
        <input
          id="ask"
          value={asking}
          onChange={(e) => setAsking(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="Ex.: 350"
          className="tabular mt-1 min-h-12 w-full rounded-xl bg-black/30 px-4 text-lg text-white ring-1 ring-white/10 focus:outline-none focus:ring-emerald-400/60"
        />
        {verdict && (
          <div
            className={`mt-3 flex items-center gap-3 rounded-xl p-3 ring-1 ${
              verdict === "buy"
                ? "bg-emerald-500/15 ring-emerald-400/30"
                : verdict === "negotiate"
                ? "bg-amber-500/15 ring-amber-400/30"
                : "bg-rose-500/15 ring-rose-400/30"
            }`}
          >
            {verdict === "buy" ? <CircleCheck className="text-emerald-300" aria-hidden />
              : verdict === "negotiate" ? <CircleAlert className="text-amber-300" aria-hidden />
              : <CircleX className="text-rose-300" aria-hidden />}
            <div>
              <p className="font-bold text-white">
                {verdict === "buy" ? "COMPRAR" : verdict === "negotiate" ? "NEGOCIAR" : "NÃO COMPRAR"}
              </p>
              <p className="tabular text-xs text-slate-300">
                Lucro estimado {chf(profit)} ({Math.round((profit / (med! * (1 - fee))) * 100)}% da receita líquida)
                {verdict === "negotiate" && ` · peça ${chf(teto)}`}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Breakdown piso × teto */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<Gavel size={16} aria-hidden />} color={COLOR_AUCTION} title="Mediana Leilão" sub="piso · liquidação rápida" s={market.auction} />
        <StatCard icon={<Tag size={16} aria-hidden />} color={COLOR_BUYNOW} title="Mediana Sofort" sub="teto · margem máxima" s={market.buynow} />
      </div>

      <Negotiation name={market.name} teto={teto} />

      <Distribution rows={market.rows} />

      <Listings rows={market.rows} sourceUrl={market.sourceUrl} />

      {market.note && <p className="px-1 text-[11px] leading-relaxed text-slate-500">{market.note}</p>}
    </div>
  );
}

// ─────────────────────────────── Negociação DE/FR ───────────────────────────────

function Negotiation({ name, teto }: { name: string; teto: number | null }) {
  const [lang, setLang] = useState<"de" | "fr">("de");
  const [discount, setDiscount] = useState(0);
  const [copied, setCopied] = useState(false);

  const offer = teto ? Math.floor((teto * (1 - discount)) / 5) * 5 : null; // arredonda para múltiplos de 5
  const text = offer === null ? "" : lang === "de"
    ? `Hallo! Ich interessiere mich für den Artikel „${name}“. Aufgrund aktueller Marktpreise biete ich CHF ${offer} bei schneller Abholung an. Passt das für Sie?`
    : `Bonjour ! Je suis intéressé par l'article « ${name} ». Au vu des prix actuels du marché, je vous propose CHF ${offer} avec retrait rapide. Est-ce que cela vous convient ?`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* navegador sem permissão de cópia */ }
  }

  if (!teto) return null;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Mensagem de negociação</p>
        <div className="flex rounded-lg bg-black/30 p-0.5 ring-1 ring-white/10">
          {(["de", "fr"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`min-h-9 rounded-md px-3 text-xs font-semibold uppercase ${lang === l ? "bg-white/15 text-white" : "text-slate-400"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <Segmented
        label="Oferta inicial"
        value={String(discount)}
        onChange={(v) => setDiscount(Number(v))}
        options={[["0", "No teto"], ["0.1", "Teto −10%"], ["0.2", "Teto −20%"]]}
      />
      <p className="rounded-xl bg-black/30 p-3 text-sm leading-relaxed text-slate-200 ring-1 ring-white/10">{text}</p>
      <button
        onClick={copy}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/10 font-semibold text-white ring-1 ring-white/15 active:bg-white/20"
      >
        {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        {copied ? "Copiado!" : `Copiar mensagem (CHF ${offer})`}
      </button>
    </Card>
  );
}

// ─────────────────────────────── Distribuição de preços ───────────────────────────────

function Distribution({ rows }: { rows: Row[] }) {
  const data = useMemo(() => {
    const auction = rows.filter((r) => r.mode === "auction" && r.bids >= AUCTION_MIN_BIDS).map((r) => r.price);
    const buynow = rows.map((r) => r.buyNowPrice).filter((v): v is number => typeof v === "number");
    const all = [...auction, ...buynow];
    if (all.length < 3) return null;
    const lo = Math.min(...all), hi = Math.max(...all);
    const bins = 7, step = Math.max(1, Math.ceil((hi - lo + 1) / bins));
    const out = Array.from({ length: bins }, (_, i) => ({
      faixa: `${Math.round(lo + i * step)}`,
      label: `CHF ${Math.round(lo + i * step)}–${Math.round(lo + (i + 1) * step)}`,
      Leilão: 0,
      Sofort: 0,
    }));
    const idx = (v: number) => Math.min(bins - 1, Math.floor((v - lo) / step));
    auction.forEach((v) => out[idx(v)].Leilão++);
    buynow.forEach((v) => out[idx(v)].Sofort++);
    return out;
  }, [rows]);

  if (!data) return null;

  return (
    <Card>
      <p className="mb-1 text-sm font-semibold text-white">Distribuição de preços</p>
      <p className="mb-2 text-[11px] text-slate-500">Nº de anúncios por faixa de preço (CHF)</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="faixa" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              contentStyle={{ background: "#0b0f17", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: "#e5e7eb" }}
              itemStyle={{ color: "#cbd5e1" }}
              labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ""}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} iconType="circle" iconSize={8} />
            <Bar dataKey="Leilão" stackId="a" fill={COLOR_AUCTION} stroke="#0b0f17" strokeWidth={2} />
            <Bar dataKey="Sofort" stackId="a" fill={COLOR_BUYNOW} stroke="#0b0f17" strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ─────────────────────────────── Lista de anúncios ───────────────────────────────

function Listings({ rows, sourceUrl }: { rows: Row[]; sourceUrl: string }) {
  const [open, setOpen] = useState(false);
  const top = [...rows].sort((a, b) => b.bids - a.bids).slice(0, open ? 25 : 5);
  if (!rows.length) return null;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Anúncios usados no cálculo</p>
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-emerald-300">
          Ricardo <ExternalLink size={12} aria-hidden />
        </a>
      </div>
      <ul className="divide-y divide-white/5">
        {top.map((r) => (
          <li key={r.id}>
            <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{r.title}</span>
                <span className="text-[11px] text-slate-500">
                  {r.mode === "auction" ? `Leilão · ${r.bids} lances` : "Sofort-Kaufen"}
                  {r.condition && r.condition !== "Unbekannt" ? ` · ${r.condition}` : ""}
                </span>
              </span>
              <span className="tabular shrink-0 text-right text-sm text-white">
                {chf(r.price)}
                {r.mode === "auction" && r.buyNowPrice ? (
                  <span className="block text-[11px] text-slate-500">Sofort {chf(r.buyNowPrice)}</span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {rows.length > 5 && (
        <button onClick={() => setOpen(!open)} className="mt-2 min-h-10 w-full text-xs text-slate-400">
          {open ? "Mostrar menos" : `Mostrar mais (${Math.min(rows.length, 25)})`}
        </button>
      )}
    </Card>
  );
}

// ─────────────────────────────── Componentes base ───────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white/[0.06] p-4 shadow-lg shadow-black/20 ring-1 ring-white/10 backdrop-blur-xl ${className}`}>
      {children}
    </section>
  );
}

function StatCard({ icon, color, title, sub, s }: { icon: React.ReactNode; color: string; title: string; sub: string; s: ModeStats }) {
  return (
    <Card className="!p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
        {icon} {title}
      </p>
      <p className="tabular mt-1 text-2xl font-bold text-white">{chf(s.median)}</p>
      <p className="text-[11px] text-slate-500">{sub}</p>
      <p className="tabular mt-1 text-[11px] text-slate-400">
        {s.count ? `${s.count} amostras · ${chf(s.min)}–${chf(s.max)}` : "sem amostras"}
      </p>
    </Card>
  );
}

function Segmented({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <div className="flex gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-white/10">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`min-h-10 flex-1 rounded-lg px-2 text-xs font-medium transition ${
              value === v ? "bg-emerald-500 text-emerald-950" : "text-slate-300"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
