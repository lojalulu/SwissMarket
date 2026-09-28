# SwissMarket Pulse

Monitoriza produtos no **Ricardo.ch** e responde a três perguntas para revenda:

1. **Por quanto isto vende de verdade?** média, mediana e faixa P25–P75 dos preços de venda
2. **Vende depressa?** vendas por 30 dias, % de anúncios que vendem, dias até vender
3. **Até quanto posso pagar?** Preço Máximo de Compra, já com a comissão do Ricardo, custos e margem

```
 Telemóvel (Termux + Chromium)                 VPS (Next.js)
 ┌───────────────────────────┐   POST /api/ingest       ┌──────────────────────────┐
 │ scripts/runner.ts         │ ───────────────────────► │ lib/store.ts → data/db.json│
 │  1. lê as pesquisas       │   GET  /api/recheck      │ lib/stats.ts             │
 │  2. reabre os anúncios    │ ◄─────────────────────── │   médias, liquidez,      │
 │     terminados            │   POST /api/ingest/details│   preço máx. de compra   │
 │  3. fila offline se a VPS │ ───────────────────────► │ GET /api/stats → painel  │
 │     estiver em baixo      │                          │ http://IP:3000           │
 └───────────────────────────┘                          └──────────────────────────┘
```

## Porque é que isto funciona melhor do que a versão anterior

| Problema antigo | Solução |
|---|---|
| Regex procurava `CHF 123`, mas os cards do Ricardo mostram só `123.00` → quase todos os preços eram **0** | Parser novo lê `123.00`, `1'310.00`, `250.–`, lances `(9 Gebote)` e `Sofort kaufen` |
| `iPhone 13 Pro`, `mini`, capas e peças entravam na média | Filtro de relevância por produto (`mustInclude` / `exclude`) + faixa de preço + remoção de outliers (IQR) |
| Só preços **pedidos** (não são preços de mercado) | O runner reabre os leilões terminados e regista o **preço final de venda** |
| Histórico em memória: perdia tudo ao reiniciar a VPS | Base de dados em ficheiro JSON com escrita atómica |
| `networkidle2` dava timeout com os anúncios do site | `domcontentloaded` + espera pelos cards + scroll; imagens/anúncios bloqueados (mais rápido, menos dados móveis) |
| API aberta a qualquer pessoa na Internet | Token `INGEST_TOKEN` nas rotas de escrita |
| Next.js 14.1.0 com vulnerabilidades conhecidas | Next.js 14.2.35 |

Três fontes de dados na mesma página, fundidas por ID do anúncio: `__NEXT_DATA__` (lances, data de fim, condição), JSON-LD e o texto visível dos cards. Nada depende de classes CSS, que mudam a cada deploy do Ricardo.

Respeita o `robots.txt` do Ricardo: só abre `/de/s/<termo>/` (sem `?`) e páginas de anúncio `/de/a/…`, com pausas de ~7 s.

## Radar, alertas e ranking (v3)

- **Radar**: oportunidades em tempo real, ordenadas por *score* (lucro, liquidez, confiança e urgência)
  - 💰 **Comprar já**: Sofort kaufen + portes ≤ preço máximo de compra
  - ⏰ **Leilão a terminar** (< 6 h, lance abaixo do teu lance máximo): mostra a **chance real de ganhar dentro do limite**,
    medida nos leilões já terminados (lance ÷ preço de mercado nesse momento → preço final ÷ mercado, por janela de tempo:
    < 1 h, 1–3 h, 3–6 h; exemplos de todos os produtos somados). Aparece com chance ≥ 5 %; alerta com ≥ `ALERT_MIN_CHANCE` (25 %).
    Sem 12+ exemplos parecidos ainda: regra prudente (lance ≤ 85 % do teto).
  - 🤝 **Aceita proposta**: vendedor aceita "Preisvorschlag" e pede até 25 % acima do teto → botão copia a mensagem em alemão
  - 📍 **Retirada perto** (`HOME_ZIPS`): sem portes e podes verificar o artigo antes de pagar
- **Alertas** no telemóvel via ntfy ou Telegram, sem repetição (novo aviso só se o preço cair ≥ 5 %)
- **Ranking**: produtos por liquidez, chance de vender em 7 dias e **dias de estoque** (anúncios ao preço de mercado ÷ vendas por dia)
- **Para revender**: preço Sofort sugerido e as faixas de dia/hora em que os leilões fecham mais alto

