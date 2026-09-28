"use client";
// app/page.tsx — SwissMarket Pulse: preços médios, liquidez e Preço Máximo de Compra por produto.
// Lê /api/stats (calculado na VPS a partir dos dados enviados pelo runner). Mobile-first, dark.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownWideNarrow, Bell, BellOff, Check, ChevronDown, Copy, ExternalLink, Gavel, HeartHandshake as Handshake, Info, Loader2, MapPin, Radar,
  RefreshCw, ShoppingBag, ShoppingCart, Tag, Timer, TrendingUp, Trophy, Zap,
} from "lucide-react";
import type { ProductStats } from "@/lib/stats";
import BuyView from "./BuyView";

type SortKey = "liquidez" | "lucro" | "nome";

const chf = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : "CHF " + n.toLocaleString("de-CH", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const ago = (iso: string | null) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
};

const LIQ = {
  rapido: { text: "Giro rápido", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" },
  medio: { text: "Giro médio", cls: "bg-amber-500/15 text-amber-300 ring-amber-400/30" },
  lento: { text: "Giro lento", cls: "bg-rose-500/15 text-rose-300 ring-rose-400/30" },
  sem_dados: { text: "Sem dados", cls: "bg-slate-500/15 text-slate-300 ring-slate-400/30" },
} as const;

const CONF = {
  alta: "text-emerald-300", media: "text-amber-300", baixa: "text-rose-300", nenhuma: "text-slate-400",
} as const;

const BASIS = {
  vendidos: "vendas confirmadas",
  misto: "vendas + leilões com ≥3 lances a <24 h do fim",
  pedidos: "preços pedidos −10 % (ainda sem vendas)",
  sem_dados: "sem dados",
} as const;

type Tab = "radar" | "comprar" | "produtos" | "ranking";
type RadarKind = "todos" | "buynow" | "auction" | "offer";
type Opp = ProductStats["opportunities"][number] & { product: string; productId: string; confidence: string; resale: number | null; basis: string };

export default function Page() {
  const [data, setData] = useState<{ generatedAt: string; products: ProductStats[]; alerts?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("liquidez");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("radar");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/stats?days=${days}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Erro");
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 5 * 60e3); return () => clearInterval(t); }, [load]);

  const products = useMemo(() => {
    const list = [...(data?.products ?? [])];
    if (sort === "nome") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "lucro") list.sort((a, b) => (b.pricing.recommended?.profitAtMaxBuy ?? -1) - (a.pricing.recommended?.profitAtMaxBuy ?? -1));
    // Mais líquidos: nota de giro; empate → quem tem mais vendas registadas.
    else list.sort((a, b) => (b.liquidity.score ?? -1) - (a.liquidity.score ?? -1) || b.sold.n - a.sold.n);
    return list;
  }, [data, sort]);

  const opps: Opp[] = useMemo(
    () => products.flatMap((p) => p.opportunities.map((o) => ({
      ...o, product: p.name, productId: p.productId, confidence: p.pricing.confidence, resale: p.pricing.resaleQuick, basis: p.pricing.basis,
    }))).sort((a, b) => b.score - a.score),
    [products],
  );
  const lastRun = products.map((p) => p.tracking.lastRun).filter(Boolean).sort().pop() ?? null;
  const alertsOn = (data?.alerts?.length ?? 0) > 0;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">SwissMarket Pulse</h1>
          <p className="text-sm text-slate-400">
            Ricardo.ch + Tutti · última recolha {ago(lastRun)} · {products.length} produtos ·{" "}
            <span className={alertsOn ? "text-emerald-300" : "text-slate-500"}>
              {alertsOn ? <><Bell className="inline h-3.5 w-3.5" /> alertas ligados</> : <><BellOff className="inline h-3.5 w-3.5" /> alertas desligados</>}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg bg-slate-800/80 px-2 py-1.5 text-sm text-slate-200 ring-1 ring-white/10">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
          <button onClick={load} className="rounded-lg bg-slate-800/80 p-2 text-slate-200 ring-1 ring-white/10" aria-label="Atualizar">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <nav className="mb-5 grid grid-cols-4 gap-1 rounded-xl bg-slate-900/70 p-1 ring-1 ring-white/10">
        {([
          ["radar", <><Radar className="mr-1 inline h-4 w-4" />Radar{opps.length ? ` (${opps.length})` : ""}</>],
          ["comprar", <><ShoppingCart className="mr-1 inline h-4 w-4" />Tutti</>],
          ["produtos", <><ShoppingBag className="mr-1 inline h-4 w-4" />Produtos</>],
          ["ranking", <><Trophy className="mr-1 inline h-4 w-4" />Ranking</>],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg py-2 text-xs sm:text-sm ${tab === k ? "bg-emerald-500/15 font-semibold text-emerald-200 ring-1 ring-emerald-400/30" : "text-slate-300"}`}>
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-400/30">Erro: {error}</div>}
      {!data && !error && <p className="text-slate-400">A carregar…</p>}
      {data && products.every((p) => !p.tracking.lastRun) && (
        <div className="mb-6 rounded-xl bg-slate-800/60 p-4 text-sm text-slate-300 ring-1 ring-white/10">
          Ainda não há dados. Corra no telemóvel: <code className="rounded bg-black/40 px-1.5 py-0.5">npx tsx scripts/runner.ts</code>
        </div>
      )}

      {tab === "radar" && <RadarView opps={opps} />}
      {tab === "comprar" && <BuyView products={products.map((p) => ({ productId: p.productId, name: p.name }))} />}
      {tab === "ranking" && <Ranking products={products} onOpen={(id) => { setTab("produtos"); setOpen(id); }} />}
      {tab === "produtos" && (
        <>
          <div className="mb-3 flex justify-end">
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg bg-slate-800/80 px-2 py-1.5 text-sm text-slate-200 ring-1 ring-white/10">
              <option value="liquidez">Mais líquidos</option>
              <option value="lucro">Maior lucro</option>
              <option value="nome">Nome</option>
            </select>
          </div>
          <div className="grid gap-3">
            {products.map((p) => (
              <ProductCard key={p.productId} p={p} open={open === p.productId} onToggle={() => setOpen(open === p.productId ? null : p.productId)} />
            ))}
          </div>
        </>
      )}

      <footer className="mt-10 space-y-1 text-xs text-slate-500">
        <p>Comprar até = revenda rápida − comissão Ricardo (10–12 %, teto CHF 290) − custos, com margem mínima de 20 % e lucro mínimo de CHF 40. Portes contam no custo, exceto retirada perto de casa.</p>
        <p>Confiança baixa = ainda sem vendas confirmadas (baseado em preços pedidos). Confirme sempre o anúncio antes de comprar.</p>
      </footer>
    </main>
  );
}

// ─────────────────────────────── Radar ───────────────────────────────

const KIND = {
  buynow: { label: "Comprar já", icon: Zap, cls: "text-emerald-300 bg-emerald-500/10 ring-emerald-400/30" },
  auction: { label: "Leilão a terminar", icon: Timer, cls: "text-sky-300 bg-sky-500/10 ring-sky-400/30" },
  offer: { label: "Aceita proposta", icon: Handshake, cls: "text-amber-300 bg-amber-500/10 ring-amber-400/30" },
} as const;

function countdown(endDate: string | null, now: number): string {
  if (!endDate) return "";
  const m = Math.round((new Date(endDate).getTime() - now) / 60000);
  if (m <= 0) return "a terminar";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} dias`;
}

function offerMessage(o: Opp): string {
  return `Grüezi! Ich interessiere mich für Ihr Angebot "${o.title}". Wäre CHF ${o.offerPrice} für Sie in Ordnung? ` +
    `Ich kann sofort bezahlen${o.pickup ? " und den Artikel auch persönlich abholen" : ""}. Freundliche Grüsse`;
}

function RadarView({ opps }: { opps: Opp[] }) {
  const [kind, setKind] = useState<RadarKind>("todos");
  const [nearOnly, setNearOnly] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t); }, []);

  const list = opps.filter((o) => (kind === "todos" || o.kind === kind) && (!nearOnly || o.nearby));
  const count = (k: RadarKind) => (k === "todos" ? opps.length : opps.filter((o) => o.kind === k).length);

  return (
    <section>
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        {(["todos", "buynow", "auction", "offer"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ring-1 ${kind === k ? "bg-white/10 text-white ring-white/30" : "text-slate-400 ring-white/10"}`}>
            {k === "todos" ? "Tudo" : KIND[k].label} ({count(k)})
          </button>
        ))}
        <button onClick={() => setNearOnly(!nearOnly)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs ring-1 ${nearOnly ? "bg-white/10 text-white ring-white/30" : "text-slate-400 ring-white/10"}`}>
          <MapPin className="mr-0.5 inline h-3 w-3" /> Retirada perto
        </button>
      </div>

      {list.length === 0 && (
        <div className="rounded-xl bg-slate-900/70 p-5 text-sm text-slate-400 ring-1 ring-white/10">
          Nenhuma oportunidade agora. O radar atualiza a cada recolha do robô — com alertas ligados, recebes aviso no telemóvel.
        </div>
      )}

      <ul className="grid gap-2">
        {list.map((o) => {
          const k = KIND[o.kind];
          const Icon = k.icon;
          return (
            <li key={o.kind + o.productId + o.id} className="rounded-2xl bg-slate-900/70 p-3 ring-1 ring-white/10">
              <div className="flex gap-3">
                {o.image
                  ? <img src={o.image} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-slate-800 object-cover" loading="lazy" />
                  : <div className="h-20 w-20 shrink-0 rounded-xl bg-slate-800" />}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 ring-1 ${k.cls}`}><Icon className="mr-0.5 inline h-3 w-3" />{k.label}</span>
                    {o.kind === "auction" && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-200 ring-1 ring-sky-400/20">⏱ {countdown(o.endDate, now)} · {o.bids} lances</span>}
                    {o.nearby && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-200 ring-1 ring-violet-400/20"><MapPin className="inline h-3 w-3" /> {o.city}</span>}
                    <span className={`${CONF[o.confidence as keyof typeof CONF] ?? "text-slate-400"}`}>conf. {o.confidence}</span>
                    <span className="text-slate-500">score {o.score}</span>
                    {o.suspicious && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-200 ring-1 ring-rose-400/30">⚠️ bom demais — confira estado/autenticidade</span>}
                  </div>
                  <a href={o.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm text-slate-100 hover:text-white">
                    <span className="text-slate-400">{o.product} · </span>{o.title}
                  </a>
                  <div className="tabular mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-semibold text-white">
                      {o.kind === "offer" ? <>propor {chf(o.offerPrice)} <span className="font-normal text-slate-400">(pedem {chf(o.price)})</span></>
                        : o.kind === "auction" ? <>lance {chf(o.price)} <span className="font-normal text-sky-300">→ licite até {chf(o.maxBid)}</span></> : chf(o.price)}
                    </span>
                    {!o.nearby && o.shipping ? <span className="text-xs text-slate-400">+ portes {chf(o.shipping)}</span> : null}
                    <span className="text-emerald-300">{o.kind === "auction" ? "lucro mínimo" : "lucro"} ≈ {chf(o.estProfit)} ({o.roiPct}%)</span>
                    {o.resale && <span className="text-xs text-slate-500">revenda ~{chf(o.resale)}{o.basis === "pedidos" ? " (estimada pelos preços pedidos)" : ""}</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <a href={o.url} target="_blank" rel="noreferrer"
                      className="rounded-lg bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/30">
                      Abrir no Ricardo <ExternalLink className="inline h-3 w-3" />
                    </a>
                    {o.kind === "offer" && (
                      <button
                        onClick={() => { navigator.clipboard?.writeText(offerMessage(o)); setCopied(o.id); setTimeout(() => setCopied(null), 2000); }}
                        className="rounded-lg bg-amber-500/10 px-3 py-1 text-xs text-amber-200 ring-1 ring-amber-400/30">
                        {copied === o.id ? <><Check className="inline h-3 w-3" /> Copiada</> : <><Copy className="inline h-3 w-3" /> Mensagem (DE)</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────── Ranking ───────────────────────────────

function Ranking({ products, onOpen }: { products: ProductStats[]; onOpen: (id: string) => void }) {
  const [by, setBy] = useState<"potencial" | "giro">("potencial");
  const rows = [...products].filter((p) => p.tracking.lastRun)
    .sort((a, b) => by === "potencial"
      ? (b.potential?.expectedProfit7d ?? -1) - (a.potential?.expectedProfit7d ?? -1) || (b.liquidity.score ?? -1) - (a.liquidity.score ?? -1)
      : (b.liquidity.score ?? -1) - (a.liquidity.score ?? -1));
  return (
    <section className="overflow-x-auto rounded-2xl bg-slate-900/70 ring-1 ring-white/10">
      <div className="flex items-center gap-2 px-3 pt-3 text-xs">
        <span className="text-slate-400">Ordenar por:</span>
        {(["potencial", "giro"] as const).map((k) => (
          <button key={k} onClick={() => setBy(k)}
            className={`rounded-full px-3 py-1 ring-1 ${by === k ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40" : "text-slate-300 ring-white/10"}`}>
            {k === "potencial" ? "Potencial (CHF/semana)" : "Giro"}
          </button>
        ))}
      </div>
      <table className="tabular w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-normal">#</th><th className="font-normal">Produto</th><th className="font-normal">Giro</th>
            <th className="hidden font-normal sm:table-cell">Vende em 7d</th><th className="hidden font-normal sm:table-cell">Dias estoque</th>
            <th className="font-normal">Até</th><th className="pr-3 font-normal">Lucro · /sem.</th>
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map((p, i) => (
            <tr key={p.productId} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onOpen(p.productId)}>
              <td className="px-3 py-2 text-slate-500">{i + 1}</td>
              <td className="max-w-[130px] truncate sm:max-w-[220px]">{p.name}</td>
              <td>
                <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${LIQ[p.liquidity.label].cls}`}>
                  {p.liquidity.basis === "estimada" ? "~" : ""}{p.liquidity.score ?? "—"}
                </span>
              </td>
              <td className="hidden sm:table-cell">{p.liquidity.sellChance7d !== null ? `${p.liquidity.sellChance7d}%` : "—"}</td>
              <td className="hidden sm:table-cell">{p.liquidity.daysOfSupply ?? "—"}</td>
              <td className="font-semibold text-white">{chf(p.pricing.recommended?.maxBuy)}</td>
              <td className="pr-3 text-emerald-300">
                {chf(p.pricing.recommended?.profitAtMaxBuy)}
                <div className="text-[11px] text-slate-400">{p.potential ? `≈ ${chf(p.potential.expectedProfit7d)}/sem` : "sem vendas"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-slate-500">
        Potencial = lucro no "comprar até" × chance de vender em 7 dias: quanto cada compra rende, em média, por semana. Só aparece com vendas reais.
        ~ = giro estimado sobretudo pelos leilões ativos (poucas vendas ainda). Toque num produto e veja "Por que este giro?".
        Dias de estoque = anúncios ao preço de mercado ÷ vendas por dia: abaixo de ~10 o mercado absorve rápido; acima de 30 há excesso de oferta.
      </p>
    </section>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-black/20 px-3 py-2 ring-1 ring-white/5">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`tabular ${strong ? "text-lg font-semibold text-white" : "text-base text-slate-100"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function ProductCard({ p, open, onToggle }: { p: ProductStats; open: boolean; onToggle: () => void }) {
  const liq = LIQ[p.liquidity.label];
  const rec = p.pricing.recommended;
  return (
    <article className="rounded-2xl bg-slate-900/70 ring-1 ring-white/10">
      <button onClick={onToggle} className="w-full p-4 text-left">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-white">{p.name}</h3>
            <p className="text-xs text-slate-400">
              {p.counts.active} ativos · {p.sold.n} vendas em análise · recolha {ago(p.tracking.lastRun)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${liq.cls}`}>
              {liq.text}{p.liquidity.score !== null ? ` · ${p.liquidity.basis === "estimada" ? "~" : ""}${p.liquidity.score}` : ""}
            </span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Comprar até" value={chf(rec?.maxBuy)} sub={rec?.profitAtMaxBuy ? `lucro ≈ ${chf(rec.profitAtMaxBuy)}` : undefined} strong />
          <Stat label="Revenda rápida" value={chf(p.pricing.resaleQuick)} sub={`mediana ${chf(p.pricing.resaleMedian)}`} />
          <Stat label="Preço médio vendido" value={chf(p.sold.mean)} sub={p.sold.n ? `${chf(p.sold.p25)} – ${chf(p.sold.p75)}` : "sem vendas ainda"} />
          <Stat
            label="Vendas / 30 dias"
            value={p.liquidity.salesPer30d !== null ? String(p.liquidity.salesPer30d) : "—"}
            sub={p.liquidity.medianDaysToSell !== null ? `~${p.liquidity.medianDaysToSell} dias p/ vender` : p.liquidity.basis === "estimada" ? `${p.active.auctionsWithBidsPct}% leilões c/ lances` : undefined}
          />
        </div>
        <p className="mt-3 text-sm text-slate-300">{p.verdict}</p>
      </button>

      {open && <Details p={p} />}
    </article>
  );
}

function LiquidityBox({ p }: { p: ProductStats }) {
  const l = p.liquidity;
  if (!l.components.length) return null;
  const total = 0.15 + l.components.reduce((a, c) => a + c.weight, 0);
  return (
    <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
      <div className="mb-2 text-xs text-slate-400">Por que este giro? (nota {l.score})</div>
      {(l.daysOfSupply !== null || l.sellChance7d !== null) && (
        <div className="mb-2 grid grid-cols-3 gap-2">
          <Stat label="Vende em 7 dias" value={l.sellChance7d !== null ? `${l.sellChance7d}%` : "—"} sub="chance de 1 anúncio" />
          <Stat label="Dias de estoque" value={l.daysOfSupply !== null ? String(Math.round(l.daysOfSupply)) : "—"} sub={l.daysOfSupplyWorst !== null ? `pior caso ${Math.round(l.daysOfSupplyWorst)}` : undefined} />
          <Stat label="Concorrência" value={String(l.competingListings)} sub="ao preço de mercado" />
        </div>
      )}
      {(p.potential || p.trend) && (
        <div className="mb-2 space-y-0.5 text-xs text-slate-300">
          {p.potential && (
            <p>💰 Potencial: <b className="text-emerald-300">≈ {chf(p.potential.expectedProfit7d)}/semana</b> por compra ({p.potential.roiWeekPct}% do capital por semana)</p>
          )}
          {p.trend && (
            <p>
              {p.trend.pctPerWeek <= -1 ? "📉" : p.trend.pctPerWeek >= 1 ? "📈" : "➡️"} Tendência do preço: <b className={p.trend.pctPerWeek <= -1 ? "text-rose-300" : "text-slate-100"}>{p.trend.pctPerWeek > 0 ? "+" : ""}{p.trend.pctPerWeek}%/semana</b> ({p.trend.chfPerWeek > 0 ? "+" : ""}{p.trend.chfPerWeek} CHF, {p.trend.n} vendas em {p.trend.spanDays} dias)
              {p.trend.appliedCHF !== 0 && <> · revenda já descontada em {chf(Math.abs(p.trend.appliedCHF))} ({p.trend.holdDays} dias até vender)</>}
            </p>
          )}
        </div>
      )}
      <ul className="space-y-1.5">
        {l.components.map((c) => (
          <li key={c.key}>
            <div className="flex justify-between text-xs">
              <span className="text-slate-200">{c.label}</span>
              <span className="tabular text-slate-400">{c.value}/100 · peso {Math.round((c.weight / total) * 100)}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-white/5">
              <div className={`h-1.5 rounded ${c.value >= 60 ? "bg-emerald-400" : c.value >= 40 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${c.value}%` }} />
            </div>
            <div className="text-[11px] text-slate-500">{c.detail}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        Cada sinal pesa conforme as provas que tem. O resto ({Math.round((0.15 / total) * 100)}%) é um "neutro" de 50 que evita conclusões com poucos dados.
      </p>
    </div>
  );
}

function Details({ p }: { p: ProductStats }) {
  const [buy, setBuy] = useState<string>("");
  const sale = p.pricing.resaleQuick ?? 0;
  const fee = Math.min(sale * p.feeRate, 290);
  const cost = p.pricing.recommended?.extraCost ?? 5;
  const buyN = Number(buy.replace(",", "."));
  const profit = buyN > 0 && sale ? sale - fee - cost - buyN : null;

  return (
    <div className="space-y-4 border-t border-white/5 p-4 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span className="flex items-center gap-1"><Info className="h-3.5 w-3.5" /> Base: {BASIS[p.pricing.basis]}</span>
        <span>Confiança: <b className={CONF[p.pricing.confidence]}>{p.pricing.confidence}</b></span>
        <span>Comissão: {Math.round(p.feeRate * 100)} %</span>
        <a href={p.searchUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-300">Ver no Ricardo <ExternalLink className="h-3 w-3" /></a>
      </div>

      <table className="tabular w-full text-left">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr><th className="py-1 font-normal">Amostra</th><th className="font-normal">n</th><th className="font-normal">Média</th><th className="font-normal">Mediana</th><th className="font-normal">P25–P75</th><th className="hidden font-normal sm:table-cell">Mín–Máx</th></tr>
        </thead>
        <tbody className="text-slate-200">
          {([
            [<><TrendingUp className="mr-1 inline h-3.5 w-3.5 text-emerald-300" />Vendidos</>, p.sold],
            [<><Gavel className="mr-1 inline h-3.5 w-3.5 text-sky-300" />Leilões ≥3 lances (fim em 24 h)</>, p.active.auctionBids],
            [<><Tag className="mr-1 inline h-3.5 w-3.5 text-orange-300" />Sofort pedidos</>, p.active.askingBuyNow],
            [<><Zap className="mr-1 inline h-3.5 w-3.5 text-violet-300" />Sofort vendidos (prováveis)</>, p.probableBuyNow],
          ] as const).map(([label, d], i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-1.5">{label}</td>
              <td>{d.n}</td>
              <td>{chf(d.mean)}</td>
              <td>{chf(d.median)}</td>
              <td>{d.n ? `${chf(d.p25)}–${chf(d.p75)}` : "—"}</td>
              <td className="hidden sm:table-cell">{d.n ? `${chf(d.min)}–${chf(d.max)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
          <div className="mb-1 flex items-center gap-1 text-xs text-slate-400"><ArrowDownWideNarrow className="h-3.5 w-3.5" /> Cálculo (revenda rápida)</div>
          {p.pricing.recommended ? (
            <ul className="tabular space-y-0.5 text-slate-200">
              <li className="flex justify-between"><span>Venda</span><span>{chf(p.pricing.recommended.salePrice)}</span></li>
              <li className="flex justify-between text-slate-400"><span>− Comissão Ricardo</span><span>{chf(p.pricing.recommended.fee, 2)}</span></li>
              <li className="flex justify-between text-slate-400"><span>− Custos (embalagem…)</span><span>{chf(p.pricing.recommended.extraCost)}</span></li>
              <li className="flex justify-between"><span>= Líquido</span><span>{chf(p.pricing.recommended.net, 2)}</span></li>
              <li className="flex justify-between font-semibold text-emerald-300"><span>Comprar até</span><span>{chf(p.pricing.recommended.maxBuy)}</span></li>
              {p.pricing.ceiling?.maxBuy && <li className="flex justify-between text-xs text-slate-500"><span>Teto absoluto (vendendo à mediana)</span><span>{chf(p.pricing.ceiling.maxBuy)}</span></li>}
            </ul>
          ) : <p className="text-slate-400">Sem dados suficientes.</p>}
        </div>
        <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
          <div className="mb-1 flex items-center gap-1 text-xs text-slate-400"><ShoppingBag className="h-3.5 w-3.5" /> Calculadora: vale a pena?</div>
          <input inputMode="decimal" placeholder="Preço que te pedem (CHF)" value={buy} onChange={(e) => setBuy(e.target.value)}
            className="mb-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500" />
          {profit !== null && (
            <p className={profit >= (p.pricing.recommended?.profitAtMaxBuy ?? 40) * 0.8 ? "text-emerald-300" : profit > 0 ? "text-amber-300" : "text-rose-300"}>
              Lucro estimado: <b className="tabular">{chf(profit)}</b> ({Math.round((profit / buyN) * 100)} %)
            </p>
          )}
        </div>
      </div>

      <LiquidityBox p={p} />

      <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
        <div className="mb-1 text-xs text-slate-400">Para revender</div>
        <p className="text-slate-200">{p.sell.note}</p>

        {p.sell.bestEndSlots.length > 0 && (
          <p className="mt-1 text-xs text-slate-400">
            Leilões que acabam em <b className="text-emerald-300">{p.sell.bestEndSlots[0].slot}</b> fecham mais alto (mediana {chf(p.sell.bestEndSlots[0].median)}).
            {p.sell.bestEndSlots.length > 1 && <> Pior: {p.sell.bestEndSlots[p.sell.bestEndSlots.length - 1].slot} ({chf(p.sell.bestEndSlots[p.sell.bestEndSlots.length - 1].median)}) — bom para comprar.</>}
          </p>
        )}
      </div>

      <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
        <div className="mb-1 flex items-center gap-1 text-xs text-slate-400"><Gavel className="h-3.5 w-3.5" /> Estratégia de leilão (dados reais)</div>
        {p.auctionStrategy.lowStart.n + p.auctionStrategy.highStart.n === 0 ? (
          <p className="text-slate-400">Ainda sem leilões terminados com preço inicial conhecido.</p>
        ) : (
          <table className="tabular w-full text-left text-slate-200">
            <thead className="text-[11px] uppercase text-slate-500"><tr><th className="font-normal">Começou em</th><th className="font-normal">n</th><th className="font-normal">Vendeu</th><th className="font-normal">Mediana final</th></tr></thead>
            <tbody>
              <tr className="border-t border-white/5"><td className="py-1">CHF 1–5</td><td>{p.auctionStrategy.lowStart.n}</td><td>{p.auctionStrategy.lowStart.soldPct ?? "—"}%</td><td>{chf(p.auctionStrategy.lowStart.medianFinal)}</td></tr>
              <tr className="border-t border-white/5"><td className="py-1">Preço base (&gt; 5)</td><td>{p.auctionStrategy.highStart.n}</td><td>{p.auctionStrategy.highStart.soldPct ?? "—"}%</td><td>{chf(p.auctionStrategy.highStart.medianFinal)}</td></tr>
            </tbody>
          </table>
        )}
        {p.auctionStrategy.activeLowStartPct !== null && (
          <p className="mt-1 text-xs text-slate-400">Leilões ativos agora: {p.auctionStrategy.activeLowStartPct}% começaram a CHF 1–5 ({p.auctionStrategy.activeKnown} com início conhecido).</p>
        )}
      </div>

      {p.weekly.length > 1 && (
        <div className="h-40">
          <div className="mb-1 text-xs text-slate-400">Mediana vendida por semana</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={p.weekly}>
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(w: string) => w.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} formatter={(v: number) => chf(v)} />
              <Bar dataKey="median" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {p.opportunities.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-400">Oportunidades ativas</div>
          <ul className="divide-y divide-white/5">
            {p.opportunities.map((o) => (
              <li key={o.id + o.kind} className="flex items-center justify-between gap-2 py-1.5">
                <a href={o.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-slate-200 hover:text-white">{o.title}</a>
                <span className="tabular shrink-0 text-xs">
                  {o.kind === "auction" ? `lance ${chf(o.price)} (${o.bids})` : chf(o.price)} · <span className="text-emerald-300">+{chf(o.estProfit)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Última leitura: {p.tracking.lastFound} anúncios, {p.tracking.lastRelevant} relevantes · {p.counts.rejectedActive} descartados (acessórios/outros modelos) ·
        {" "}{p.counts.soldConfirmed} vendas confirmadas, {p.counts.soldInferred} inferidas, {p.counts.endedUnsold} sem venda, {p.counts.pendingCheck} por verificar ·
        {" "}{p.tracking.runs24h} recolhas nas últimas 24 h · <a className="text-sky-300" href={`/api/listings?productId=${p.productId}`} target="_blank" rel="noreferrer">dados brutos</a>
      </p>
    </div>
  );
}
