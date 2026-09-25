import { NextResponse } from 'next/server';
import { MONITORED_PRODUCTS } from '@/config/products';

// Interface para os itens do histórico de anúncios
export interface HistoryItem {
  id: string;
  productId: string;
  title: string;
  price: number;
  link: string;
  timestamp: string;
}

// Armazenamento em memória simples para o histórico (substituível por DB no futuro)
let historyStore: HistoryItem[] = [];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('productId');

  if (productId) {
    const filtered = historyStore.filter((item) => item.productId === productId);
    return NextResponse.json({ success: true, count: filtered.length, data: filtered });
  }

  return NextResponse.json({ success: true, count: historyStore.length, data: historyStore });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { searchTerm, rawItems } = body;

    if (!searchTerm || !Array.isArray(rawItems)) {
      return NextResponse.json(
        { success: false, error: 'Parâmetros inválidos. Informe searchTerm e rawItems.' },
        { status: 400 }
      );
    }

    // Verifica se a busca corresponde exatamente a um dos 15 produtos monitorados
    const matchedProduct = MONITORED_PRODUCTS.find(
      (p) => p.searchTerm.toLowerCase() === searchTerm.toLowerCase().trim()
    );

    const minPrice = matchedProduct ? matchedProduct.minPrice : 0;
    const maxPrice = matchedProduct ? matchedProduct.maxPrice : Infinity;

    const processedItems: HistoryItem[] = [];

    for (const item of rawItems) {
      const extractedPrice = item.price || 0;

      // Aplica o filtro de faixa de preço do produto
      if (extractedPrice >= minPrice && extractedPrice <= maxPrice) {
        const newItem: HistoryItem = {
          id: item.id,
          productId: matchedProduct ? matchedProduct.id : 'custom',
          title: item.title,
          price: extractedPrice,
          link: item.link,
          timestamp: new Date().toISOString(),
        };

        // Evita duplicados no histórico
        if (!historyStore.some((existing) => existing.id === newItem.id)) {
          historyStore.push(newItem);
        }
        processedItems.push(newItem);
      }
    }

    return NextResponse.json({
      success: true,
      matchedProduct: matchedProduct ? matchedProduct.name : 'Busca Personalizada',
      addedCount: processedItems.length,
      data: processedItems,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Erro ao processar e salvar o histórico.' },
      { status: 500 }
    );
  }
}
