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

if [[ "${SMENA_BACKUP_VERIFIED:-}" != "1" ]]; then
  echo "СТОП: требуется проверенный бэкап РЕАЛЬНОЙ базы Telegram Serverless."
  echo "После проверенного восстановления и подтверждения безопасной схемы запустите SMENA_BACKUP_VERIFIED=1 bash scripts/tgcloud_deploy.sh"
  exit 10
fi

if [[ "${SMENA_MIGRATION_REVIEWED:-}" != "1" ]]; then
  echo "СТОП: проверьте результат tgcloud migrate --dry-run --local и подтвердите отсутствие warning/manual и destructive diff."
  echo "После ручной проверки добавьте SMENA_MIGRATION_REVIEWED=1 к команде запуска."
  exit 11
fi

echo "Сначала применяем только безопасные ADDITIVE изменения к реальной БД."
echo "Так действующий бот продолжит работать, даже если последующий push будет отклонён."
"$TG" migrate --local --safe

echo "Проверяем остаточные несовпадения схемы перед выкладкой кода..."
"$TG" migrate --dry-run --local

echo "Публикуем серверные модули и собранный Mini App..."
"$TG" push

echo "Синхронизируем webhook (без удаления очереди сообщений)..."
"$TG" webhook sync
"$TG" webhook
"$TG" status
"$TG" migrate --dry-run

echo "Загрузка выполнена. Сверьте список оставшихся миграций выше."
echo "Проверьте /start, /setup, привязку группы /bind, получение QR, камеру и фото."
echo "Точный адрес Telegram Mini App показывает tgcloud push; установите его как Main Mini App в @BotFather."
