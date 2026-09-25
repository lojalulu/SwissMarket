// POST /api/scrape — nome antigo, mantido por compatibilidade com runners antigos. Use /api/ingest.
import { POST as ingestPost } from '../ingest/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = ingestPost;
