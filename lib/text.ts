// lib/text.ts — normalização de títulos e filtro de relevância (partilhado por runner e API).
import { DEFAULT_EXCLUDE, type ProductConfig } from '../config/products';

/**
 * "Apple iPhone13 128GB – Grün (OVP)" → "apple iphone 13 128 gb grun ovp"
 * Minúsculas, sem acentos (ä→a, ü→u), só [a-z0-9], letras e números separados.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Procura o termo (já normalizado) como sequência de palavras inteiras. */
function hasTerm(haystack: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  return (' ' + haystack + ' ').includes(' ' + t + ' ');
}

export interface RelevanceResult {
  relevant: boolean;
  reason?: string;
}

/** Decide se um anúncio corresponde ao produto (título + slug da URL). O preço é validado à parte. */
export function checkRelevance(title: string, url: string, product: ProductConfig): RelevanceResult {
  const slug = (url.match(/\/a\/([^/?#]+)/)?.[1] ?? '').replace(/-\d{6,}\/?$/, '');
  let slugText = slug;
  try { slugText = decodeURIComponent(slug); } catch { /* slug com % inválido */ }
  const hay = normalize(`${title} ${slugText.replace(/-/g, ' ')}`);

  for (const group of product.mustInclude) {
    if (!group.some((alt) => hasTerm(hay, alt))) {
      return { relevant: false, reason: `falta: ${group.join('/')}` };
    }
  }
  for (const term of [...DEFAULT_EXCLUDE, ...(product.exclude ?? [])]) {
    if (hasTerm(hay, term)) return { relevant: false, reason: `excluído: ${term}` };
  }
  return { relevant: true };
}

/** "1'250.00" / "1’250.–" / "CHF 1 250" / "250.-" → número (ou null). */
export function parseChf(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const cleaned = raw
    .replace(/CHF|Fr\.?/gi, '')
    .replace(/[’'\s  ]/g, '')
    .replace(/\.[-–—]+$/, '')
    .replace(/,(\d{2})$/, '.$1')
    .replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
