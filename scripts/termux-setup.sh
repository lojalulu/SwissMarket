#!/data/data/com.termux/files/usr/bin/bash
# Prepara o Termux para correr o runner. Uso:  bash scripts/termux-setup.sh
set -e
pkg update -y
pkg install -y nodejs-lts git x11-repo
pkg install -y chromium termux-api || pkg install -y chromium
cd "$(dirname "$0")/.."
export PUPPETEER_SKIP_DOWNLOAD=1
npm install --no-audit --no-fund
[ -f .env ] || { cp .env.example .env; echo "⚠️  Edite o .env e coloque o INGEST_TOKEN igual ao da VPS."; }
echo "✅ Pronto. Teste com:  npx tsx scripts/runner.ts --inspect \"iphone 13 128gb\""
