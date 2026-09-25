// GET /api/closing?within=240 — leilões com lances que terminam em breve (o runner espreita-os antes do fim).
import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/auth';
import { closingSoon } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  const within = Math.min(Math.max(Number(new URL(req.url).searchParams.get('within')) || 240, 10), 24 * 60);
  return NextResponse.json({ success: true, items: closingSoon(within) });
}
