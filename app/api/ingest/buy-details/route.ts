// POST /api/ingest/buy-details — perfil do vendedor / anúncio ainda ativo (lido pelo runner na página do anúncio).
import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/auth';
import { applyBuyDetails } from '@/lib/buy';
import { runBuyAlerts } from '@/lib/alerts';
import type { BuyDetailResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  let body: { results?: BuyDetailResult[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 }); }
  if (!Array.isArray(body.results)) return NextResponse.json({ success: false, error: 'Forneça results[].' }, { status: 400 });
  const out = applyBuyDetails(body.results.slice(0, 50));
  let alerts = 0;
  try { alerts = await Promise.race([runBuyAlerts(), new Promise<number>((r) => setTimeout(() => r(-1), 15000))]); }
  catch (e) { console.error('[alerts]', e); }
  return NextResponse.json({ success: true, ...out, alerts });
}
