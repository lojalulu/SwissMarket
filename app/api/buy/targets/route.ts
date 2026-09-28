// GET /api/buy/targets — o que o runner deve procurar no Tutti/Anibis (produtos que já têm "comprar até").
import { NextResponse } from 'next/server';
import { buyTargets, enabledBuySources } from '@/lib/buy';
import { checkToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  return NextResponse.json({ success: true, sources: enabledBuySources(), products: buyTargets() });
}
