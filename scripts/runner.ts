import puppeteer from 'puppeteer-core';
import { MONITORED_PRODUCTS } from '../config/products';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://188.245.76.183:3000';

async function runScraper() {
  console.log(`🚀 [Runner] A iniciar ciclo de monitorização para ${MONITORED_PRODUCTS.length} produtos...`);
  console.log(`🌐 Destino da API: ${API_URL}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    for (const product of MONITORED_PRODUCTS) {
      console.log(`\n🔍 [Scraping] A procurar: ${product.name} (Termo: "${product.searchTerm}")`);
      
      try {
        const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(product.searchTerm)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Pausa de segurança para garantir a hidratação do React no site do Ricardo.ch
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await page.waitForSelector('a[href*="/de/a/"]', { timeout: 10000 }).catch(() => {});

        const items = await page.evaluate(() => {
          const rawItems: Array<{ id: string; title: string; price: number; link: string }> = [];
          const links = document.querySelectorAll('a[href*="/de/a/"]');

          links.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const idMatch = href.match(/-(\d+)\/?$/);
            const id = idMatch ? idMatch[1] : '';
            const title = link.textContent?.trim() || '';

            const priceMatch = title.match(/(?:CHF|Fr\.?)\s*([\d\']+)/i);
            let price = 0;
            if (priceMatch && priceMatch[1]) {
              price = parseFloat(priceMatch[1].replace(/'/g, ''));
            }

            if (id && title) {
              rawItems.push({
                id,
                title,
                price,
                link: `https://www.ricardo.ch${href}`,
              });
            }
          });

          return Array.from(new Map(rawItems.map((item) => [item.id, item])).values());
        });

        console.log(`📦 Encontrados ${items.length} anúncios brutos. A enviar para a API da VPS...`);

        const response = await fetch(`${API_URL}/api/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            items,
          }),
        });

        const result = await response.json();
        console.log(`✅ [${product.name}] Sincronizado com sucesso:`, result);

      } catch (productError) {
        console.error(`❌ Erro ao processar o produto ${product.name}:`, productError);
      }

      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    console.log('\n✨ [Runner] Ciclo de monitorização concluído com sucesso!');

  } catch (error) {
    console.error('❌ Erro fatal ao iniciar o Chromium no Termux:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runScraper();
