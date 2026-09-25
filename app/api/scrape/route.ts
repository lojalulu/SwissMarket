import { NextResponse } from 'next/server';
import { MONITORED_PRODUCTS } from '@/config/products';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productId, items } = body;

    if (!productId || !Array.isArray(items)) {
      return NextResponse.json(
        { success: false, error: 'Payload inválido. Forneça productId e a lista de items.' },
        { status: 400 }
      );
    }

    // Localiza as regras do produto monitorado
    const productConfig = MONITORED_PRODUCTS.find((p) => p.id === productId);

    if (!productConfig) {
      return NextResponse.json(
        { success: false, error: `Produto com id "${productId}" não encontrado na configuração.` },
        { status: 404 }
      );
    }

    console.log(`[Scrape API] Recebidos ${items.length} itens para o produto: ${productConfig.name}`);

    // Filtra os itens com base nas regras de preço min e max
    const filteredItems = items.filter((item) => {
      const price = Number(item.price);
      if (isNaN(price)) return false;
      return price >= productConfig.minPrice && price <= productConfig.maxPrice;
    });

    console.log(`[Scrape API] ${filteredItems.length} itens mantidos após filtro de preço (${productConfig.minPrice}-${productConfig.maxPrice} CHF)`);

    // Encaminha os itens válidos para a rota de histórico interna
    const origin = new URL(request.url).origin;
    const historyResponse = await fetch(`${origin}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchTerm: productConfig.searchTerm,
        rawItems: filteredItems,
      }),
    });

    const historyData = await historyResponse.json();

    return NextResponse.json({
      success: true,
      product: productConfig.name,
      received: items.length,
      accepted: filteredItems.length,
      historySummary: historyData,
    });
  } catch (error) {
    console.error('[Scrape API] Erro ao processar scraping:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno ao processar os dados do scraper.' },
      { status: 500 }
    );
  }
}
