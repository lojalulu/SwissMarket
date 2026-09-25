import fs from 'fs';
import path from 'path';
import { connect } from 'puppeteer-real-browser';

interface ProductData {
  id: string;
  keyword: string;
  category: string;
  medianAuctionCHF: number;
  medianFixedCHF: number;
  maxBuyPriceCHF: number;
  liquidityScore: 'HIGH' | 'MEDIUM' | 'LOW';
  lastUpdated: string;
}

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'products.json');

async function scrapeRicardoItem(keyword: string): Promise<number | null> {
  console.log(`[Scraper] Extraindo preços para: "${keyword}"...`);

  try {
    const { page, browser } = await connect({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      customConfig: {},
      connectOption: { defaultViewport: { width: 1920, height: 1080 } },
      turnstile: true
    });

    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(keyword)}/?isEnded=true`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // Aceita cookies se o banner estiver visível
    try {
      const cookieBtn = await page.$('#onetrust-accept-btn-handler');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {}

    // Simula scroll para carregar os artigos lazy-load
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise((r) => setTimeout(r, 3000));

    // Lê os preços formatados como "CHF xxx" presentes no texto da página
    const prices = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const regex = /CHF\s*([0-9]{1,3}(?:['.][0-9]{3})*(?:\.[0-9]{2}|.-)?)/gi;
      const matches = Array.from(pageText.matchAll(regex));
      const extracted: number[] = [];

      for (const match of matches) {
        if (match[1]) {
          const raw = match[1].replace(/'/g, '').replace('.-', '');
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 30 && val <= 5000) {
            extracted.push(val);
          }
        }
      }
      return extracted;
    });

    await browser.close();

    if (prices.length === 0) {
      console.log(`[Scraper] NENHUM PREÇO ENCONTRADO PARA "${keyword}". Mantendo valores anteriores.`);
      return null;
    }

    // Ordena os valores e calcula a mediana
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 !== 0 
      ? prices[mid] 
      : (prices[mid - 1] + prices[mid]) / 2;

    const roundedMedian = Math.round(median);
    console.log(`[Scraper] Sucesso para "${keyword}": Mediana real = CHF ${roundedMedian} (baseado em ${prices.length} preços extraídos).`);
    return roundedMedian;

  } catch (error: any) {
    console.error(`[Erro Scraper] Para "${keyword}": ${error.message}`);
    return null;
  }
}

async function runDataUpdate() {
  if (!fs.existsSync(DATA_FILE_PATH)) {
    console.error(`[Erro] Arquivo data/products.json não encontrado.`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
  let products: ProductData[] = [];

  try {
    products = JSON.parse(rawData);
  } catch (e) {
    console.error(`[Erro] O arquivo products.json contém um formato inválido.`);
    process.exit(1);
  }

  let updatedCount = 0;

  for (const product of products) {
    const realMedianPrice = await scrapeRicardoItem(product.keyword);

    if (realMedianPrice && realMedianPrice > 0) {
      product.medianFixedCHF = realMedianPrice;
      product.medianAuctionCHF = Math.round(realMedianPrice * 0.88);
      product.maxBuyPriceCHF = Math.round(realMedianPrice * (1 - 0.25 - 0.10));
      product.lastUpdated = new Date().toISOString().split('T')[0];
      updatedCount++;
    }
  }

  fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(products, null, 2), 'utf-8');
  console.log(`[Sucesso] Processo concluído. ${updatedCount} produtos atualizados com sucesso no JSON.`);
}

runDataUpdate();
