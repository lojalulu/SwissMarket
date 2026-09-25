// GET /api/stats[?productId=iphone-13][&days=30] — médias, liquidez e preço máximo de compra.
import { NextResponse } from 'next/server';
import { activeProducts, getProduct } from '@/config/products';
import { computeProductStats } from '@/lib/stats';
import { maintain, recordsFor, runsFor } from '@/lib/store';
import { alertChannels } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  maintain();
  const sp = new URL(req.url).searchParams;
  const days = Math.min(Math.max(Number(sp.get('days')) || 30, 1), 180);
  const id = sp.get('productId');
  const products = id ? [getProduct(id)].filter(Boolean) : activeProducts();
  if (id && !products.length) return NextResponse.json({ success: false, error: 'Produto não encontrado.' }, { status: 404 });

  const now = new Date();
  const stats = products.map((p) => computeProductStats(p!, recordsFor(p!.id), runsFor(p!.id), now, days));
  return NextResponse.json(
    { success: true, generatedAt: now.toISOString(), windowDays: days, alerts: alertChannels(), products: stats },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
