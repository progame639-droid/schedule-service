# Schedule Service — ЛР №3

Мультиплатформенный сервис расписания: Web + Telegram Bot + Supabase.

## Структура

- `frontend/` — сайт на HTML/CSS/JS, можно разместить на Vercel.
- `bot/` — Telegram-бот на Node.js.
- `supabase/schema.sql` — создание таблиц и RLS-политик.
- `supabase/seed.sql` — тестовые группы и расписание.
- `.gitignore` — исключает секреты.

Проект соответствует требованиям ЛР №3: единая база Supabase, выбор группы, `/today`, `/now`, GitHub/Vercel и Telegram Bot. fileciteturn0file0L35-L45

## 1. Создание Supabase

1. Создайте проект в Supabase.
2. Откройте SQL Editor.
3. Выполните `supabase/schema.sql`.
4. Затем выполните `supabase/seed.sql`.
5. Откройте Project Settings → API и скопируйте:
   - Project URL
   - anon/public key

## 2. Настройка сайта

Откройте `frontend/config.js` и вставьте URL и anon key Supabase.

Локальный запуск:
- самый простой вариант: открыть `frontend/index.html` через VS Code Live Server;
- либо запустить любой статический HTTP-сервер.

Для Vercel можно импортировать GitHub-репозиторий и указать `frontend` как Root Directory.

## 3. Настройка Telegram-бота

1. В Telegram откройте `@BotFather`.
2. Выполните `/newbot`.
3. Получите токен.
4. Перейдите в `bot/`.
5. Скопируйте `.env.example` в `.env`.
6. Заполните `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
7. Выполните:

```bash
npm install
npm start
```

Пока терминал работает, бот принимает команды.

## Команды бота

- `/start` — приветствие и выбор группы.
- `/group` — выбрать группу заново.
- `/today` — расписание на сегодня.
- `/now` — текущая пара, перемена или конец учебного дня.

## Как проверить ЛР

1. Откройте сайт.
2. Выберите группу.
3. Нажмите `Сегодня`.
4. Нажмите `Сейчас`.
5. В Telegram выберите ту же группу.
6. Выполните `/today` и `/now`.
7. В Supabase измените название предмета.
8. Обновите сайт или повторите команду в Telegram — новое название берётся из общей базы.

## Git / GitHub

Для требований лабораторной желательно сделать минимум 4 коммита и отдельную frontend-ветку, затем Pull Request и Merge. В методичке указано именно такое распределение работы. fileciteturn0file0L46-L60 fileciteturn0file0L98-L104
