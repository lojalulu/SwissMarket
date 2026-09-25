// POST /api/ingest/details — resultado da verificação de anúncios (vendido / não vendido / ativo).
import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/auth';
import { applyDetails } from '@/lib/store';
import type { DetailSignals } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = checkToken(req);
  if (denied) return denied;
  let body: { results?: (DetailSignals & { productId: string })[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 }); }
  if (!Array.isArray(body.results)) return NextResponse.json({ success: false, error: 'Forneça results[].' }, { status: 400 });
  return NextResponse.json({ success: true, ...applyDetails(body.results.slice(0, 500)) });
}
