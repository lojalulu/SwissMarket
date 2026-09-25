// GET /api/listings?productId=iphone-13[&status=active|sold|all][&rejected=1] — anúncios brutos para auditoria.
import { NextResponse } from 'next/server';
import { getProduct } from '@/config/products';
import { recordsFor } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get('productId') ?? '';
  if (!getProduct(id)) return NextResponse.json({ success: false, error: 'productId inválido.' }, { status: 404 });
  const status = sp.get('status') ?? 'all';
  const rejected = sp.get('rejected') === '1';
  const rows = recordsFor(id)
    .filter((r) => (rejected ? !r.relevant : r.relevant))
    .filter((r) => status === 'all' || r.status === status)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 500)
    .map(({ history, ...r }) => r);
  return NextResponse.json({ success: true, count: rows.length, data: rows });
}
