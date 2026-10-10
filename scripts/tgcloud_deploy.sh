#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${TGCLOUD_TOKEN:-}" && ! -f .tgcloud/credentials ]]; then
  echo "Нет авторизации Telegram Serverless."
  echo "В @BotFather: бот → Serverless → CLI Access."
  echo "В этом терминале выполните: npx --no-install tgcloud login"
  echo "Не отправляйте токен в чат и не коммитьте .tgcloud/."
  exit 2
fi

bash scripts/tgcloud_preflight.sh
TG="./node_modules/.bin/tgcloud"

echo "Текущий статус и ожидаемые изменения базы:"
"$TG" status
"$TG" migrate --dry-run --local

echo "Целевой Telegram-бот определяется авторизацией tgcloud; перед запуском проверьте профиль."

echo "Публикуем серверные модули и собранный Mini App..."
"$TG" push

echo "Применяем только безопасные миграции. Рискованные не подтверждаем автоматически."
"$TG" migrate --safe

echo "Синхронизируем webhook (без удаления очереди сообщений)..."
"$TG" webhook sync
"$TG" webhook
"$TG" status
"$TG" migrate --dry-run

echo "Загрузка выполнена. Сверьте список оставшихся миграций выше."
echo "Проверьте /start, /setup, привязку группы /bind, получение QR, камеру и фото."
echo "Точный адрес Telegram Mini App показывает tgcloud push; установите его как Main Mini App в @BotFather."
