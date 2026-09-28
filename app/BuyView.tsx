"use client";
// app/BuyView.tsx — aba "Comprar": oportunidades no Tutti/Anibis para revender no Ricardo + avaliador manual (Facebook).

import { useCallback, useEffect, useState } from "react";
import { Car, Check, ClipboardCheck, Copy, ExternalLink, Loader2, MapPin, Route, Search, ShieldAlert, ShieldCheck, User } from "lucide-react";
import type { BuyDeal, Evaluation } from "@/lib/buy";

const chf = (n: number | null | undefined) => (n === null || n === undefined ? "—" : "CHF " + Math.round(n).toLocaleString("de-CH"));
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
};
const SRC = { tutti: "Tutti", anibis: "Anibis" } as const;

type BuyResponse = { success: boolean; error?: string; sources: string[]; maxDriveMin: number; commute: boolean; tracked: number; lastSeen: string | null; deals: BuyDeal[] };

function message(d: BuyDeal): string {
  const where = d.place ? ` in ${d.place}` : "";
  return d.kind === "negociar"
    ? `Grüezi! Ich interessiere mich für Ihr Inserat „${d.title}“. Wären Sie mit CHF ${d.offer} einverstanden? Ich kann es persönlich${where} abholen und bar oder mit TWINT bezahlen. Freundliche Grüsse`
    : `Grüezi! Ist Ihr Inserat „${d.title}“ noch verfügbar? Ich könnte es heute oder morgen${where} abholen und bar oder mit TWINT bezahlen. Freundliche Grüsse`;
}

