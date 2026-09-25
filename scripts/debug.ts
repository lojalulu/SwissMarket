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
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--window-size=1920,1080',
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    console.log('Navegando até o Ricardo.ch...');
    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('Página carregada com sucesso!');
    const title = await page.title();
    console.log(`\nTítulo da Página: ${title}`);

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
