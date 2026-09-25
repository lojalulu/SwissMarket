import puppeteer from 'puppeteer-core';

async function main() {
  const query = 'iPhone 13';
  console.log(`Iniciando Chromium no Termux para buscar: "${query}"...`);

  try {
    const browser = await puppeteer.launch({
      executablePath: '/data/data/com.termux/files/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
    );

    console.log('Navegando até a API do Ricardo.ch...');
    const url = `https://www.ricardo.ch/api/frontend/v2/search?query=${encodeURIComponent(query)}&page=1`;

    await page.goto(url, { waitUntil: 'networkidle2' });

    const content = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(content);

    console.log(`\nSucesso total! Encontrados ${data.totalCount || 0} resultados.`);

    if (data.articles && data.articles.length > 0) {
      console.log('\nExemplo do primeiro produto encontrado:');
      console.log(`- Título: ${data.articles[0].title}`);
      console.log(`- Preço: CHF ${data.articles[0].buyNowPrice || data.articles[0].bidPrice || 'N/A'}`);
    }

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
