import fetch from 'node-fetch';

async function main() {
  const query = 'iPhone 13';
  console.log(`Buscando ofertas no Ricardo.ch para: "${query}"...`);

  try {
    const response = await fetch(
      `https://www.ricardo.ch/api/frontend/v2/search?query=${encodeURIComponent(query)}&page=1`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'de-CH,de;q=0.9,en-US;q=0.8,en;q=0.7',
          'Origin': 'https://www.ricardo.ch',
          'Referer': 'https://www.ricardo.ch/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    console.log(`\nSucesso! Encontrados ${data.totalCount || 0} resultados.`);

    if (data.articles && data.articles.length > 0) {
      console.log('\nExemplo do primeiro produto encontrado:');
      console.log(`- Título: ${data.articles[0].title}`);
      console.log(`- Preço: CHF ${data.articles[0].buyNowPrice || data.articles[0].bidPrice || 'N/A'}`);
    }
  } catch (error) {
    console.error('Erro ao executar a busca:', error);
  }
}

main();
