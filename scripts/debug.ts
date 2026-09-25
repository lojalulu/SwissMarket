import puppeteer from 'puppeteer-core';

async function main() {
  const query = 'iPhone 13';
  console.log(`Buscando produtos no Ricardo.ch para: "${query}"...`);

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

    // Escuta a resposta da API do Ricardo.ch para pegar o JSON direto
    let apiData: any = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/frontend/v2/search')) {
        try {
          apiData = await response.json();
        } catch (e) {
          // Ignora se não for JSON
        }
      }
    });

    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    if (apiData && apiData.articles) {
      console.log(`\n Sucesso! ${apiData.articles.length} produtos capturados da API.\n`);
      
      apiData.articles.slice(0, 5).forEach((item: any, index: number) => {
        console.log(`--- Produto ${index + 1} ---`);
        console.log(`Título: ${item.title}`);
        console.log(`Preço Comprar Já: CHF ${item.buyNowPrice || 'N/A'}`);
        console.log(`Preço Lance: CHF ${item.bidPrice || 'N/A'}`);
        console.log(`ID: ${item.id}`);
        console.log('---------------------\n');
      });
    } else {
      console.log('Página carregada, mas os dados da API não foram capturados.');
    }

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