Teste dos alertas: `http://IP:3000/api/alerts/test?token=SEU_TOKEN`

## Comprar no Tutti / Anibis e revender no Ricardo (v3.4)

Depois de cada volta no Ricardo, o robô lê a 1ª página (os mais recentes) do **Tutti** para cada produto que já tem
"comprar até". A VPS compara cada anúncio com o preço de revenda no Ricardo:

- **Comprar já**: preço + viagem ≤ "comprar até" · **Negociar**: até 25 % acima → sugere a proposta (já sem a viagem)
- **Carro a partir de Bern** (raio `MAX_DRIVE_MIN`, padrão 40 min) e **no caminho do trabalho** (Bern → Interlaken, desvio ≤ 12 min).
  Tempos reais de estrada via OSRM (1 pedido por código postal, guardado em cache); sem OSRM, estimativa calibrada (±5 min).
- **Viagem**: km × 2 × `TRAVEL_CHF_PER_KM` (0,25), ou só o desvio quando é no caminho — descontada do lucro.
- **Vendedor**: para as oportunidades dentro do raio, o robô abre o anúncio e lê o perfil (nome, "membro desde",
  verificado). `BUY_REQUIRE_PROFILE=1` → só alerta perfis visíveis.
- **Alertas** ntfy/Telegram só dentro do raio, com revenda baseada em vendas reais e preço que não seja "bom demais".
- **Facebook Marketplace**: não é lido automaticamente (exige conta e as regras da Meta proíbem recolha automática).
  Na aba *Tutti* há o **avaliador**: cole título, preço e local → produto, lucro, carro e checklist de segurança.
- Anibis: `BUY_SOURCES=tutti,anibis` na VPS (o Anibis usa a mesma plataforma; ative se tiver anúncios diferentes).

