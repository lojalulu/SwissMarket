import puppeteer from 'puppeteer-core';

async function main() {
  const query = 'iPhone 13';
  console.log(`Iniciando Chromium no Termux para buscar: "${query}"...`);

  try {
    const browser = await puppeteer.launch({
      executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
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

    console.log('Navegando até a página de busca do Ricardo.ch...');
    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('Página carregada com sucesso! Extraindo título...');
    const title = await page.title();
    console.log(`\nTítulo da Página: ${title}`);

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