const mapsUrl = (d: { zip: string | null; place: string | null }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${d.zip ?? ""} ${d.place ?? ""}, Schweiz`)}&travelmode=driving`;

function DriveBadges({ d }: { d: Pick<BuyDeal, "drive" | "onRoute" | "withinRadius" | "place"> }) {
  if (!d.drive) return <span className="text-slate-500">local desconhecido</span>;
  return (
    <>
      <span className={`rounded-full px-2 py-0.5 ring-1 ${d.withinRadius ? "bg-violet-500/10 text-violet-200 ring-violet-400/20" : "bg-slate-500/10 text-slate-400 ring-white/10"}`}>
        <Car className="mr-0.5 inline h-3 w-3" />{d.drive.minutes} min · {d.place ?? d.drive.place}{d.drive.via === "estimate" ? " ~" : ""}
      </span>
      {d.onRoute && (
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-200 ring-1 ring-emerald-400/20">
          <Route className="mr-0.5 inline h-3 w-3" />no caminho +{d.drive.detourMin} min
        </span>
      )}
    </>
  );
}

function SellerLine({ d }: { d: BuyDeal }) {
  const s = d.seller;
  if (d.trust === "visivel") {
    return (
      <p className="text-xs text-emerald-200"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
        {s?.name} · membro desde {s?.memberSince}{s?.verified ? " · verificado" : ""}{s?.company ? " · empresa" : ""}{s?.listings ? ` · ${s.listings} anúncios` : ""}
      </p>
    );
  }
  if (!d.sellerChecked) return <p className="text-xs text-slate-400"><User className="mr-1 inline h-3.5 w-3.5" />{s?.name ? `${s.name} · ` : ""}perfil ainda não verificado — o robô abre o anúncio na próxima leitura</p>;
  return <p className="text-xs text-amber-200"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />{s?.name ?? "Vendedor"}: perfil incompleto/escondido — confira antes de combinar</p>;
}

export default function BuyView({ products }: { products: { productId: string; name: string }[] }) {
  const [data, setData] = useState<BuyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nearOnly, setNearOnly] = useState(true);
  const [routeOnly, setRouteOnly] = useState(false);
  const [kind, setKind] = useState<"todos" | "comprar" | "negociar">("todos");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/buy", { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Erro");
      setData(j);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 3 * 60e3); return () => clearInterval(t); }, [load]);

  const deals = (data?.deals ?? []).filter((d) => (!nearOnly || d.withinRadius) && (!routeOnly || d.onRoute) && (kind === "todos" || d.kind === kind));
  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1 text-xs ring-1 ${on ? "bg-white/10 text-white ring-white/30" : "text-slate-400 ring-white/10"}`;

  return (
    <section className="space-y-4">
      <Evaluator products={products} />

      <div>
        <p className="mb-2 text-xs text-slate-400">
          {data ? <>
            {data.sources.map((s) => SRC[s as keyof typeof SRC] ?? s).join(" + ") || "—"} · {data.tracked} anúncios relevantes · última leitura {ago(data.lastSeen) || "—"} · raio {data.maxDriveMin} min de carro a partir de Bern
          </> : loading ? <><Loader2 className="inline h-3 w-3 animate-spin" /> a carregar…</> : null}
        </p>
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
          <button onClick={() => setNearOnly(!nearOnly)} className={chip(nearOnly)}><Car className="mr-0.5 inline h-3 w-3" /> Até {data?.maxDriveMin ?? 40} min</button>
          {data?.commute && <button onClick={() => setRouteOnly(!routeOnly)} className={chip(routeOnly)}><Route className="mr-0.5 inline h-3 w-3" /> No caminho do trabalho</button>}
          {(["todos", "comprar", "negociar"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{k === "todos" ? "Tudo" : k === "comprar" ? "Comprar já" : "Negociar"}</button>
          ))}
        </div>
        {error && <div className="mb-3 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-400/30">Erro: {error}</div>}
        {data && deals.length === 0 && (
          <div className="rounded-xl bg-slate-900/70 p-5 text-sm text-slate-400 ring-1 ring-white/10">
            {data.tracked === 0
              ? "Ainda sem leituras do Tutti. Atualize o robô no telemóvel (git pull) — ele passa a procurar no Tutti depois de cada volta no Ricardo."
              : "Nenhuma oportunidade com estes filtros agora. Com alertas ligados, recebes aviso no telemóvel quando aparecer."}
          </div>
        )}
        <ul className="grid gap-2">
          {deals.map((d) => (
            <li key={d.key} className="rounded-2xl bg-slate-900/70 p-3 ring-1 ring-white/10">
              <div className="flex gap-3">
                {d.image
                  ? <img src={d.image} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-slate-800 object-cover" loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                  : <div className="h-20 w-20 shrink-0 rounded-xl bg-slate-800" />}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 ring-1 ${d.kind === "comprar" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30" : "bg-amber-500/10 text-amber-300 ring-amber-400/30"}`}>
                      {d.kind === "comprar" ? "Comprar já" : "Negociar"}
                    </span>
                    <span className="text-slate-400">{SRC[d.source]} · {ago(d.postedAt ?? d.firstSeen)}</span>
                    <DriveBadges d={d} />
                    {d.suspicious && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-200 ring-1 ring-rose-400/30">⚠️ bom demais — risco de golpe/roubado</span>}
                    {d.basis === "pedidos" && <span className="text-rose-300">revenda estimada (sem vendas)</span>}
                  </div>
                  <a href={d.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm text-slate-100 hover:text-white">
                    <span className="text-slate-400">{d.productName} · </span>{d.title}
                  </a>
                  <div className="tabular mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-semibold text-white">
                      {d.kind === "negociar" ? <>propor {chf(d.offer)} <span className="font-normal text-slate-400">(pedem {chf(d.price)})</span></> : chf(d.price)}
                    </span>
                    <span className="text-emerald-300">lucro ≈ {chf(d.profit)} ({d.roiPct}%)</span>
                    <span className="text-xs text-slate-500">revende ~{chf(d.resale)} · até {chf(d.maxBuy)} · viagem {chf(d.travel?.chf)}{d.travel?.mode === "caminho" ? " (desvio)" : ""}</span>
                  </div>
                  <div className="mt-1"><SellerLine d={d} /></div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={d.url} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/30">
                      Abrir no {SRC[d.source]} <ExternalLink className="inline h-3 w-3" />
                    </a>
                    <button onClick={() => { navigator.clipboard?.writeText(message(d)); setCopied(d.key); setTimeout(() => setCopied(null), 2000); }}
                      className="rounded-lg bg-amber-500/10 px-3 py-1 text-xs text-amber-200 ring-1 ring-amber-400/30">
                      {copied === d.key ? <><Check className="inline h-3 w-3" /> Copiada</> : <><Copy className="inline h-3 w-3" /> Mensagem (DE)</>}
                    </button>
                    {d.zip && (
                      <a href={mapsUrl(d)} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-500/10 px-3 py-1 text-xs text-sky-200 ring-1 ring-sky-400/30">
                        <MapPin className="inline h-3 w-3" /> Rota
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─────────────────────────── avaliador manual (Facebook Marketplace, WhatsApp…) ───────────────────────────

type EvalMatch = { productId: string; productName: string; stats: { basis: string; confidence: string; sold: number } | null; result: Evaluation | null };

const FB_CHECKS = [
  "Perfil com nome e foto reais, conta com mais de 1 ano — perfil fechado ou novo: não compre",
  "Avaliações no Marketplace e amigos/atividade visíveis",
  "Nunca pague adiantado nem por envio: pague só na entrega (TWINT ou dinheiro), em local público",
  "Teste antes de pagar: liga, ecrã, câmaras, Face ID, som; bateria em Ajustes › Bateria",
  "iPhone/iPad/Mac: sem bloqueio de ativação — peça para sair do iCloud (Buscar desligado) à sua frente; IMEI (*#06#) igual ao da caixa",
  "Peça a fatura/recibo de compra (reduz o risco de artigo roubado)",
];

function Evaluator({ products }: { products: { productId: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [place, setPlace] = useState("");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ error?: string; zip?: string | null; placeFound?: boolean; matches?: EvalMatch[] } | null>(null);

  const run = async () => {
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, price, place, productId }) });
      const j = await r.json();
      setRes(j.success ? j : { error: j.error });
    } catch (e) { setRes({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  const input = "w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500";

  return (
    <div className="rounded-2xl bg-slate-900/70 ring-1 ring-white/10">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-3 text-left text-sm text-slate-200">
        <span><Search className="mr-1 inline h-4 w-4" /> Avaliar um anúncio (Facebook Marketplace, WhatsApp…)</span>
        <span className="text-xs text-slate-500">{open ? "fechar" : "abrir"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/5 p-3">
          <input className={input} placeholder="Título do anúncio (ex.: iPhone 15 Pro 128GB blau)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={input} inputMode="decimal" placeholder="Preço pedido (CHF)" value={price} onChange={(e) => setPrice(e.target.value)} />
            <input className={input} placeholder="Local ou código postal" value={place} onChange={(e) => setPlace(e.target.value)} />
          </div>
          <select className={input} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Produto: detetar pelo título</option>
            {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
          </select>
          <button onClick={run} disabled={busy} className="w-full rounded-lg bg-emerald-500/20 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-400/30">
            {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : "Avaliar"}
          </button>

          {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
          {res && !res.error && !res.placeFound && <p className="text-xs text-amber-300">Não encontrei esse local — escreva o código postal (ex.: 3600).</p>}
          {res?.matches && res.matches.length === 0 && <p className="text-sm text-slate-400">Não reconheci o produto pelo título. Escolha-o na lista.</p>}
          {res?.matches?.map((m) => (
            <div key={m.productId} className="rounded-xl bg-black/20 p-3 text-sm ring-1 ring-white/5">
              <div className="mb-1 font-semibold text-white">{m.productName}</div>
              {!m.result ? <p className="text-slate-400">Ainda sem dados do Ricardo para este produto.</p> : (
                <>
                  <p className={m.result.kind === "comprar" ? "text-emerald-300" : m.result.kind === "negociar" ? "text-amber-300" : "text-rose-300"}>{m.result.verdict}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]"><DriveBadges d={m.result} /></div>
                  <p className="mt-1 text-xs text-slate-400">
                    Revende no Ricardo a ~{chf(m.result.resale)} · comprar até {chf(m.result.maxBuy)} · viagem {chf(m.result.travel?.chf)}
                    {m.stats ? ` · base: ${m.stats.sold} vendas, confiança ${m.stats.confidence}` : ""}
                  </p>
                  {m.result.suspicious && <p className="mt-1 text-xs text-rose-300">⚠️ Preço bom demais: grande risco de golpe ou artigo roubado.</p>}
                </>
              )}
            </div>
          ))}
          <div className="rounded-xl bg-black/20 p-3 text-xs text-slate-300 ring-1 ring-white/5">
            <div className="mb-1 font-medium text-slate-200"><ClipboardCheck className="mr-1 inline h-3.5 w-3.5" /> Antes de combinar (Facebook)</div>
            <ul className="list-disc space-y-0.5 pl-4">{FB_CHECKS.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
