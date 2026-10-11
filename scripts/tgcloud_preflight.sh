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

echo "Проверка синтаксиса всех серверных модулей, Mini App, kiosk, endpoints и тестов..."
while IFS= read -r -d '' file; do node --check "$file"; done < <(find tgcloud -name '*.js' -type f -print0)
while IFS= read -r -d '' file; do node --check "$file"; done < <(find web kiosk tests -name '*.js' -type f -print0)
node --check vite.kiosk.config.js
echo "Проверка доменных тестов..."
npm run check

echo "Локальная симуляция безопасной миграции SQLite и восстановления..."
if command -v python3 >/dev/null; then
  python3 scripts/check_additive_org_migration.py
else
  echo "Не найден Python 3 для проверки миграции"; exit 4
fi
echo "Сборка Mini App..."
npm run build
if [[ ! -s dist/index.html ]]; then
  echo "Сборка отсутствует: dist/index.html"; exit 3
fi
echo "Сборка рабочего QR-экрана (отдельный сайт smena.servgo.ru)..."
npm run build:kiosk
if [[ ! -s kiosk-dist/index.html ]]; then
  echo "Сборка отсутствует: kiosk-dist/index.html"; exit 5
fi
echo "OFFLINE PRE-FLIGHT OK. Серверная платформа, реальная БД и production не изменены."
