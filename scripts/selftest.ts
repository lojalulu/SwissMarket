// scripts/selftest.ts — testes offline do parser, filtro de relevância, estatística e base de dados.
// Uso: npm test   (não precisa de internet nem de Chromium)
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmarket-test-'));
process.env.DATA_DIR = tmp;

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  ✔ ${name}`); },
    (e) => { console.error(`  ✘ ${name}\n    ${e?.message ?? e}`); process.exitCode = 1; },
  );
}

async function main() {
  const { parseSearchPage, parseDetailPage, parseTimeLeft, isChallengePage } = await import('../lib/parse');
  const { checkRelevance, normalize, parseChf } = await import('../lib/text');
  const { dist, maxBuyFor, computeProductStats } = await import('../lib/stats');
  const { getProduct } = await import('../config/products');
  const store = await import('../lib/store');
  const iphone = getProduct('iphone-13')!;
  const now = new Date('2026-09-25T18:00:00Z');

  console.log('\nparser');
  const page = parseSearchPage(fx('search-iphone13.html'), now);
  const byId = Object.fromEntries(page.items.map((i) => [i.id, i]));

  await test('lê todos os cards visíveis e ignora o item escondido do JSON', () => {
    assert.equal(page.items.length, 9);
    assert.equal(byId['9999999999'], undefined);
  });
  await test('preços sem prefixo CHF (bug do runner antigo que gravava 0)', () => {
    assert.equal(byId['1330575112'].buyNowPrice, 219);
    assert.equal(byId['1330575112'].mode, 'buynow');
    assert.equal(byId['1330000001'].buyNowPrice, 1310);
    assert.equal(byId['1330575112'].title, 'IPhone 13 128GB Schwarz inkl. Garantie + Starterpaket');
  });
  await test('leilão híbrido: lance + lances + Sofort kaufen', () => {
    const h = byId['1330506986'];
    assert.equal(h.mode, 'hybrid');
    assert.equal(h.bidPrice, 76);
    assert.equal(h.bids, 9);
    assert.equal(h.buyNowPrice, 230);
    assert.equal(h.endDate, '2026-09-25T23:40:00.000Z'); // data exata do __NEXT_DATA__
  });
  await test('preço genérico do JSON-LD não transforma leilão em Sofort kaufen', () => {
    const r = byId['1328648876'];
    assert.equal(r.mode, 'auction');
    assert.equal(r.bidPrice, 250);
    assert.equal(r.buyNowPrice, null);
  });
  await test('leilão com lances e condição vindos do __NEXT_DATA__', () => {
    const a = byId['1330000002'];
    assert.equal(a.mode, 'auction');
    assert.equal(a.bids, 14);
    assert.equal(a.bidPrice, 345);
    assert.equal(a.condition, 'used');
  });
  await test('tempo restante do card vira data de fim aproximada', () => {
    const t = byId['1328648876'].endDate!;
    assert.equal(new Date(t).getTime() - now.getTime(), (2 * 24 + 5) * 3600e3);
    assert.ok(parseTimeLeft('5Std 12Min', now));
    assert.equal(parseTimeLeft('iPhone 13 128 GB', now), null);
  });
  await test('página de desafio Cloudflare é detetada', () => {
    assert.ok(isChallengePage(fx('challenge.html')));
    assert.equal(parseSearchPage(fx('challenge.html')).challenge, true);
  });

  console.log('\nrelevância');
  const rel = (id: string) => checkRelevance(byId[id].title, byId[id].url, iphone);
  await test('aceita iPhone 13 128GB real', () => {
    assert.ok(rel('1330575112').relevant);
    assert.ok(rel('1330506986').relevant);
    assert.ok(rel('1330000002').relevant);
  });
  await test('rejeita Pro, mini, capa e defeituoso', () => {
    assert.equal(rel('1330577958').relevant, false);
    assert.match(rel('1330546804').reason!, /mini/);
    assert.equal(rel('1330000003').relevant, false);
    assert.match(rel('1330000004').reason!, /defekt/);
  });
  await test('normalização e parse de CHF', () => {
    assert.equal(normalize('iPhone13 128GB – Grün'), 'iphone 13 128 gb grun');
    assert.equal(parseChf("1'250.00"), 1250);
    assert.equal(parseChf('CHF 250.–'), 250);
    assert.equal(parseChf('1’310.00'), 1310);
  });

  console.log('\nestatística');
  await test('IQR remove outliers', () => {
    const d = dist([300, 310, 320, 330, 340, 350, 1500]);
    assert.equal(d.n, 6);
    assert.equal(d.outliers, 1);
    assert.equal(d.median, 325);
  });
  await test('preço máximo de compra (margem 20 %, lucro mín. 40, comissão 10 %)', () => {
    const b = maxBuyFor(400, iphone);
    // líquido = 400 − 40 − 5 = 355 → min(355/1.2=295.8, 355−40=315) = 295.8 → 295
    assert.equal(b.net, 355);
    assert.equal(b.maxBuy, 295);
    assert.equal(b.profitAtMaxBuy, 60);
  });
  await test('comissão respeita o teto de CHF 290', () => {
    assert.equal(maxBuyFor(5000, getProduct('lv-neverfull')!).fee, 290);
  });

  console.log('\nbase de dados (ingest → verificação → estatística)');
  await test('ingest guarda relevantes e rejeita o resto com motivo', () => {
    const r = store.ingest({ productId: 'iphone-13', searchTerm: 'iphone 13 128gb', scrapedAt: now.toISOString(), items: page.items, complete: true });
    assert.equal(r.received, 9);
    assert.equal(r.relevant, 4); // rosa (128 GB é a base), schwarz, rot, blau — 1'310 fora da faixa
    assert.ok(r.rejected.some((x) => x.reason === 'preço fora da faixa'));
  });
  await test('detalhe de leilão terminado com lances → vendido (confirmado)', () => {
    const later = new Date('2026-09-27T08:00:00Z');
    const q = store.recheckQueue(10, later);
    assert.ok(q.some((x) => x.id === '1330000002'), 'leilão terminado deve estar na fila');
    const sig = parseDetailPage('1330000002', fx('detail-ended-auction.html'));
    assert.equal(sig.ended, true);
    assert.equal(sig.bids, 17);
    assert.equal(sig.currentPrice, 362);
    const out = store.applyDetails([{ ...sig, productId: 'iphone-13' }], later);
    assert.equal(out.sold, 1);
    const rec = store.recordsFor('iphone-13').find((r) => r.id === '1330000002')!;
    assert.equal(rec.status, 'sold');
    assert.equal(rec.finalPrice, 362);
    assert.equal(rec.soldEvidence, 'detail');
  });
  await test('detalhe ativo mantém o anúncio ativo', () => {
    const sig = parseDetailPage('1330575112', fx('detail-active.html'));
    assert.equal(sig.ended, false);
  });
  await test('Sofort kaufen marcado como verkauft → vendido ao preço fixo', () => {
    const sig = parseDetailPage('1330575112', fx('detail-sold-buynow.html'));
    assert.equal(sig.ended, true);
    assert.equal(sig.soldMarker, true);
    store.applyDetails([{ ...sig, productId: 'iphone-13' }], new Date('2026-09-26T10:00:00Z'));
    const rec = store.recordsFor('iphone-13').find((r) => r.id === '1330575112')!;
    assert.equal(rec.status, 'sold');
    assert.equal(rec.finalPrice, 219);
    assert.equal(rec.soldVia, 'buynow');
  });
  await test('estatística completa com 12 vendas simuladas', () => {
    const base = new Date('2026-09-01T10:00:00Z').getTime();
    const prices = [330, 345, 350, 355, 360, 362, 365, 370, 372, 380, 390, 410];
    const items = prices.map((p, i) => ({
      id: String(1340000000 + i), title: `iPhone 13 128GB Nr ${i}`, url: `https://www.ricardo.ch/de/a/iphone-13-128gb-${1340000000 + i}/`,
      mode: 'auction' as const, bidPrice: p, buyNowPrice: null, bids: 8, endDate: new Date(base + i * 36e5).toISOString(), condition: null, source: 'test',
    }));
    store.ingest({ productId: 'iphone-13', searchTerm: 'x', scrapedAt: new Date(base - 2 * 864e5).toISOString(), items, complete: false });
    store.applyDetails(items.map((it) => ({
      id: it.id, productId: 'iphone-13', removed: false, ended: true, soldMarker: false, bids: 8,
      currentPrice: it.bidPrice, buyNowPrice: null, condition: null, endDate: it.endDate,
    })), new Date('2026-09-20T10:00:00Z'));
    const s = computeProductStats(iphone, store.recordsFor('iphone-13'), store.runsFor('iphone-13'), new Date('2026-09-27T12:00:00Z'), 30);
    assert.equal(s.pricing.basis, 'vendidos');
    assert.equal(s.pricing.confidence, 'alta');
    assert.ok(s.sold.n >= 12);
    assert.ok(s.pricing.recommended!.maxBuy! > 200 && s.pricing.recommended!.maxBuy! < 300, `maxBuy=${s.pricing.recommended!.maxBuy}`);
    assert.ok(s.liquidity.salesPer30d! > 0);
    console.log(`    → média ${s.sold.mean} · mediana ${s.sold.median} · revenda rápida ${s.pricing.resaleQuick} · comprar até ${s.pricing.recommended!.maxBuy} · liquidez ${s.liquidity.label} (${s.liquidity.score})`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${process.exitCode ? '❌ Falhas encontradas' : `✅ ${passed} testes OK`}\n`);
}

main();
