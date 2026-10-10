#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js 18+ необходим"; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' || { echo "Требуется Node.js >=18"; exit 1; }
for exe in vite tgcloud; do
  if [[ ! -x "./node_modules/.bin/$exe" ]]; then
    echo "Не найден $exe. В GitHub Codespaces выполните: npm install --no-audit --no-fund"
    exit 2
  fi
done

echo "Проверка синтаксиса всех серверных модулей..."
while IFS= read -r -d '' file; do node --check "$file"; done < <(find tgcloud -name '*.js' -type f -print0)
node --check web/main.js
echo "Проверка доменных тестов..."
npm run check

echo "Сборка Mini App..."
npm run build
if [[ ! -s dist/index.html ]]; then
  echo "Сборка отсутствует: dist/index.html"; exit 3
fi
echo "PRE-FLIGHT OK. Telegram-бот и база данных не изменены."
