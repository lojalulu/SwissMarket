// lib/auth.ts — protege as rotas de escrita com um token partilhado (INGEST_TOKEN).
// A VPS está exposta num IP público: sem token, qualquer pessoa poderia injetar preços falsos.
import { NextResponse } from 'next/server';

let warned = false;

export function checkToken(req: Request): NextResponse | null {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    if (!warned) { console.warn('[auth] INGEST_TOKEN não definido — rotas de escrita estão ABERTAS.'); warned = true; }
    return null;
  }
  const got = req.headers.get('x-ingest-token') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (got !== expected) return NextResponse.json({ success: false, error: 'Token inválido.' }, { status: 401 });
  return null;
}
