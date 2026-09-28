// GET /api/buy[?productId=][&all=1] — oportunidades de compra no Tutti/Anibis (lucro ao revender no Ricardo).
import { NextResponse } from 'next/server';
import { buyDeals, enabledBuySources } from '@/lib/buy';
import { homePoint, maxDriveMin, workPoint } from '@/lib/geo';
import { maintain, withDb } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  maintain();
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const deals = buyDeals({ productId: sp.get('productId') ?? undefined, includeGone: sp.get('all') === '1' }, now);
  const counts = withDb((db) => {
    const recs = Object.values(db.buy ?? {});
    const last = recs.reduce((m, r) => (r.lastSeen > m ? r.lastSeen : m), '');
    return { tracked: recs.filter((r) => r.relevant && r.status === 'active').length, lastSeen: last || null };
  });
  return NextResponse.json({
    success: true, generatedAt: now.toISOString(), sources: enabledBuySources(), maxDriveMin: maxDriveMin(),
    commute: !!workPoint(), home: homePoint(), ...counts, deals: deals.slice(0, 150),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
