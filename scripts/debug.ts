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

    const searchUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
    console.log(`Navegando para: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const nextData = await page.evaluate(() => {
      const scriptEl = document.querySelector('script#__NEXT_DATA__');
      if (scriptEl && scriptEl.textContent) {
        try {
          return JSON.parse(scriptEl.textContent);
        } catch (e) {
          return null;
        }
      }
      return null;
    });

    if (nextData) {
      console.log('\n Sucesso! Dados do __NEXT_DATA__ capturados.');
      console.log('Estrutura de dados carregada no frontend do Ricardo.ch.');
    } else {
      console.log('\nExtraindo elementos diretamente do HTML...');
      const products = await page.evaluate(() => {
        const items: Array<{ title: string; link: string }> = [];
        const links = document.querySelectorAll('a[href*="/de/a/"]');
        
        links.forEach((link) => {
          const title = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          if (title && href) {
            items.push({ title, link: `https://www.ricardo.ch${href}` });
          }
        });
        return items;
      });

      console.log(`\nEncontrados ${products.length} links de produtos na página:`);
      products.slice(0, 5).forEach((p, i) => {
        console.log(`- Produto ${i + 1}: ${p.title} (${p.link})`);
      });
    }

    await browser.close();
  } catch (error) {
    console.error('Erro ao executar o scraper:', error);
  }
}

main();
