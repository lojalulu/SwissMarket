// GET /api/alerts/test — envia uma notificação de teste (protegido pelo INGEST_TOKEN).
//   Ex.: http://IP:3000/api/alerts/test?token=SEU_TOKEN
import { NextResponse } from 'next/server';
import { alertChannels, sendMessage } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-ingest-token');
  if (process.env.INGEST_TOKEN && token !== process.env.INGEST_TOKEN) {
    return NextResponse.json({ success: false, error: 'Token inválido.' }, { status: 401 });
  }
  if (!alertChannels().length) {
    return NextResponse.json({ success: false, error: 'Nenhum canal configurado. Defina NTFY_TOPIC (ou TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) no .env da VPS.' }, { status: 400 });
  }
  const r = await sendMessage('✅ SwissMarket: notificações ligadas', 'Vais receber aqui as oportunidades do Ricardo.', { tags: ['white_check_mark'], priority: 3 });
  return NextResponse.json({ success: r.errors.length === 0, ...r });
}
