// POST /api/ingest/buy — anúncios de uma pesquisa no Tutti/Anibis. Responde com os anúncios cujo vendedor
// o runner deve verificar (abrir a página do anúncio) e envia alertas.
import { NextResponse } from 'next/server';
import { getProduct } from '@/config/products';
import { checkToken } from '@/lib/auth';
import { ingestBuy, needSellerCheck, refineDrives } from '@/lib/buy';
import { isBuySource } from '@/lib/classifieds';
import { runBuyAlerts } from '@/lib/alerts';
import type { BuyIngestPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  let body: Partial<BuyIngestPayload>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 }); }
  if (!isBuySource(body.source) || !body.productId || !Array.isArray(body.items)) {
    return NextResponse.json({ success: false, error: 'Forneça source (tutti|anibis), productId e items[].' }, { status: 400 });
  }
  if (!getProduct(body.productId)) return NextResponse.json({ success: false, error: `Produto "${body.productId}" não existe.` }, { status: 404 });
  if (body.items.length > 500) return NextResponse.json({ success: false, error: 'Demasiados itens.' }, { status: 413 });

  const result = ingestBuy({ source: body.source, productId: body.productId, scrapedAt: body.scrapedAt ?? new Date().toISOString(), items: body.items, runnerVersion: body.runnerVersion });
  // Tempos de carro reais (OSRM) para os locais novos dos anúncios relevantes — no máx. ~8 s.
  const zips = body.items.map((i) => i.zip).filter((z): z is string => !!z);
  try { await refineDrives(zips, 6, 8000); } catch { /* fica a estimativa */ }
  const needSeller = needSellerCheck(body.source, body.productId);
  let alerts = 0;
  try { alerts = await Promise.race([runBuyAlerts(body.productId), new Promise<number>((r) => setTimeout(() => r(-1), 15000))]); }
  catch (e) { console.error('[alerts]', e); }
  return NextResponse.json({ success: true, ...result, needSeller, alerts });
}
