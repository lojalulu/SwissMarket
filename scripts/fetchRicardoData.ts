import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Ativa o plugin de eversão contra detecções da Cloudflare
puppeteer.use(StealthPlugin());

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

async function scrapeRicardoItem(keyword: string) {
  console.log(`[Scraper] Buscando dados reais para: "${keyword}"...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--lang=de-CH,de;q=0.9,en;q=0.8'
    ]
  });

  const page = await browser.newPage();

  // Define User-Agent de um navegação Chrome real em Windows/macOS
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  // Define cabeçalhos de requisição aceitos por navegadores legítimos
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'de-CH,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
  });

  try {
    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(keyword)}/?isEnded=true`;
    
    // Navega com tempo de espera simulado para passar do challenge inicial da Cloudflare
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Pequena pausa para comportar como usuário humano
    await new Promise((r) => setTimeout(r, 2000));

    const pageTitle = await page.title();
    
    if (pageTitle.includes('Access Denied') || pageTitle.includes('Attention Required')) {
      throw new Error('Bloqueio Cloudflare detectado. Execute o script em ambiente local com IP residencial.');
    }

    // Extração dos preços de anúncios encerrados
    const extractedPrices = await page.evaluate(() => {
      const priceElements = Array.from(document.querySelectorAll('[data-test-element="price"]'));
      return priceElements
        .map((el) => {
          const text = el.textContent || '';
          const cleaned = text.replace(/[^0-9.]/g, '');
          return parseFloat(cleaned);
        })
        .filter((price) => !isNaN(price) && price > 10);
    });

    await browser.close();

    if (extractedPrices.length === 0) {
      console.log(`[Scraper] NENHUM PREÇO ENCONTRADO PARA "${keyword}". Mantendo valores anteriores.`);
      return null;
    }

    // Cálculo da Mediana para remover Outliers
    extractedPrices.sort((a, b) => a - b);
    const mid = Math.floor(extractedPrices.length / 2);
    const median = extractedPrices.length % 2 !== 0 
      ? extractedPrices[mid] 
      : (extractedPrices[mid - 1] + extractedPrices[mid]) / 2;

    return median;
  } catch (error: any) {
    console.error(`[Erro Scraper] ${error.message}`);
    await browser.close();
    return null;
  }
}

async function runDataUpdate() {
  if (!fs.existsSync(DATA_FILE_PATH)) {
    console.error(`[Erro] Arquivo data/products.json não encontrado.`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
  const products: ProductData[] = JSON.parse(rawData);

  let updatedCount = 0;

  for (const product of products) {
    const realMedianPrice = await scrapeRicardoItem(product.keyword);

    if (realMedianPrice && realMedianPrice > 0) {
      product.medianFixedCHF = realMedianPrice;
      product.medianAuctionCHF = Math.round(realMedianPrice * 0.88); // Média estimada de leilão (~12% abaixo da venda direta)
      
      // Fórmula do Preço Teto de Compra (Margem de 25% + Taxa Ricardo de 10%)
      product.maxBuyPriceCHF = Math.round(realMedianPrice * (1 - 0.25 - 0.10));
      product.lastUpdated = new Date().toISOString().split('T')[0];
      updatedCount++;
    }
  }

  fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(products, null, 2), 'utf-8');
  console.log(`[Sucesso] Processo concluído. ${updatedCount} produtos atualizados com sucesso no JSON.`);
}

runDataUpdate();
