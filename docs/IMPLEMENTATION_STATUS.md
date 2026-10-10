# Проверка реализации (10.10.2026)

- [x] Локально созданы исходники проекта Telegram Serverless (handlers, endpoints, schema, lib).
- [x] Добавлен Mini App веб-интерфейс владельца, рабочей QR-точки и сотрудника.
- [x] Доменные unit-тесты Node.js: 8/8 пройдены, `npm run check` успешно.
- [x] Защита от повторных отметок, ограничение срока QR, ECDSA-проверка и одноразовые challenge реализованы в исходниках.
- [x] Ограничение один активный зарегистрированный ключ на точку (уникальный частичный индекс).
- [x] Обработка денег в копейках и фиксирование тарифа на момент начала смены.
- [ ] **Не проверена сборка Mini App:** npm registry недоступен в контейнере (EAI_AGAIN). `npm install`/`npm run build` не запускались успешно.
- [ ] **Не проверена схема Telegram SDK на платформе:** живой BotFather-бот/токен не подключены.
- [ ] **Не выполнен деплой:** `npx tgcloud push` и `migrate` не вызывались.
- [ ] **GitHub-репозиторий не создан:** существующего `grunvald91/servgo-shifts` не найдено; доступные GitHub connector actions не включают создание репозитория.
- [ ] **Не подтверждена обработка персональных данных в выбранной инфраструктуре**; перед коммерческим запуском проверить хранение/локализацию/согласия.
- [ ] Интеграционные тесты реального QR-сканирования и WebCrypto внутри Telegram Serverless.
- [ ] Исправления смен и утверждение начислений руководителем.
- [ ] Аппаратная аттестация рабочего устройства и защита от пересылки действующего QR (фундаментальные ограничения).
- [ ] Юридически полный расчёт заработной платы.

**Нельзя выдавать этот исходный код за развёрнутый и готовый для коммерческого использования бот.**

- [x] QR-to-camera photo intents and Telegram `sendPhoto` prototype implemented; gallery picker not provided.
- [x] Photo decoder validation added; only `file_id` and message ID retained.
- [ ] E2E Telegram sendPhoto, video permissions, group photo and endpoint payload limits still require live platform validation.
