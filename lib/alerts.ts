// lib/alerts.ts — avisos no telemóvel quando aparece uma oportunidade.
//
// Canais (configure no .env da VPS; pode usar um, os dois ou nenhum):
//   • ntfy (mais simples): instale a app "ntfy" no Android, subscreva um tópico secreto
//       NTFY_TOPIC=swissmarket-<algo-aleatório>
//   • Telegram: TELEGRAM_BOT_TOKEN=…  TELEGRAM_CHAT_ID=…
//
// Filtros: ALERT_MIN_SCORE (0–100, padrão 45) · ALERT_KINDS=buynow,auction,offer
// Só alerta quando o preço de revenda já se baseia em vendas/leilões reais (não em preços pedidos).
import { getAuctionModel } from './auction-model';
import { getProduct } from '../config/products';
import { computeProductStats, type Opportunity, type ProductStats } from './stats';
import { effectiveRecords, markAlerted, runsFor, shouldAlert } from './store';
import { buyDeals, type BuyDeal } from './buy';

const env = (k: string) => (process.env[k] ?? '').trim();

export function alertChannels(): string[] {
  const out: string[] = [];
  if (env('NTFY_TOPIC')) out.push('ntfy');
  if (env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_CHAT_ID')) out.push('telegram');
  return out;
}

const chf = (n: number) => `CHF ${Math.round(n).toLocaleString('de-CH')}`;

function timeLeft(min: number | null): string {
  if (min === null) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function formatAlert(o: Opportunity, s: ProductStats): { title: string; body: string; tags: string[]; priority: number } {
  const place = o.nearby ? `📍 retirada perto (${o.city})` : o.shipping === 0 ? '🚚 envio grátis' : o.shipping !== null ? `🚚 portes ${chf(o.shipping)}` : o.city ? `📍 ${o.city}` : '';
  const conf = s.pricing.confidence === 'baixa' ? ' · ⚠️ confiança baixa' : '';
  if (o.kind === 'buynow') {
    return {
      title: `💰 ${s.name}: ${chf(o.price)} (comprar já)`,
      body: `Lucro estimado ${chf(o.estProfit)} (${o.roiPct}%) · revenda ~${chf(s.pricing.resaleQuick ?? 0)} · teto ${chf(s.pricing.recommended?.maxBuy ?? 0)}\n${place}${conf}\n${o.title}`,
      tags: ['moneybag'], priority: o.score >= 70 ? 5 : 4,
    };
  }
  if (o.kind === 'auction') {
    return {
      title: `⏰ ${s.name}: leilão acaba em ${timeLeft(o.minutesLeft)} — ${chf(o.price)}`,
      body: `Lance atual ${chf(o.price)} (${o.bids} lances) · licite no máximo ${chf(o.maxBid ?? 0)} · lucro mínimo se ganhar ${chf(o.estProfit)}${o.winChance !== null ? `\n🎯 chance ~${o.winChance}% de ficar ≤ ${chf(o.maxBid ?? 0)} (final previsto ~${chf(o.estFinal ?? 0)})` : ''}\n${place}${conf}\n${o.title}`,
      tags: ['alarm_clock'], priority: (o.minutesLeft ?? 999) < 60 ? 5 : 4,
    };
  }
  return {
    title: `🤝 ${s.name}: aceita proposta — ofereça ${chf(o.offerPrice ?? 0)}`,
    body: `Pedem ${chf(o.price)}. A ${chf(o.offerPrice ?? 0)} o lucro é ${chf(o.estProfit)}.\n${place}${conf}\n${o.title}`,
    tags: ['handshake'], priority: 3,
  };
}

async function sendNtfy(title: string, body: string, tags: string[], priority: number, click?: string) {
  const server = env('NTFY_SERVER') || 'https://ntfy.sh';
  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: env('NTFY_TOPIC'), title, message: body, tags, priority, click }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

async function sendTelegram(title: string, body: string, click?: string) {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = `<b>${esc(title)}</b>\n${esc(body)}${click ? `\n<a href="${click}">Abrir anúncio</a>` : ''}`;
  const res = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env('TELEGRAM_CHAT_ID'), text, parse_mode: 'HTML', disable_web_page_preview: false }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

export async function sendMessage(title: string, body: string, opts: { tags?: string[]; priority?: number; click?: string } = {}) {
  const errors: string[] = [];
  const channels = alertChannels();
  await Promise.all(channels.map(async (c) => {
    try {
      if (c === 'ntfy') await sendNtfy(title, body, opts.tags ?? [], opts.priority ?? 3, opts.click);
      else await sendTelegram(title, body, opts.click);
    } catch (e) { errors.push(`${c}: ${(e as Error).message}`); }
  }));
  return { channels, errors };
}

/** Avalia um produto e envia os alertas novos. Chamado depois de cada ingest. */
export async function runAlertsFor(productId: string, now = new Date()): Promise<number> {
  if (!alertChannels().length) return 0;
  const p = getProduct(productId);
  if (!p) return 0;
  const stats = computeProductStats(p, effectiveRecords(p.id), runsFor(p.id), now, 30, getAuctionModel(now));
  const minScore = Number(env('ALERT_MIN_SCORE') || 45);
  const kinds = (env('ALERT_KINDS') || 'buynow,auction,offer').split(',').map((k) => k.trim());
  // Sem vendas reais ainda (só preços pedidos) → nada de alertas: o "teto" ainda é um palpite.
  // Pode forçar com ALERT_ALLOW_ASKING=1.
  if (stats.pricing.basis === 'pedidos' && env('ALERT_ALLOW_ASKING') !== '1') return 0;
  const toSend = stats.opportunities
    .filter((o) => o.score >= minScore && kinds.includes(o.kind) && !o.suspicious)
    // Leilão: com dados, só alerta se a chance real de ganhar dentro do limite for ≥ ALERT_MIN_CHANCE (25 %).
    .filter((o) => o.kind !== 'auction' || o.winChance === null || o.winChance >= Number(env('ALERT_MIN_CHANCE') || 25))
    .filter((o) => shouldAlert(`${o.kind}:${p.id}:${o.id}`, o.cost, now))
    .slice(0, 5);
  const sent: { key: string; price: number }[] = [];
  for (const o of toSend) {
    const m = formatAlert(o, stats);
    const r = await sendMessage(m.title, m.body, { tags: m.tags, priority: m.priority, click: o.url });
    if (r.errors.length < r.channels.length) sent.push({ key: `${o.kind}:${p.id}:${o.id}`, price: o.cost });
    else console.error('[alerts] falha:', r.errors.join('; '));
  }
  markAlerted(sent, now);
  return sent.length;
}

// ───────────────────────────── lado da compra (Tutti / Anibis) ─────────────────────────────


function sellerLine(d: BuyDeal): string {
  const s = d.seller;
  if (!d.sellerChecked && !s?.name) return '👤 perfil ainda não verificado — confira antes de combinar';
  if (d.trust === 'desconhecido') return '👤 ⚠️ perfil NÃO visível — cuidado';
  const bits = [s?.name, s?.memberSince ? `membro desde ${s.memberSince}` : null, s?.verified ? 'verificado' : null,
    s?.company ? 'empresa' : null, s?.listings ? `${s.listings} anúncios` : null].filter(Boolean);
  return `👤 ${bits.join(' · ')}`;
}

export function formatBuyAlert(d: BuyDeal): { title: string; body: string; tags: string[]; priority: number } {
  const src = d.source === 'tutti' ? 'Tutti' : 'Anibis';
  const where = d.drive
    ? `📍 ${d.drive.place} · 🚗 ${d.drive.minutes} min${d.onRoute ? ` · no caminho do trabalho (+${d.drive.detourMin} min)` : ''}${d.drive.via === 'estimate' ? ' (estimado)' : ''}`
    : '📍 local desconhecido';
  const conf = d.confidence === 'baixa' ? ' · ⚠️ confiança baixa' : '';
  const head = d.kind === 'comprar'
    ? `🟢 ${src}: ${d.productName} ${chf(d.price)} — lucro ≈ ${chf(d.profit)}`
    : `🤝 ${src}: ${d.productName} — proponha ${chf(d.offer ?? 0)} (pedem ${chf(d.price)})`;
  return {
    title: head,
    body: `Revende no Ricardo a ~${chf(d.resale)} · comprar até ${chf(d.maxBuy)} · viagem ${chf(d.travel?.chf ?? 0)}${conf}\n${where}\n${sellerLine(d)}\n${d.title}`,
    tags: [d.kind === 'comprar' ? 'green_circle' : 'handshake'],
    priority: d.kind === 'comprar' && d.score >= 60 ? 5 : 4,
  };
}

/**
 * Alerta as oportunidades novas do Tutti/Anibis: dentro do raio (MAX_DRIVE_MIN, padrão 40 min), preço de revenda
 * baseado em vendas reais, não "bom demais". Espera pelo perfil do vendedor (máx. 10 min) para o alerta já o mostrar.
 * BUY_REQUIRE_PROFILE=1 → só alerta vendedores com perfil visível (nome + "membro desde").
 * BUY_ALERT_NEGOTIATE=0 → sem alertas de "negociar".
 */
export async function runBuyAlerts(productId?: string, now = new Date()): Promise<number> {
  if (!alertChannels().length) return 0;
  const allowAsking = env('ALERT_ALLOW_ASKING') === '1';
  const requireProfile = env('BUY_REQUIRE_PROFILE') === '1';
  const negotiate = env('BUY_ALERT_NEGOTIATE') !== '0';
  const deals = buyDeals({ productId }, now)
    .filter((d) => d.withinRadius && !d.suspicious && d.status === 'active')
    .filter((d) => allowAsking || d.basis !== 'pedidos')
    .filter((d) => d.kind === 'comprar' || (negotiate && d.kind === 'negociar' && d.price <= d.maxBuy * 1.15))
    .filter((d) => d.sellerChecked || now.getTime() - Date.parse(d.firstSeen) > 10 * 60e3 || !!d.seller?.memberSince)
    .filter((d) => !requireProfile || d.trust === 'visivel')
    .filter((d) => shouldAlert(`buy:${d.source}:${d.id}`, d.price, now))
    .slice(0, 5);
  const sent: { key: string; price: number }[] = [];
  for (const d of deals) {
    const m = formatBuyAlert(d);
    const r = await sendMessage(m.title, m.body, { tags: m.tags, priority: m.priority, click: d.url });
    if (r.errors.length < r.channels.length) sent.push({ key: `buy:${d.source}:${d.id}`, price: d.price });
    else console.error('[alerts] falha:', r.errors.join('; '));
  }
  markAlerted(sent, now);
  return sent.length;
}
