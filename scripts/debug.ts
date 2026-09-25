import puppeteer from 'puppeteer-core';
import { MONITORED_PRODUCTS } from '../config/products';

async function main() {
  console.log(`🚀 Iniciando verificação dos ${MONITORED_PRODUCTS.length} produtos configurados...\n`);

  try {
    const browser = await puppeteer.launch({
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

    // Exemplo: vamos testar o primeiro produto da lista (iPhone 13 128GB)
    const target = MONITORED_PRODUCTS[0];
    console.log(`🔍 Monitorando: ${target.name} [${target.minPrice}–${target.maxPrice} CHF]`);

    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(target.searchTerm)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const rawProducts = await page.evaluate(() => {
      const items: Array<{ id: string; title: string; link: string }> = [];
      const links = document.querySelectorAll('a[href*="/de/a/"]');

      links.forEach((link) => {
        const href = link.getAttribute('href') || '';
        const idMatch = href.match(/-(\d+)\/?$/);
        const id = idMatch ? idMatch[1] : '';
        const textContent = link.textContent?.trim() || '';

        if (id && textContent) {
          items.push({ id, title: textContent, link: `https://www.ricardo.ch${href}` });
        }
      });

      return Array.from(new Map(items.map((item) => [item.id, item])).values());
    });

    console.log(`\n✅ ${rawProducts.length} anúncios encontrados na busca.`);
    console.log(`📌 Exemplo do primeiro anúncio extraído:`);
    if (rawProducts.length > 0) {
      console.log(`- ID: ${rawProducts[0].id}`);
      console.log(`- Conteúdo: ${rawProducts[0].title}`);
      console.log(`- Link: ${rawProducts[0].link}`);
    }

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
