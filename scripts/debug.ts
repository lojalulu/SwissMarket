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

    console.log('Acessando o Ricardo.ch para estabelecer sessão...');
    await page.goto('https://www.ricardo.ch/de/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('Sessão estabelecida! Solicitando dados da API no contexto da página...');

    // Executa a requisição dentro do próprio navegador aberto
    const data = await page.evaluate(async (searchQuery) => {
      const res = await fetch(`https://www.ricardo.ch/api/frontend/v2/search?query=${encodeURIComponent(searchQuery)}&page=1`);
      return await res.json();
    }, query);

    if (data && data.articles && data.articles.length > 0) {
      console.log(`\n Total de ${data.totalCount || data.articles.length} produtos encontrados!\n`);

      data.articles.slice(0, 5).forEach((item: any, index: number) => {
        console.log(`--- Produto ${index + 1} ---`);
        console.log(`Título: ${item.title}`);
        console.log(`Preço Comprar Já: CHF ${item.buyNowPrice || 'N/A'}`);
        console.log(`Preço Lance: CHF ${item.bidPrice || 'N/A'}`);
        console.log(`ID: ${item.id}`);
        console.log(`Link: https://www.ricardo.ch/de/a/${item.id}`);
        console.log('---------------------\n');
      });
    } else {
      console.log('A API respondeu, mas nenhum artigo foi retornado.');
    }

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
