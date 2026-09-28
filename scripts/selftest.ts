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

  console.log('\npágina REAL do Ricardo (25/09/2026)');
  const real = parseSearchPage(fx('real-search-iphone13.html'), new Date('2026-09-25T18:12:35Z'));
  const rb = Object.fromEntries(real.items.map((i) => [i.id, i]));
  await test('lê os 60 anúncios e o payload RSC do App Router', () => {
    assert.equal(real.items.length, 60);
    assert.equal(real.sources.nextData, 60);
  });
  await test('título vem do produto, não da etiqueta "Beliebt"/"Boost"', () => {
    assert.equal(rb['1330050792'].title, 'iPhone 13, blau 128 Gb');
    assert.ok(!real.items.some((i) => /^(Beliebt|Boost|Neuheit)$/.test(i.title)));
  });
  await test('leilão com 296 lances, data de fim exata e condição', () => {
    const a = rb['1330050792'];
    assert.equal(a.mode, 'auction');
    assert.equal(a.bids, 296);
    assert.equal(a.bidPrice, 203);
    assert.equal(a.endDate, '2026-09-26T11:37:00.000Z');
    assert.equal(a.condition, 'acceptable');
    assert.equal(a.startDate, '2026-09-19T11:39:00.000Z');
  });
  await test('Sofort kaufen puro fica como buynow (sem lance)', () => {
    const b = rb['1330575112'];
    assert.equal(b.mode, 'buynow');
    assert.equal(b.buyNowPrice, 219);
    assert.equal(b.bidPrice, null);
  });
  await test('data do card "Di, 29 Sep., 16:00" (hora de Zurique) → UTC', () => {
    assert.equal(parseTimeLeft('Di, 29 Sep., 16:00', now), '2026-09-29T14:00:00.000Z');
    assert.equal(parseTimeLeft('Fr, 2 Okt., 07:42', now), '2026-10-02T05:42:00.000Z');
    assert.equal(parseTimeLeft('Mo, 7 Dez., 10:00', now), '2026-12-07T09:00:00.000Z');
  });
  await test('Pro, mini e defeituosos da página real são rejeitados', () => {
    const rejected = real.items.filter((i) => !checkRelevance(i.title, i.url, iphone).relevant);
    assert.equal(rejected.length, 11);
    assert.ok(rejected.every((i) => /pro|mini|defekt|bastler|kaputt/i.test(i.title)));
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
  await test('produtos novos: iPhones Pro/Pro Max/15–17, Switch 2, AirPods Pro 3…', () => {
    const g = (id: string) => getProduct(id)!;
    const cases: [string,string,boolean][] = [
     ['iphone-15-pro-max','Apple iPhone 15 Pro Max 256GB Titan',true],
     ['iphone-15-pro-max','iPhone 15 Pro Max 512GB',false],
     ['iphone-15-pro','iPhone 15 Pro Max',false],
     ['iphone-15-pro','iPhone 15 Pro 128 GB schwarz',true],
     ['iphone-15','iPhone 15 Plus',false],
     ['iphone-15','iPhone 15 128GB blau',true],
     ['iphone-17-pro','iPhone 17 Pro 256GB Cosmic Orange',true],
     ['iphone-17-pro-max','iPhone 17 Pro Max',true],
     ['iphone-13-pro','iPhone 13 Pro 128gb',true],
     ['iphone-13-pro','iPhone 13 Pro Hülle',false],
     ['switch-2','Nintendo Switch 2 Konsole + Mario Kart World',true],
     ['switch-2','Nintendo Switch OLED',false],
     ['switch-oled','Nintendo Switch OLED weiss',true],
     ['airpods-pro-3','Apple AirPods Pro 3',true],
     ['airpods-pro-2','Apple AirPods Pro 3',false],
     ['airpods-pro-2','AirPods Pro 2. Generation USB-C',true],
     ['sony-wh1000xm5','Sony WH-1000XM5 schwarz',true],
     ['apple-watch-ultra-2','Apple Watch Ultra 2 49mm Titan',true],
     ['apple-watch-ultra-2','Armband für Apple Watch Ultra 2',false],
     ['ps5-pro','Sony PlayStation 5 Pro 2TB',true],
     ['ps5','Sony PlayStation 5 Pro 2TB',false],
     ['galaxy-s24-ultra','Samsung Galaxy S24 Ultra 256GB',true],
     ['dyson-airwrap','Dyson Airwrap Complete Long',true],
    ];
    for (const [id, t, exp] of cases) assert.equal(checkRelevance(t, '', g(id)).relevant, exp, `${id}: ${t}`);
  });
  await test('acessórios vs. produto (PS5, Dyson, Sony, Switch 2) — "mit Controller" é bundle', () => {
    const T: [string,string,boolean][] = [
     ['ps5','manette ps5',false],['ps5','PlayStation 5 HD Kamera mit Kabel gebrauchter Zustand',false],['ps5','Sony PlayStation 5 Disc Edition',true],
     ['ps5','PS5 Konsole inkl. 2 Controller',true],['ps5','Playstation 5 mit Controller',true],['ps5','PS5 Kamera mit Kabel',false],['ps5','Sony Playstation 5 825GB',true],
     ['ps5','PS5 Controller Ladestation',false],['ps5','Playstation 5 Slim + 2 Spiele',true],
     ['dyson-airwrap','Neuwertig! Dyson Airwrap™ Small Firm Smoothing Brush',false],['dyson-airwrap','Dyson Airwrap Complete Long',true],
     ['dyson-airwrap','Dyson Airwrap Multistyler mit allen Aufsätzen',true],['dyson-airwrap','Dyson Airwrap',true],
     ['sony-wh1000xm5','Sony WF-1000XM5 in ear',false],['sony-wh1000xm5','Sony WH-1000XM5 schwarz',true],
     ['switch-2','Nintendo Switch 2 Pro Controller',false],['switch-2','Nintendo Switch 2 Konsole',true],['switch-2','Nintendo Switch 2',true],
    ];
    for (const [id, t, e] of T) assert.equal(checkRelevance(t, '', getProduct(id)!).relevant, e, t);
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

  await test('leilão visto ~10 min antes do fim → vendido (inferido) ao último lance', () => {
    const endMs = Date.now() - 40 * 60e3;
    const seen = new Date(endMs - 10 * 60e3).toISOString();
    store.ingest({ productId: 'iphone-13', searchTerm: 'x', scrapedAt: seen, complete: false, items: [{
      id: '1377000001', title: 'iPhone 13 128GB', url: 'https://www.ricardo.ch/de/a/iphone-13-1377000001/', mode: 'auction',
      bidPrice: 311, buyNowPrice: null, bids: 23, endDate: new Date(endMs).toISOString(), condition: null, source: 'test',
    }] });
    const r = store.recordsFor('iphone-13').find((x) => x.id === '1377000001')!;
    assert.equal(r.status, 'sold');
    assert.equal(r.finalPrice, 311);
    assert.equal(r.soldEvidence, 'inferred');
    const soon = store.closingSoon(600);
    assert.ok(Array.isArray(soon));
  });

  await test('categoria aprendida: jogos/comandos (outra categoria) saem do Switch 2', () => {
    const t = new Date().toISOString();
    const base = { mode: 'buynow' as const, bidPrice: null, bids: 0, endDate: new Date(Date.now() + 5 * 864e5).toISOString(), condition: 'like_new', source: 'test' };
    const consoles = Array.from({ length: 6 }, (_, i) => ({ ...base, id: String(1500000000 + i), title: `Nintendo Switch 2 Konsole ${i}`, url: `https://www.ricardo.ch/de/a/switch-2-${1500000000 + i}/`, buyNowPrice: 380 + i * 10, categoryId: '40001' }));
    const game = { ...base, id: '1500000100', title: 'Kirby Air Riders Switch 2', url: 'https://www.ricardo.ch/de/a/kirby-1500000100/', mode: 'auction' as const, buyNowPrice: null, bidPrice: 25, bids: 0, categoryId: '40999' };
    const broken = { ...base, id: '1500000101', title: 'Nintendo Switch 2 Konsole', url: 'https://www.ricardo.ch/de/a/sw-1500000101/', buyNowPrice: 300, categoryId: '40001', condition: 'damaged' };
    const r = store.ingest({ productId: 'switch-2', searchTerm: 'nintendo switch 2', scrapedAt: t, complete: false, items: [...consoles, game, broken] });
    assert.equal(r.relevant, 6);
    assert.ok(r.rejected.some((x) => x.reason.startsWith('outra categoria')));
    assert.ok(r.rejected.some((x) => x.reason.startsWith('estado')));
  });
  await test('Sofort que some com inventário completo à vista → venda provável', () => {
    const t1 = new Date(Date.now() - 6 * 3600e3).toISOString();
    const t2 = new Date(Date.now() - 3 * 3600e3).toISOString();
    const t3 = new Date().toISOString();
    const mk = (id: number, price: number) => ({ id: String(id), title: 'Sony WH-1000XM5 schwarz', url: `https://www.ricardo.ch/de/a/sony-${id}/`, mode: 'buynow' as const,
      bidPrice: null, buyNowPrice: price, bids: 0, endDate: new Date(Date.now() + 9 * 864e5).toISOString(), condition: null, source: 'test' });
    const all = [mk(1600000001, 220), mk(1600000002, 240), mk(1600000003, 260)];
    store.ingest({ productId: 'sony-wh1000xm5', searchTerm: 'x', scrapedAt: t1, complete: true, items: all });
    store.ingest({ productId: 'sony-wh1000xm5', searchTerm: 'x', scrapedAt: t2, complete: true, items: all.slice(1) });
    store.ingest({ productId: 'sony-wh1000xm5', searchTerm: 'x', scrapedAt: t3, complete: true, items: all.slice(1) });
    const r = store.recordsFor('sony-wh1000xm5').find((x) => x.id === '1600000001')!;
    assert.equal(r.status, 'gone');
    const still = store.recordsFor('sony-wh1000xm5').find((x) => x.id === '1600000002')!;
    assert.equal(still.status, 'active');
  });

  console.log('\nradar e alertas');
  await test('extras do Ricardo: portes, retirada, cidade, foto, propostas', () => {
    const b = rb['1330575112'];
    assert.equal(b.shippingCost, 9);
    assert.equal(b.pickup, true);
    assert.equal(b.city, 'Spiegel b. Bern');
    assert.equal(b.zip, '3095');
    assert.equal(b.canOffer, false);
    assert.match(b.image!, /^https:\/\/img\.ricardostatic\.ch/);
    assert.ok(real.items.filter((i) => i.canOffer).length >= 5);
  });
  await test('radar: comprar já, leilão a terminar e proposta (com portes e retirada perto)', () => {
    const { computeProductStats: cps } = require('../lib/stats') as typeof import('../lib/stats');
    const t0 = new Date('2026-09-27T12:00:00Z');
    const mk = (id: string, o: Partial<import('../lib/types').ListingRecord>): import('../lib/types').ListingRecord => ({
      id, productId: 'iphone-13', title: `iPhone 13 ${id}`, url: `https://www.ricardo.ch/de/a/x-${id}/`, mode: 'buynow',
      bidPrice: null, buyNowPrice: null, bids: 0, endDate: '2026-10-05T10:00:00Z', condition: null, relevant: true,
      firstSeen: '2026-09-20T10:00:00Z', lastSeen: t0.toISOString(), seenCount: 3, history: [], status: 'active',
      finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null, checkAttempts: 0, lastCheckAt: null, ...o,
    });
    const soldRecs = [330, 345, 350, 355, 360, 362, 365, 370, 372, 380].map((p, i) => mk(`s${i}`, {
      mode: 'auction', status: 'sold', finalPrice: p, soldVia: 'auction', soldEvidence: 'detail',
      closedAt: `2026-09-2${i % 6}T19:00:00Z`, bids: 8,
    }));
    const recs = [
      ...soldRecs,
      mk('cheap-near', { buyNowPrice: 220, shippingCost: 9, pickup: true, zip: '3011', city: 'Bern' }),
      mk('cheap-far', { buyNowPrice: 250, shippingCost: 9, pickup: false, zip: '1200', city: 'Genève' }),
      mk('offer', { buyNowPrice: 300, canOffer: true, shippingCost: 0 }),
      mk('pricey', { buyNowPrice: 420 }),
      mk('auction', { mode: 'auction', bidPrice: 150, bids: 12, endDate: '2026-09-27T14:30:00Z' }),
      mk('auction-far', { mode: 'auction', bidPrice: 150, bids: 12, endDate: '2026-09-30T14:30:00Z' }),
    ];
    const runs = [{ at: '2026-09-20T10:00:00Z', found: 60, relevant: 40, complete: true }, { at: t0.toISOString(), found: 60, relevant: 40, complete: true }];
    const st = cps(iphone, recs, runs, t0, 30);
    const byId = Object.fromEntries(st.opportunities.map((o) => [o.id, o]));
    const max = st.pricing.recommended!.maxBuy!;
    assert.equal(byId['cheap-near'].kind, 'buynow');
    assert.equal(byId['cheap-near'].nearby, true);
    assert.equal(byId['cheap-near'].cost, 220);          // retirada perto → sem portes
    if (byId['cheap-far']) assert.equal(byId['cheap-far'].cost, 259); // portes somados
    assert.equal(byId['offer'].kind, 'offer');
    assert.equal(byId['offer'].offerPrice, max);
    assert.equal(byId['pricey'], undefined);
    assert.equal(byId['auction'].kind, 'auction');
    assert.ok(byId['auction'].minutesLeft! > 0 && byId['auction'].minutesLeft! <= 150);
    assert.equal(byId['auction-far'], undefined);         // termina daqui a 3 dias → não é urgente
    assert.equal(byId['auction'].maxBid, max);             // sem portes (shipping indefinido)
    assert.equal(byId['auction'].estProfit, st.pricing.recommended!.profitAtMaxBuy); // pior caso
    assert.equal(byId['cheap-near'].suspicious, false);
    assert.ok(st.sell.buyNowPrice! > 350);
    assert.ok(st.liquidity.daysOfSupply !== null);
    const { formatAlert } = require('../lib/alerts') as typeof import('../lib/alerts');
    const msg = formatAlert(byId['auction'], st);
    assert.match(msg.title, /leilão acaba em/);
    assert.match(formatAlert(byId['offer'], st).title, /ofereça CHF/);
  });

  await test('liquidez: poucos anúncios + vendas conta como giro (oferta vs. vendas)', () => {
    const { computeProductStats: cps } = require('../lib/stats') as typeof import('../lib/stats');
    const t0 = new Date('2026-09-27T17:00:00Z');
    const mk = (id: string, o: Partial<import('../lib/types').ListingRecord>): import('../lib/types').ListingRecord => ({
      id, productId: 'iphone-13', title: `iPhone 13 ${id}`, url: `https://www.ricardo.ch/de/a/x-${id}/`, mode: 'buynow',
      bidPrice: null, buyNowPrice: null, bids: 0, endDate: '2026-10-05T10:00:00Z', condition: null, relevant: true,
      firstSeen: '2026-09-25T10:00:00Z', lastSeen: t0.toISOString(), seenCount: 3, history: [], status: 'active',
      finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null, checkAttempts: 0, lastCheckAt: null, ...o,
    });
    const runs = [{ at: '2026-09-24T17:00:00Z', found: 60, relevant: 40, complete: true }, { at: t0.toISOString(), found: 60, relevant: 40, complete: true }];
    const sales = [350, 355, 360].map((v, i) => mk(`s${i}`, { mode: 'auction', status: 'sold', finalPrice: v, soldEvidence: 'inferred', closedAt: `2026-09-2${5 + i}T19:00:00Z`, bids: 9 }));
    const few = cps(iphone, [...sales, mk('a', { buyNowPrice: 370 }), mk('b', { buyNowPrice: 380 })], runs, t0, 30);
    const many = cps(iphone, [...sales, ...Array.from({ length: 30 }, (_, i) => mk(`m${i}`, { buyNowPrice: 370 }))], runs, t0, 30);
    assert.ok(few.liquidity.daysOfSupply! < many.liquidity.daysOfSupply!, 'menos oferta → menos dias de estoque');
    assert.ok(few.liquidity.score! > many.liquidity.score!, `poucos anúncios ${few.liquidity.score} > muitos ${many.liquidity.score}`);
    assert.ok(few.liquidity.daysOfSupplyWorst! > few.liquidity.daysOfSupply!, 'pior caso é mais prudente');
    // Sofort muito caro não conta como concorrência.
    const pricey = cps(iphone, [...sales, mk('a', { buyNowPrice: 370 }), ...Array.from({ length: 10 }, (_, i) => mk(`p${i}`, { buyNowPrice: 900 }))], runs, t0, 30);
    assert.equal(pricey.liquidity.competingListings, 1);
    // 1 venda vale menos que 3.
    const one = cps(iphone, [sales[0], mk('a', { buyNowPrice: 370 }), mk('b', { buyNowPrice: 380 })], runs, t0, 30);
    assert.ok(one.liquidity.score! < few.liquidity.score!);
    console.log(`    → 2 anúncios: ${few.liquidity.score} · 30 anúncios: ${many.liquidity.score} · 1 venda só: ${one.liquidity.score}`);
  });

  await test('liquidez: sem vendas nunca é "rápido"; 1 leilão com 250 lances não infla a procura', () => {
    const { computeProductStats: cps } = require('../lib/stats') as typeof import('../lib/stats');
    const t0 = new Date('2026-09-28T07:00:00Z');
    const mk = (id: string, o: Partial<import('../lib/types').ListingRecord>): import('../lib/types').ListingRecord => ({
      id, productId: 'iphone-13', title: `iPhone 13 ${id}`, url: `https://www.ricardo.ch/de/a/x-${id}/`, mode: 'auction',
      bidPrice: 100, buyNowPrice: null, bids: 0, endDate: '2026-10-02T10:00:00Z', condition: null, relevant: true,
      firstSeen: '2026-09-27T10:00:00Z', lastSeen: t0.toISOString(), seenCount: 3, history: [], status: 'active',
      finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null, checkAttempts: 0, lastCheckAt: null, ...o,
    });
    // Caso MacBook M4: 7 leilões, 3 com lances (média 37 por causa de 1 com 230), 0 vendas.
    const bids = [230, 20, 9, 0, 0, 0, 0];
    const recs = [...bids.map((b, i) => mk(`a${i}`, { bids: b })), ...[380, 390, 400, 410, 420].map((v, i) => mk(`b${i}`, { mode: 'buynow', bidPrice: null, buyNowPrice: v }))];
    const runs = [{ at: '2026-09-27T12:00:00Z', found: 12, relevant: 12, complete: true }, { at: t0.toISOString(), found: 12, relevant: 12, complete: true }];
    const st = cps(iphone, recs, runs, t0, 30);
    assert.notEqual(st.liquidity.label, 'rapido');
    assert.ok(st.liquidity.score! <= 59, `score ${st.liquidity.score}`);
    const proc = st.liquidity.components.find((c) => c.key === 'procura')!;
    assert.ok(proc.value < 50, `procura ${proc.value}`);
    assert.equal(st.potential, null, 'sem vendas não há potencial');
    console.log(`    → M4-like: giro ${st.liquidity.score} (${st.liquidity.label}), procura ${proc.value}`);
  });
  await test('tendência Theil–Sen: preço a cair desconta a revenda; 1 outlier não muda', () => {
    const { priceTrend, computeProductStats: cps } = require('../lib/stats') as typeof import('../lib/stats');
    const day = 864e5, t = Date.parse('2026-09-01T12:00:00Z');
    // 400 → 372 em 14 dias (−2 CHF/dia = −14/semana) + 1 venda absurda a 900.
    const pts = Array.from({ length: 15 }, (_, i) => ({ t: t + i * day, v: 400 - 2 * i }));
    const tr = priceTrend([...pts, { t: t + 7 * day, v: 900 }])!;
    assert.ok(Math.abs(tr.chfPerWeek + 14) < 1.5, `declive ${tr.chfPerWeek}`);
    assert.ok(tr.pctPerWeek < -3 && tr.pctPerWeek > -4.5, `% ${tr.pctPerWeek}`);
    assert.equal(priceTrend(pts.slice(0, 5)), null, 'poucos dados → sem tendência');
    const mk = (i: number, v: number): import('../lib/types').ListingRecord => ({
      id: `t${i}`, productId: 'iphone-13', title: `iPhone 13 t${i}`, url: `https://www.ricardo.ch/de/a/x-t${i}/`, mode: 'auction',
      bidPrice: v, buyNowPrice: null, bids: 9, endDate: new Date(t + i * day).toISOString(), condition: null, relevant: true,
      firstSeen: new Date(t + i * day - 5 * day).toISOString(), lastSeen: new Date(t + i * day).toISOString(), seenCount: 3, history: [],
      status: 'sold', finalPrice: v, soldVia: 'auction', soldEvidence: 'inferred', closedAt: new Date(t + i * day).toISOString(), checkAttempts: 0, lastCheckAt: null,
    });
    const now = new Date(t + 15 * day);
    const runs = [{ at: new Date(t - day).toISOString(), found: 60, relevant: 40, complete: true }, { at: now.toISOString(), found: 60, relevant: 40, complete: true }];
    const st = cps(iphone, pts.map((p, i) => mk(i, p.v)), runs, now, 30);
    assert.ok(st.trend && st.trend.appliedCHF < 0, 'revenda deve ser descontada');
    assert.ok(st.potential && st.potential.expectedProfit7d > 0);
    console.log(`    → tendência ${st.trend!.pctPerWeek}%/sem, desconto ${st.trend!.appliedCHF} CHF, potencial ${st.potential!.expectedProfit7d}/sem`);
  });

  await test('malas: carteira/cinto/porta-cartões não contam como a mala (Gucci Marmont Geldtasche)', () => {
    const g = getProduct('gucci-marmont')!;
    for (const t of ['Gucci Marmont Geldtasche', 'Gucci GG Marmont Portemonnaie', 'Gucci Marmont Kartenhalter schwarz', 'GUCCI Marmont Gürtel 85', 'Gucci Marmont card holder'])
      assert.equal(checkRelevance(t, '', g).relevant, false, t);
    for (const t of ['Gucci GG Marmont Tasche schwarz mit Kette', 'Gucci Marmont small shoulder bag', 'Gucci Marmont Mini Bag rosa'])
      assert.equal(checkRelevance(t, '', g).relevant, true, t);
    assert.equal(checkRelevance('Louis Vuitton Speedy Schlüsselanhänger', '', getProduct('lv-speedy')!).relevant, false);
  });
  await test('leilão que saiu da 1ª página dias antes do fim NÃO conta como venda ao lance antigo', () => {
    const t = new Date('2026-09-28T12:00:00Z');
    const mk = (id: string, lastSeen: string, bid: number): import('../lib/types').ListingRecord => ({
      id, productId: 'iphone-13', title: `iPhone 13 ${id}`, url: `https://www.ricardo.ch/de/a/x-${id}/`, mode: 'auction',
      bidPrice: bid, buyNowPrice: null, bids: 6, endDate: '2026-09-24T19:00:00Z', condition: null, relevant: true,
      firstSeen: '2026-09-20T10:00:00Z', lastSeen, seenCount: 3, history: [], status: 'active',
      finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null, checkAttempts: 0, lastCheckAt: null,
    });
    const db = store.withDb((d) => d, false);
    db.listings['iphone-13:1399000001'] = mk('1399000001', '2026-09-21T10:00:00Z', 80);  // visto 3 dias antes do fim
    db.listings['iphone-13:1399000002'] = mk('1399000002', '2026-09-24T18:56:00Z', 290); // visto 4 min antes do fim
    store.maintain(t);
    const recs = store.effectiveRecords('iphone-13');
    const early = recs.find((r) => r.id === '1399000001')!, late = recs.find((r) => r.id === '1399000002')!;
    assert.equal(early.status, 'gone');
    assert.equal(early.finalPrice, null);
    assert.equal(late.status, 'sold');
    assert.equal(late.finalPrice, 290);
    // registo antigo já fechado como "vendido" pela regra velha → corrigido na leitura
    db.listings['iphone-13:1399000003'] = { ...mk('1399000003', '2026-09-21T10:00:00Z', 70), status: 'sold', finalPrice: 70, soldVia: 'auction', soldEvidence: 'inferred', closedAt: '2026-09-24T19:00:00Z' };
    assert.equal(store.effectiveRecords('iphone-13').find((r) => r.id === '1399000003')!.status, 'gone');
  });

  await test('3 vendas reais: revenda usa só as vendas (lances a decorrer não puxam para baixo)', () => {
    const t = new Date('2026-09-28T12:00:00Z');
    const mk = (id: string, o: Partial<import('../lib/types').ListingRecord>): import('../lib/types').ListingRecord => ({
      id, productId: 'iphone-13', title: `iPhone 13 ${id}`, url: `https://www.ricardo.ch/de/a/x-${id}/`, mode: 'auction',
      bidPrice: null, buyNowPrice: null, bids: 0, endDate: '2026-10-05T10:00:00Z', condition: null, relevant: true,
      firstSeen: '2026-09-25T10:00:00Z', lastSeen: t.toISOString(), seenCount: 3, history: [], status: 'active',
      finalPrice: null, soldVia: null, soldEvidence: null, closedAt: null, checkAttempts: 0, lastCheckAt: null, ...o,
    });
    const sold = [160, 172, 181].map((v, i) => mk(`s${i}`, { status: 'sold', finalPrice: v, soldEvidence: 'inferred', soldVia: 'auction', bids: 12, closedAt: `2026-09-2${6 + i}T19:00:00Z`, endDate: `2026-09-2${6 + i}T19:00:00Z` }));
    const live = [90, 100, 110, 120].map((v, i) => mk(`l${i}`, { bidPrice: v, bids: 6, endDate: '2026-09-28T13:00:00Z' }));
    const runs = [{ at: '2026-09-25T10:00:00Z', found: 60, relevant: 40, complete: true }, { at: t.toISOString(), found: 60, relevant: 40, complete: true }];
    const st = computeProductStats(iphone, [...sold, ...live], runs, t, 30);
    assert.equal(st.pricing.basis, 'vendidos');
    assert.equal(st.pricing.confidence, 'baixa');
    assert.ok(st.pricing.resaleQuick! >= 160, `revenda ${st.pricing.resaleQuick}`);
  });

  console.log('\nTutti / Anibis (lado da compra)');
  const { parseClassifiedSearch, parseClassifiedDetail, sellerTrust, parsePosted } = await import('../lib/classifieds');
  const geo = await import('../lib/geo');
  const buy = await import('../lib/buy');
  const t0 = new Date('2026-09-28T09:30:00Z');

  await test('cards do Tutti: título, preço "590.-", local e código postal, data "Heute 10:54"', () => {
    const r = parseClassifiedSearch(fx('tutti-search-cards.html'), 'tutti', t0);
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    assert.equal(r.items.length, 6);
    assert.equal(by['83200001'].title, 'iPhone 15 Pro 128GB Blau');
    assert.equal(by['83200001'].price, 520);                 // não confunde com "NP 1'199.-" da descrição? (último preço do card)
    assert.equal(by['83200001'].zip, '3600');
    assert.equal(by['83200001'].place, 'Thun');
    assert.equal(by['83200001'].postedAt, '2026-09-28T08:54:00.000Z'); // 10:54 em Zurique (CEST)
    assert.equal(by['83200001'].image, 'https://c.tutti.ch/images/83200001.jpg');
    assert.equal(by['83200004'].price, 1050);
    assert.equal(by['83200003'].postedAt, '2026-09-27T16:03:00.000Z');
    assert.equal(by['83200006'].price, null);                 // Gratis
    assert.equal(by['83200001'].url, 'https://www.tutti.ch/de/vi/bern/handys/iphone-15-pro-128gb-blau/83200001');
  });
  await test('Tutti real: anúncio do Ricardo intercalado não rouba o preço da capa (bug CHF 400)', () => {
    const r = parseClassifiedSearch(fx('tutti-search-real.html'), 'tutti', t0);
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    assert.equal(r.items.length, 4, 'o anúncio do Ricardo (sem /vi/) não entra');
    assert.equal(by['83208001'].price, 10);
    assert.equal(by['83208001'].title, 'Iphone 15 pro Naruto Hülle');
    assert.equal(by['83208001'].zip, '4616');
    assert.equal(by['83208001'].place, 'Kappel SO');
    assert.equal(by['83208002'].price, 10);
    assert.equal(by['83208698'].price, 590);
    assert.equal(by['83207500'].price, 549, 'NP 1\'199.- na descrição não conta');
    assert.equal(by['83207500'].postedAt, '2026-09-28T07:52:00.000Z');
    assert.equal(by['83208698'].image, 'https://c.tutti.ch/thumbnail/83208698.jpg');
  });
  await test('JSON do Tutti (__NEXT_DATA__) e ignora anúncio que não está na página', () => {
    const r = parseClassifiedSearch(fx('tutti-search-json.html'), 'tutti', t0);
    assert.equal(r.items.length, 2);
    const a = r.items.find((i) => i.id === '83300001')!;
    assert.equal(a.price, 540); assert.equal(a.zip, '3700'); assert.equal(a.place, 'Spiez');
    assert.equal(a.sellerName, 'Sandra'); assert.equal(a.postedAt, '2026-09-28T08:12:00.000Z');
    assert.equal(a.image, 'https://c.tutti.ch/big/83300001.jpg');
  });
  await test('página do anúncio: vendedor visível; anúncio apagado', () => {
    const d = parseClassifiedDetail('83200001', fx('tutti-detail.html'));
    assert.equal(d.active, true);
    assert.equal(d.seller.name, 'Marco R.');
    assert.equal(d.seller.memberSince, '2019');
    assert.equal(d.seller.listings, 12);
    assert.equal(d.seller.verified, true);
    assert.equal(sellerTrust(d.seller), 'visivel');
    assert.equal(parseClassifiedDetail('1', fx('tutti-detail-gone.html')).active, false);
    assert.equal(parseClassifiedDetail('1', '', 404).active, false);
    assert.equal(sellerTrust({ name: null, memberSince: null, company: null, verified: null, listings: null }), 'desconhecido');
    assert.ok(parsePosted('vor 5 Minuten', t0));
  });
  await test('carro a partir de Bern: raio de 40 min e "no caminho" para Interlaken', () => {
    assert.equal(geo.findZip('Thun'), '3600');
    assert.equal(geo.findZip('3700 Spiez'), '3700');
    assert.match(geo.findZip('Biel/Bienne') ?? '', /^25/);
    const thun = geo.estimateDrive('3600')!, zurich = geo.estimateDrive('8004')!, fri = geo.estimateDrive('1700')!;
    assert.ok(thun.minutes >= 20 && thun.minutes <= 35, `Thun ${thun.minutes}`);
    assert.ok(thun.detourMin! <= 10, `Thun desvio ${thun.detourMin}`);
    assert.ok(zurich.minutes > 60);
    assert.ok(fri.minutes <= 40 && fri.detourMin! > 30, 'Fribourg: perto de casa mas fora do caminho');
    assert.equal(geo.travelCost(thun).mode, 'caminho');
    assert.equal(geo.travelCost(fri).mode, 'ida');
    assert.ok(geo.travelCost(fri).chf >= 10 && geo.travelCost(fri).chf <= 25);
  });
  await test('Tutti → Ricardo: comprar, negociar, fora do raio, vendedor e alertas', async () => {
    // 10 vendas reais do iPhone 15 Pro no Ricardo (CHF 600–690)
    const base = Date.now() - 6 * 864e5;
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: String(1350000000 + i), title: `iPhone 15 Pro 128GB Nr ${i}`, url: `https://www.ricardo.ch/de/a/iphone-15-pro-128gb-${1350000000 + i}/`,
      mode: 'auction' as const, bidPrice: 600 + i * 10, buyNowPrice: null, bids: 9, endDate: new Date(base + i * 36e5).toISOString(), condition: null, source: 'test',
    }));
    store.ingest({ productId: 'iphone-15-pro', searchTerm: 'x', scrapedAt: new Date(base - 864e5).toISOString(), items, complete: false });
    store.applyDetails(items.map((it) => ({ id: it.id, productId: 'iphone-15-pro', removed: false, ended: true, soldMarker: false, bids: 9,
      currentPrice: it.bidPrice, buyNowPrice: null, condition: null, endDate: it.endDate })), new Date(base + 2 * 864e5));
    const now = new Date();
    const stats = buy.productStats('iphone-15-pro', now)!;
    const maxBuy = stats.pricing.recommended!.maxBuy!;
    assert.ok(maxBuy > 400 && maxBuy < 520, `maxBuy ${maxBuy}`);

    const cheap = buy.evaluateListing({ price: maxBuy - 40, zip: '3600' }, stats)!;
    assert.equal(cheap.kind, 'comprar');
    assert.equal(cheap.onRoute, true);
    assert.ok(cheap.profit >= 40);
    const nego = buy.evaluateListing({ price: maxBuy + 50, zip: '3700' }, stats)!;
    assert.equal(nego.kind, 'negociar');
    assert.ok(nego.offer! <= maxBuy && nego.offer! >= (maxBuy + 50) * 0.75);
    const no = buy.evaluateListing({ price: maxBuy * 1.6, zip: '3600' }, stats)!;
    assert.equal(no.kind, 'nao');
    const far = buy.evaluateListing({ price: maxBuy - 60, zip: '1700' }, stats)!;
    assert.ok(far.travel!.chf > cheap.travel!.chf, 'viagem de propósito custa mais que o desvio no caminho');
    const bait = buy.evaluateListing({ price: 150, zip: '3600' }, stats)!;
    assert.equal(bait.suspicious, true);

    // Fluxo completo: pesquisa → oportunidades → verificar vendedor → aplicar
    const listing = parseClassifiedSearch(fx('tutti-search-cards.html'), 'tutti', now).items
      .map((i) => (i.id === '83200001' ? { ...i, price: maxBuy - 30 } : i));
    const r = buy.ingestBuy({ source: 'tutti', productId: 'iphone-15-pro', scrapedAt: now.toISOString(), items: listing }, now);
    assert.ok(r.rejected.some((x) => /excluído|acessório|sem preço/.test(x.reason)), JSON.stringify(r.rejected));
    const deals = buy.buyDeals({ productId: 'iphone-15-pro' }, now);
    const d1 = deals.find((d) => d.id === '83200001')!;
    assert.equal(d1.kind, 'comprar');
    assert.equal(d1.withinRadius, true);
    assert.equal(deals.find((d) => d.id === '83200002'), undefined, 'capa (Hülle) não é oportunidade');
    const z = deals.find((d) => d.id === '83200003');
    if (z) assert.equal(z.withinRadius, false, 'Zürich fica fora dos 40 min');
    const need = buy.needSellerCheck('tutti', 'iphone-15-pro', 6, now);
    assert.ok(need.some((n) => n.id === '83200001'));
    assert.ok(!need.some((n) => n.id === '83200003'), 'fora do raio não gasta tempo a abrir');
    buy.applyBuyDetails([{ source: 'tutti', id: '83200001', detail: parseClassifiedDetail('83200001', fx('tutti-detail.html')) }], now);
    const after = buy.buyDeals({ productId: 'iphone-15-pro' }, now).find((d) => d.id === '83200001')!;
    assert.equal(after.trust, 'visivel');
    assert.equal(after.sellerChecked, true);
    assert.ok(!buy.needSellerCheck('tutti', 'iphone-15-pro', 6, now).some((n) => n.id === '83200001'));
    const { formatBuyAlert } = await import('../lib/alerts');
    const msg = formatBuyAlert(after);
    assert.match(msg.title, /Tutti: iPhone 15 Pro/);
    assert.match(msg.body, /Marco R\. · membro desde 2019/);
    assert.match(msg.body, /no caminho do trabalho/);
    // anúncio apagado → sai das oportunidades
    buy.applyBuyDetails([{ source: 'tutti', id: '83200005', detail: parseClassifiedDetail('83200005', fx('tutti-detail-gone.html')) }], now);
    assert.equal(buy.buyDeals({ productId: 'iphone-15-pro' }, now).find((d) => d.id === '83200005'), undefined);
    // avaliação manual (Facebook): descobre o produto pelo título
    const m = buy.evaluateManual({ title: 'Apple iPhone 15 Pro 128 GB Titan Blau', price: maxBuy - 20, zip: geo.findZip('Belp') }, now);
    assert.equal(m[0].productId, 'iphone-15-pro');
    assert.equal(m[0].result!.kind, 'comprar');
    console.log(`    → comprar até ${maxBuy} · Thun ${cheap.drive!.minutes} min (desvio ${cheap.drive!.detourMin}) · Fribourg viagem CHF ${far.travel!.chf}`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${process.exitCode ? '❌ Falhas encontradas' : `✅ ${passed} testes OK`}\n`);
}

main();