Robots.txt do Tutti/Anibis: pesquisa (`/de/q/…`) e anúncios (`/de/vi/…`) permitidos; `/api/`, contas e mensagens não — o robô não entra em contas nem envia mensagens.
Coordenadas dos códigos postais: [GeoNames](https://www.geonames.org) (CC BY 4.0), em `config/ch-plz.json`.

## Instalação

### 1. VPS

```bash
git pull
cp .env.example .env              # coloque um INGEST_TOKEN longo:  openssl rand -hex 24
npm ci && npm run build
npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

Painel: `http://188.245.76.183:3000`

### 2. Telemóvel (Termux)

```bash
cd ~/SwissMarket && git pull
bash scripts/termux-setup.sh      # instala chromium, node e dependências
nano .env                         # mesmo INGEST_TOKEN da VPS
termux-wake-lock                  # impede o Android de adormecer o processo
npx tsx scripts/runner.ts --inspect "iphone 13 128gb"   # diagnóstico (não envia nada)
npx tsx scripts/runner.ts --loop 180                    # recolha contínua a cada ~3 h
```

Opções do runner:

| Comando | O que faz |
|---|---|
| `npx tsx scripts/runner.ts` | 1 ciclo: pesquisa todos os produtos e verifica vendas |
| `--loop 180` | repete a cada ~180 min |
| `--only iphone-13,ps5` | só estes produtos |
| `--inspect "termo"` | grava o HTML em `data/debug/` e mostra o que foi lido e porque foi aceite/rejeitado |
| `--dry-run` | lê mas não envia para a VPS |
| `--no-recheck` | não reabre anúncios terminados |

## Como são calculados os números

- **Preço médio / mediana vendido**: leilões terminados com lances (preço final confirmado na página do anúncio) e "Sofort kaufen" marcados como vendidos. Outliers removidos por IQR.
- **Revenda rápida**: ponto entre o P25 e a mediana, ou seja, um preço que vende sem esperar pelo comprador ideal.
- **Comprar até** = `min(líquido ÷ (1 + margem), líquido − lucro mínimo)`, onde `líquido = revenda rápida − comissão Ricardo − custos`.
  - Comissão (help.ricardo.ch, 2026): smartphones 10 %, eletrónica/gaming/moda 12 %, **teto CHF 290**
  - Padrões: margem 20 %, lucro mínimo CHF 40, custos CHF 5 (ajustáveis por produto em `config/products.ts`)
- **Liquidez** (0–100): média bayesiana de 5 sinais, cada um pesado pelas provas que tem (n ÷ (n + k)), mais um "neutro" de 50 com peso fixo que evita conclusões com poucos dados:
  - **Absorção** (35 %): vendas/dia ÷ anúncios ao preço de mercado (≤ 110 % do preço de referência) → chance de um anúncio vender em 7 dias = 1 − e^(−7·vendas/dia ÷ oferta). Também mostra os **dias de estoque** e o **pior caso** (limite inferior de 80 % da taxa de Poisson).
  - **Procura agora** (25 %): % de leilões ativos com lances e média de lances.
  - **Leilões que vendem** (15 %): vendidos ÷ terminados, com prior Beta(2,2) (1 de 1 = 60 %, não 100 %).
  - **Velocidade** (15 %): 100·e^(−dias até vender ÷ 7).
  - **Preço estável** (10 %): 1 − (P75 − P25) ÷ mediana ÷ 0,6.
  - Rótulos: ≥ 60 rápido, ≥ 40 médio, abaixo lento. Sem nenhuma venda registada, a nota fica no máximo em 59 (médio). Na procura, cada leilão conta no máximo 10 lances. O detalhe de cada produto mostra "Por que este giro?".
- **Tendência do preço** (≥ 8 vendas em ≥ 7 dias): estimador de Theil–Sen (mediana dos declives entre pares de vendas, resistente a preços estranhos). Se o preço cai, a revenda rápida é descontada pelo tempo até vender (máx. −15 %).
- **Potencial** (CHF/semana): lucro no "comprar até" × chance de vender em 7 dias. O Ranking ordena por potencial ou por giro.
- **Confiança**: `alta` com 10 ou mais vendas, `media` com 5–9, `baixa` quando se baseia em lances ativos ou preços pedidos.

> Os números ficam fiáveis depois de **7–14 dias** de recolha: é o tempo de os leilões observados terminarem e serem confirmados.

## Adicionar um produto

Em `config/products.ts`, copie um bloco:

```ts
{
  id: 'ipad-air-m2', name: 'iPad Air M2', category: 'electronics',
  searchTerm: 'ipad air m2',
  mustInclude: [['ipad'], ['air'], ['m 2', 'm2']],
  exclude: ['pro', 'hulle', 'case', 'pencil', 'tastatur'],
  priceFloor: 300, priceCeil: 900, feeRate: 0.12,
},
```

Depois corra `--inspect "ipad air m2"` para ver o que é aceite (✔) ou rejeitado (✘) e ajuste o `exclude`. Faça deploy na VPS (`npm run build && pm2 restart swissmarket`).

## API

| Rota | Descrição |
|---|---|
| `GET /api/stats?days=30[&productId=]` | estatísticas, liquidez, preço máximo e oportunidades |
| `GET /api/listings?productId=iphone-13[&status=sold][&rejected=1]` | anúncios brutos (auditoria) |
| `POST /api/ingest` 🔒 | anúncios de uma pesquisa (o antigo `/api/scrape` continua a funcionar) |
| `GET /api/recheck?limit=25` 🔒 | anúncios que o runner deve reabrir |
| `POST /api/ingest/details` 🔒 | resultado da verificação |
| `GET /api/buy[?productId=][&all=1]` | oportunidades Tutti/Anibis (lucro, carro, vendedor) |
| `GET /api/buy/targets` 🔒 | produtos e fontes que o runner deve procurar no Tutti/Anibis |
| `POST /api/ingest/buy` 🔒 | anúncios de uma pesquisa Tutti/Anibis → devolve os vendedores a verificar |
| `POST /api/ingest/buy-details` 🔒 | perfil do vendedor / anúncio apagado |
| `POST /api/evaluate` | avaliação manual `{title, price, place}` (Facebook Marketplace…) |

🔒 = exige o cabeçalho `x-ingest-token`.

## Desenvolvimento

```bash
npm test          # testes offline do parser, filtros, estatística e base de dados
npm run typecheck
npm run build
```

Se o Ricardo mudar o layout e aparecer `0 anúncios lidos`, o HTML fica em `data/debug/`. Adicione-o a `scripts/fixtures/` e ajuste `lib/parse.ts` até `npm test` passar.
