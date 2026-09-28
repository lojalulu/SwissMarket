// POST /api/evaluate — avaliação manual de um anúncio (ex.: Facebook Marketplace): título, preço e local.
import { NextResponse } from 'next/server';
import { evaluateManual, refineDrives } from '@/lib/buy';
import { findZip } from '@/lib/geo';
import { parseChf } from '@/lib/text';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { title?: string; price?: string | number; place?: string; productId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 }); }
  const title = String(body.title ?? '').slice(0, 300);
  const price = parseChf(body.price ?? null);
  if (!title && !body.productId) return NextResponse.json({ success: false, error: 'Escreva o título do anúncio ou escolha o produto.' }, { status: 400 });
  if (!price) return NextResponse.json({ success: false, error: 'Indique o preço pedido (CHF).' }, { status: 400 });
  const zip = findZip(body.place ?? '');
  if (zip) { try { await refineDrives([zip], 1, 6000); } catch { /* estimativa */ } }
  const matches = evaluateManual({ title, price, zip, place: body.place ?? null, productId: body.productId || null });
  return NextResponse.json({ success: true, zip, placeFound: !!zip || !body.place, matches });
}
