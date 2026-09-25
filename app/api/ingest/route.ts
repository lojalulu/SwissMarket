// POST /api/ingest — recebe os anúncios lidos pelo runner numa página de pesquisa.
import { NextResponse } from 'next/server';
import { getProduct } from '@/config/products';
import { checkToken } from '@/lib/auth';
import { ingest } from '@/lib/store';
import { runAlertsFor } from '@/lib/alerts';
import type { IngestPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;

  let body: Partial<IngestPayload>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 }); }

  if (!body.productId || !Array.isArray(body.items)) {
    return NextResponse.json({ success: false, error: 'Forneça productId e items[].' }, { status: 400 });
  }
  if (!getProduct(body.productId)) {
    return NextResponse.json({ success: false, error: `Produto "${body.productId}" não existe em config/products.ts.` }, { status: 404 });
  }
  if (body.items.length > 2000) {
    return NextResponse.json({ success: false, error: 'Demasiados itens num só envio.' }, { status: 413 });
  }

  const result = ingest({
    productId: body.productId,
    searchTerm: body.searchTerm ?? '',
    scrapedAt: body.scrapedAt ?? new Date().toISOString(),
    complete: body.complete ?? false,
    runnerVersion: body.runnerVersion,
    // compatibilidade com o runner antigo ({id,title,price,link})
    items: body.items.map((it: any) => it.mode ? it : ({
      id: String(it.id), title: String(it.title ?? ''), url: it.url ?? it.link ?? '',
      mode: 'buynow', bidPrice: null, buyNowPrice: it.price > 0 ? Number(it.price) : null,
      bids: 0, endDate: null, condition: null, source: 'legacy',
    })).filter((it: any) => it.bidPrice !== null || it.buyNowPrice !== null),
  });
  // Alertas: não bloqueiam a resposta ao runner se o ntfy/Telegram estiver lento.
  let alerts = 0;
  try { alerts = await Promise.race([runAlertsFor(body.productId), new Promise<number>((r) => setTimeout(() => r(-1), 15000))]); }
  catch (e) { console.error('[alerts]', e); }
  return NextResponse.json({ success: true, ...result, alerts });
}
