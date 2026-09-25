import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

async function debug() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://www.ricardo.ch/de/s/iphone/?isEnded=true', { waitUntil: 'networkidle2' });
  const content = await page.content();
  fs.writeFileSync('debug.html', content);
  
  const isCloudflare = content.includes('Just a moment') || content.includes('Attention Required') || content.includes('cf-challenge');
  console.log('--- DIAGNÓSTICO DE ACESSO ---');
  console.log('Tamanho da página recebida:', content.length, 'bytes');
  console.log('Bloqueio Cloudflare detectado?:', isCloudflare ? 'SIM (IP do servidor bloqueado)' : 'NÃO (Página carregou normal)');
  
  await browser.close();
}
debug();
