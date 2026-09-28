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

// Palavras que indicam "vem junto": "PS5 mit Controller" = consola COM comando (não é só o comando).
const CONNECTORS = new Set(['mit', 'inkl', 'und', 'plus', 'avec', 'et', 'with', 'and', 'con', 'e', 'samt', 'sowie', '2', '3', '4', 'zwei', 'drei', 'deux', 'two']);

/**
 * O termo aparece como objeto principal (não precedido de "mit", "inkl.", "2"…)?
 * Um número só conta como quantidade ("PS5 2 Controller") se NÃO for o fim do nome do modelo
 * ("Quest 3 Controller" = comando do Quest 3 → acessório).
 */
function standaloneTerm(haystack: string, term: string, modelTerms: string[] = []): boolean {
  const t = normalize(term);
  if (!t) return false;
  const words = haystack.split(' ');
  const tw = t.split(' ');
  const endsModel = (i: number) => modelTerms.some((m) => {
    const mw = m.split(' ');
    return i - mw.length >= 0 && mw.every((w, j) => words[i - mw.length + j] === w);
  });
  for (let i = 0; i + tw.length <= words.length; i++) {
    if (tw.every((w, j) => words[i + j] === w)) {
      const prev = words[i - 1];
      if (i === 0 || !CONNECTORS.has(prev)) return true;
      if (/^\d+$/.test(prev) && endsModel(i)) return true;
    }
  }
  return false;
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
  if (product.accessoryTerms?.length && !(product.mainItemTerms ?? []).some((t) => hasTerm(hay, t))) {
    const models = product.mustInclude.flat().map(normalize).filter((m) => /\d$/.test(m));
    const acc = product.accessoryTerms.find((t) => standaloneTerm(hay, t, models));
    if (acc) return { relevant: false, reason: `acessório: ${acc}` };
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

// ───────────────────────────── defeitos na descrição ─────────────────────────────
// Termos que indicam aparelho com defeito/bloqueado (DE/FR/IT/EN), já normalizados como os títulos.
const DEFECT_TERMS = [
  'defekt', 'defekte', 'defektes', 'defect', 'defective', 'kaputt', 'kaputte', 'gebrochen', 'gebrochenes', 'gesprungen',
  'zersprungen', 'sprung', 'sprunge', 'riss', 'risse', 'displayschaden', 'display schaden', 'displaybruch', 'glasbruch',
  'spinnennetz', 'wasserschaden', 'feuchtigkeitsschaden', 'bastler', 'bastlerware', 'ersatzteil', 'ersatzteile', 'für teile',
  'broken', 'cracked', 'crack', 'water damage', 'for parts', 'not working', 'doesnt work',
  'casse', 'cassee', 'fissure', 'fissuré', 'ecran casse', 'ne fonctionne pas', 'ne marche pas', 'hors service', 'pour pieces',
  'rotto', 'rotta', 'crepato', 'crepa', 'non funziona', 'guasto', 'per ricambi',
  'funktioniert nicht', 'geht nicht', 'startet nicht', 'lädt nicht', 'ladet nicht', 'bootloop', 'kein bild', 'kein ton',
  'icloud gesperrt', 'icloud lock', 'aktivierungssperre', 'gesperrt', 'blacklist', 'blacklisted', 'mdm',
  'kein face id', 'ohne face id', 'face id defekt', 'face id geht nicht', 'face id funktioniert nicht', 'touch id defekt',
  'akku defekt', 'akku kaputt', 'verbogen', 'bent', 'geht nicht an', 'ghost touch', 'burn in', 'eingebrannt', 'pixelfehler',
];
const NEGATIONS = new Set(['kein', 'keine', 'keinen', 'keiner', 'keines', 'ohne', 'nicht', 'nie', 'no', 'not', 'without', 'sans', 'aucun', 'aucune', 'pas', 'senza', 'nessun', 'nessuna', 'null', '0', 'zero']);
const DEFECT_NORM = [...new Set(DEFECT_TERMS.map(normalize))].filter(Boolean);

/**
 * Procura um defeito no título/descrição. Ignora negações até 3 palavras antes:
 * "keine Risse" · "nicht defekt" · "ohne Wasserschaden" → não é defeito.
 * Devolve o termo encontrado (ex.: "display schaden") ou null.
 */
export function findDefect(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = normalize(text).split(' ');
  for (const term of DEFECT_NORM) {
    const tw = term.split(' ');
    for (let i = 0; i + tw.length <= words.length; i++) {
      if (!tw.every((w, j) => words[i + j] === w)) continue;
      // termos que já contêm negação ("kein face id") contam sempre
      if (NEGATIONS.has(tw[0])) return term;
      const before = words.slice(Math.max(0, i - 3), i);
      if (before.some((w) => NEGATIONS.has(w))) continue;
      return term;
    }
  }
  return null;
}
