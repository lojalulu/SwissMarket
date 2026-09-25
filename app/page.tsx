"use client";
// app/page.tsx — SwissMarket Pulse: preços médios, liquidez e Preço Máximo de Compra por produto.
// Lê /api/stats (calculado na VPS a partir dos dados enviados pelo runner). Mobile-first, dark.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownWideNarrow, ChevronDown, ExternalLink, Flame, Gavel, Info, Loader2, RefreshCw, ShoppingBag, Tag, TrendingUp,
} from "lucide-react";
import type { ProductStats } from "@/lib/stats";

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

export default function Page() {
  const [data, setData] = useState<{ generatedAt: string; products: ProductStats[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("liquidez");
  const [open, setOpen] = useState<string | null>(null);

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
    else list.sort((a, b) => (b.liquidity.score ?? -1) - (a.liquidity.score ?? -1));
    return list;
  }, [data, sort]);

  const allOpps = useMemo(
    () => products.flatMap((p) => p.opportunities.map((o) => ({ ...o, product: p.name }))).sort((a, b) => b.estProfit - a.estProfit),
    [products],
  );
  const lastRun = products.map((p) => p.tracking.lastRun).filter(Boolean).sort().pop() ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">SwissMarket Pulse</h1>
          <p className="text-sm text-slate-400">
            Ricardo.ch · última recolha {ago(lastRun)} · {products.length} produtos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg bg-slate-800/80 px-2 py-1.5 text-sm text-slate-200 ring-1 ring-white/10">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg bg-slate-800/80 px-2 py-1.5 text-sm text-slate-200 ring-1 ring-white/10">
            <option value="liquidez">Mais líquidos</option>
            <option value="lucro">Maior lucro</option>
            <option value="nome">Nome</option>
          </select>
          <button onClick={load} className="rounded-lg bg-slate-800/80 p-2 text-slate-200 ring-1 ring-white/10" aria-label="Atualizar">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-400/30">Erro: {error}</div>}

      {allOpps.length > 0 && (
        <section className="mb-6 rounded-2xl bg-emerald-500/[0.07] p-4 ring-1 ring-emerald-400/25">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-200">
            <Flame className="h-4 w-4" /> Oportunidades agora ({allOpps.length}) — abaixo do preço máximo de compra
          </h2>
          <ul className="divide-y divide-white/5">
            {allOpps.slice(0, 8).map((o) => (
              <li key={o.product + o.id + o.kind} className="flex items-center justify-between gap-3 py-2 text-sm">
                <a href={o.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-slate-200 hover:text-white">
                  <span className="text-slate-400">{o.product} · </span>{o.title}
                </a>
                <span className="tabular shrink-0 text-right">
                  <span className="text-white">{chf(o.price)}</span>
                  <span className="ml-2 text-emerald-300">+{chf(o.estProfit)}</span>
                  {o.kind === "auction" && <Gavel className="ml-1 inline h-3.5 w-3.5 text-sky-300" />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!data && !error && <p className="text-slate-400">A carregar…</p>}
      {data && products.every((p) => !p.tracking.lastRun) && (
        <div className="mb-6 rounded-xl bg-slate-800/60 p-4 text-sm text-slate-300 ring-1 ring-white/10">
          Ainda não há dados. Corra no telemóvel: <code className="rounded bg-black/40 px-1.5 py-0.5">npx tsx scripts/runner.ts</code>
        </div>
      )}

      <div className="grid gap-3">
        {products.map((p) => (
          <ProductCard key={p.productId} p={p} open={open === p.productId} onToggle={() => setOpen(open === p.productId ? null : p.productId)} />
        ))}
      </div>

      <footer className="mt-10 space-y-1 text-xs text-slate-500">
        <p>Preço máx. de compra = revenda rápida − comissão Ricardo (10–12 %, teto CHF 290) − custos, com margem mínima de 20 % e lucro mínimo de CHF 40 (ajustável em config/products.ts).</p>
        <p>Revenda rápida = meio caminho entre o 1.º quartil e a mediana dos preços de venda. Outliers removidos por IQR.</p>
      </footer>
    </main>
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
              {liq.text}{p.liquidity.score !== null ? ` · ${p.liquidity.score}` : ""}
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
