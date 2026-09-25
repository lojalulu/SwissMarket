// GET /api/recheck?limit=25 — anúncios que o runner deve abrir para confirmar se venderam.
import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/auth';
import { recheckQueue } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 25, 1), 200);
  return NextResponse.json({ success: true, items: recheckQueue(limit) });
}
