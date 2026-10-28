# Экспорт чатов DeepSeek для DSH Desktop

Плагин DSH Desktop, который открывает `https://chat.deepseek.com` в изолированной панели
приложения, даёт войти в аккаунт вручную внутри этой панели и по команде выгружает ваши
диалоги в Markdown-файлы в папку `research/` текущей рабочей области.

- Панель: отдельная вкладка «DeepSeek» в левой колонке (рядом с Plugins и Schedules).
- Авторизация: только вручную, в самом WebView; плагин не запрашивает и не хранит пароли.
- Данные: внутренний HTTP API DeepSeek, запросы уходят **из** WebView с его cookies.
- Идемпотентность: неизменённые диалоги не перезаписываются, изменённые обновляются на месте.
- Формат: YAML frontmatter + пары «Пользователь / Ассистент», блоки reasoning исключены.

| Параметр | Значение |
| --- | --- |
| Пакет | `@local/dsh-deepseek-chat-exporter` |
| Профиль | `desktop` (DSH Desktop) |
| Строка плагина | `deepseek-chat-exporter` |
| Панель | ключ `deepseek-chat-exporter` в слоте `main` + иконка в `sidebar.panellist` |
| Команда | `/export-chats` |
| Хост-маршрут | `POST /dsh-chat-exporter/rpc` |
| Выход | `<workspace>/research/*.md`, кэш `<workspace>/.dsh-chat-exporter-cache.json` |

## Требования

- DSH Desktop (Electron). В обычном браузере панель объяснит, что встроенный WebView там
  недоступен: изолированный guest — это возможность именно Desktop-окна.
- Node.js для сборки не нужен: `client.js` уже собран и лежит в пакете. Node нужен только
  для запуска тестов и пересборки клиентской части.
- Исходящий HTTPS до `chat.deepseek.com` и действующий аккаунт DeepSeek.

## Установка

### Вариант A — через UI DSH (проверенный путь)

1. Откройте **Plugins → Add** в DSH Desktop.
2. Укажите путь к папке плагина:
   `C:\Users\maksimov2\Documents\deepseek-harness\default-workspace\plugins\dsh-plugin-deepseek-chat-exporter`
3. Плагин установится в профиль `desktop` и включится сразу (`application: applied`).

Эквивалент из агентской сессии — `plugin_manager` c `action: install_bundle` и тем же
абсолютным путём в `target`.

### Вариант B — штатный CLI DSH

```powershell
# если dsh есть в PATH
dsh plugin --profile desktop add "C:\Users\maksimov2\Documents\deepseek-harness\default-workspace\plugins\dsh-plugin-deepseek-chat-exporter"

# либо через бинарник установленного приложения
& "C:\Users\maksimov2\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "C:\...\plugins\dsh-plugin-deepseek-chat-exporter"
```

`dsh plugin` — это pnpm-операция в каталоге профиля; после успешной установки DSH
согласует `dsh.profile.bundles` профиля (новый bundle-пакет включается автоматически).
Если по какой-то причине строка не активировалась, включите её переключателем на странице
**Plugins** или добавьте `@local/dsh-deepseek-chat-exporter` в `dsh.profile.bundles`
в `~/.dsh/profiles/desktop/package.json`.

Установка не трогает `app.asar` и не требует прав администратора: пакет линкуется в
`~/.dsh/profiles/desktop/node_modules`, а его patch-файл добавляет одну строку в композицию
профиля.

### Проверка установки

- `~/.dsh/profiles/desktop/package.json` содержит зависимость и bundle-строку:
  ```json
  "dependencies": { "@local/dsh-deepseek-chat-exporter": "link:.../dsh-plugin-deepseek-chat-exporter" },
  "dsh": { "profile": { "bundles": [ ..., "@local/dsh-deepseek-chat-exporter" ] } }
  ```
- В левой колонке появилась иконка панели «DeepSeek»; хост-маршрут отвечает:
  ```powershell
  Invoke-WebRequest -Method Post -ContentType application/json `
    -Body '{"method":"hello","params":{}}' http://127.0.0.1:63689/dsh-chat-exporter/rpc
  ```

## Использование

1. Нажмите иконку **DeepSeek** в левой колонке — откроется `chat.deepseek.com` внутри панели.
2. Войдите в аккаунт DeepSeek обычным способом (телефон, e-mail, существующая сессия).
   Индикатор внизу панели переключится на «Вход выполнен».
3. Нажмите **Экспорт чатов** или выполните в чате агента команду `/export-chats`.
4. Готово: файлы лежат в `research/` вашей рабочей области. Внизу панели — прогресс
   (`Найдено N`, `Читаю i/N`, `Записываю файлы`), затем итог:
   `Найдено … экспортировано … пропущено … ошибок …`.

Кнопки панели:

| Кнопка | Действие |
| --- | --- |
| **Экспорт чатов** | полный цикл: список диалогов → история → запись файлов |
| **Стоп** (появляется во время экспорта) | останавливает чтение: уже прочитанные диалоги всё равно записываются, остальные не читаются |
| **Перезагрузить** | перезагружает `chat.deepseek.com` в панели (не сбрасывает сессию) |
| **Диагностика** | показывает состояние моста Desktop, `hello`-ответ хоста, статусы `authProbe`, `listEndpoints` и число найденных диалогов |

### Остановка экспорта

Кнопка **Стоп** нужна для пробных прогонов, когда ждать весь архив не хочется. Поведение:

- нажатие отменяет ожидание: следующий сетевой шаг и загрузка страницы (DOM-фолбэк)
  прерываются сразу, а не через свой таймаут;
- цикл останавливается на ближайшей границе диалога — **уже прочитанные диалоги
  записываются**, поэтому после «Стопа» в `research/` остаётся частичный результат;
- внизу панели итог помечается жёлтым: «Остановлено пользователем: уже прочитанные диалоги
  записаны, остальные пропущены», плюс обычная статистика
  (`найдено / экспортировано / пропущено / ошибок`);
- в отчёт диагностики пишется `export-stopped` (а не `export-ok`/`export-failed`);
- если остановить до первого прочитанного диалога, файлы не создаются вовсе.

Тот же стоп действует и для `/export-chats`: команда вернёт сводку с пометкой об остановке.
Если нужно просто ограничить объём, есть и «пассивный» вариант — уменьшить `maxChats`
в конфигурации (см. ниже).

Команда `/export-chats` работает через тот же экспорт: хост ставит задание в очередь,
панель забирает его при следующем опросе (раз в ~1.2 с), выполняет и возвращает итоговую
сводку в чат. Команда требует, чтобы панель была открыта и страница загружена; иначе вы
получите понятную ошибку с просьбой открыть панель и войти.

## Что получается на выходе

Один диалог — один файл:

```
research/2026-10-20_Smoke-первый-диалог_livea000.md
```

Имя: `{YYYY-MM-DD}_{slug(title)}_{первые 8 символов chat_id}.md`; запрещённые для Windows
символы (< > : " / \ | ? *), управляющие символы и завершающие точки/пробелы вычищаются,
пробелы становятся `-`, длина заголовка ограничена (`fileNameMaxTitle`), кириллица и CJK
сохраняются. Дата — из времени создания диалога, иначе из времени обновления.

```markdown
---
title: "Smoke: первый диалог"
chat_id: "livea000000000000000000000000000"
source_url: "https://chat.deepseek.com/a/chat/s/livea000000000000000000000000000"
exported_at: "2026-10-27T06:26:48.544Z"
updated_at: "2026-10-27T06:26:48.732Z"
message_count: 2
last_message_id: "live-livea-2"
last_message_hash: "902a39086ad344d81182c329866fa710d5c5c37e86b0e0174920ab7389fbea67"
---

**Пользователь:**

Проверочный вопрос smoke-теста

**Ассистент:**

Обновлённый ответ ассистента
```

Правила тела файла:

- все реплики в хронологическом порядке, только `user` и `assistant`;
- блоки reasoning / thinking / chain-of-thought, системные и служебные сообщения,
  пустые тексты и фрагменты `search_results`/`tool`/`file` отбрасываются на этапе
  нормализации и повторно проверяются хостом;
- **реплика, где рассуждение соседствует с ответом, сохраняется целиком** — выбрасывается
  только сам блок рассуждений. Обычный ответ DeepSeek приходит как
  `fragments: [RESPONSE, THINK]`, поэтому наличие `THINK` не может быть признаком
  «это reasoning-сообщение»: решается по наличию видимого текста;
- текст реплик вставляется как есть (Markdown не экранируется), поэтому все ссылки из
  ответа — markdown-ссылки и голые URL — остаются как были;
- **источники ответа сохраняются.** DeepSeek присылает их отдельным полем
  (`references`/`results` у search-фрагмента), а в тексте оставляет только маркеры
  `[reference:N]`. Плагин превращает маркеры в нумерованные ссылки `[N](url)` и дописывает
  в конец финального ответа блок:

  ```markdown
  **Источники:**

  1. [Nginx Proxy Manager](https://nginxproxymanager.com/)
  2. [Caddy](https://caddyserver.com/)
  ```
- в текст попадают только фрагменты-реплики (`REQUEST`/`RESPONSE`): служебные фрагменты
  (`SEARCH`, `TOOL_*`, `FILE`, статусы вида «Found 28 web pages») отбрасываются;
- файл заканчивается ровно одним переводом строки.

### Кэш и идемпотентность

`<workspace>/.dsh-chat-exporter-cache.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-10-27T06:26:48.732Z",
  "chats": {
    "<chatId>": {
      "title": "…", "file": "research/…md",
      "lastMessageId": "…", "lastMessageHash": "…",
      "messageCount": 12,
      "exportedAt": "…", "updatedAt": "…", "lastExportAt": "…"
    }
  }
}
```

Перед записью хост сравнивает `sha256(lastMessage.id + "\0" + lastMessage.text)` с кэшем:

- хеш и id совпали и файл существует → диалог пропускается, файл не трогается
  (mtime не меняется);
- хеш изменился → **тот же самый файл** перезаписывается, `updated_at` обновляется,
  `exported_at` сохраняется от первой выгрузки;
- диалога нет в кэше (или файл исчез) → создаётся файл;
- кэш пишется атомарно (временный файл + `rename`), повреждённый кэш приводит к
  пересборке, а не к отказу.

Сбросить кэш (файлы останутся на диске): метод `clearCache` маршрута или удаление
`.dsh-chat-exporter-cache.json`.

## Архитектура

```
Electron BrowserWindow (renderer, origin dsh-app://app)
  └─ клиентская половина  client.js
        ├─ webview-guest (lease → partition)  ──►  https://chat.deepseek.com
        │     └─ fetch внутреннего API из документа страницы (cookies сессии)
        └─ POST /dsh-chat-exporter/rpc   (same-origin, через dsh-app → Host)
Хост-процесс (Node, дочерний процесс Electron)
  └─ index.js + lib/export.js
        ├─ POST /export-chats через команду + очередь заданий
        └─ fs: research/*.md + .dsh-chat-exporter-cache.json
```

Почему так:

- **`<webview>`, а не `<iframe>`**: `chat.deepseek.com` запрещает встраивание
  (`frame-ancestors`), а Desktop всё равно отклоняет любой неавторизованный guest.
  Легальный путь — аренда guest'а у моста Desktop: `window.dshDesktop.browser.acquire(key)`
  возвращает `{ lease, partition }`, после чего main-процесс разрешает вставку
  `<webview src="about:blank#<lease>" partition="<partition>">`.
- **Запросы из WebView**: `webview.executeJavaScript` выполняет `fetch` в контексте
  страницы, поэтому cookies (в том числе httpOnly) уходят автоматически, а токены не
  покидают guest. API требует `Authorization: Bearer`, поэтому плагин сначала достаёт токен
  из `localStorage`/`sessionStorage` страницы и повторяет запрос без него, если сервер
  ответил «Missing/Invalid Token» — токен остаётся внутри guest и никогда не логируется и
  не сохраняется.
- **Запись файлов на хосте**: рендерер не имеет доступа к файловой системе, поэтому данные
  уходят на хост по одному JSON-маршруту. Хост не ходит в сеть и не видит cookies.
- **Профиль как хост-процесс**: хост DSH — обычный Node-процесс (`ELECTRON_RUN_AS_NODE`),
  API Electron ему недоступны, поэтому cookies читаются только через guest.

## Безопасность и приватность

- Плагин не запрашивает и не хранит пароли, токены и cookies; ни то, ни другое не попадает
  в файлы, кэш, логи или сообщения об ошибках.
- Все обращения к DeepSeek идут из WebView с его сессией; хост-половина не делает сетевых
  запросов вообще.
- Ошибки санитизируются: подстроки `cookie`, `authorization`, `bearer`, `token`
  вырезаются, длина ограничена.
- Guest изолирован штатной политикой Desktop: `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, `webSecurity: true`; скачивание, разрешения и
  нативные диалоги запрещены, всплывающие окна открываются только как новые вкладки.
- Файлы пишутся только в `<workspace>/research/` и кэш в корне workspace; имена
  санитизируются, `chat_id` проверяется регулярным выражением, поэтому `../` и подобные
  значения не могут вывести запись за пределы папки.

## Конфигурация

Все ключи необязательны и живут в `config` строки плагина (в `cordis.patch.yml` профиля
или в вашем patch-слое). Значения из строки накладываются на значения по умолчанию;
неизвестные ключи игнорируются.

| Ключ | По умолчанию | Смысл |
| --- | --- | --- |
| `outputDir` | `research` | папка выгрузки относительно корня workspace |
| `cacheFileName` | `.dsh-chat-exporter-cache.json` | имя файла кэша в корне workspace |
| `workspaceRoot` | `""` | абсолютный путь, жёстко задаёт корень (иначе — workspace из реестра) |
| `labelUser` | `Пользователь` | подпись реплик пользователя |
| `labelAssistant` | `Ассистент` | подпись реплик ассистента |
| `fileNameMaxTitle` | `60` | максимум символов заголовка в имени файла |
| `commandWaitMs` | `180000` | сколько `/export-chats` ждёт панель |
| `maxChats` | `500` | верхняя граница числа диалогов за прогон (для быстрой пробы поставьте, например, `5`) |
| `api.base` | `https://chat.deepseek.com` | origin для endpoint'ов |
| `api.authProbe` | `GET /api/v0/users/current` | проверка входа |
| `api.listEndpoints` | `GET /api/v0/chat_session/fetch_page?count=100`, затем `POST` с телом `{}` | список диалогов |
| `api.historyEndpoints` | `GET /api/v0/chat/history_messages?chat_session_id={chatId}`, затем `POST` с JSON-телом | история сообщений |
| `api.domFallback` | `enabled: true`, `messageSelector`, `roleAttribute` | аварийный DOM-фолбэк |

Корень workspace определяется так: подсказка панели (путь workspace из UI) → `workspaceRoot`
→ первый зарегистрированный workspace DSH → рабочий каталог хоста. Каталог профиля
(`~/.dsh/profiles/...`) как workspace никогда не используется.

Пример переопределения:

```yaml
- id: deepseek-chat-exporter
  name: '@local/dsh-deepseek-chat-exporter'
  config:
    outputDir: research/deepseek
    fileNameMaxTitle: 40
    api:
      base: 'https://chat.deepseek.com'
      listEndpoints:
        - method: POST
          path: '/api/v0/chat_session/fetch_page?count=200'
          body: '{}'
```

### Endpoint'ы DeepSeek и диагностика

Публичного контракта у веб-API DeepSeek нет, поэтому таблица endpoint'ов вынесена в
конфигурацию, а ответы разбираются терпимо: нормализатор ищет массивы диалогов и сообщений
в `data`/`biz_data`/`result` на глубину 4, поддерживает `chat_sessions`, `chat_messages`,
`fragments[{type, content}]`, роли `USER`/`ASSISTANT`/`REQUEST`/`RESPONSE`, а также
секунды/миллисекунды/микросекунды/ISO-строки во времени.

Проверенные на живом origin факты (2026-10-27), которые определяют поведение плагина:

| Запрос без токена | Ответ |
| --- | --- |
| `GET /api/v0/users/current` | HTTP 200, `{"code":40002,"msg":"Missing Token","data":null}` |
| `GET /api/v0/chat_session/fetch_page?count=100` | HTTP 200, `{"code":40003,"msg":"INVALID_TOKEN","data":null}` |
| `GET /api/v0/chat/history_messages?chat_session_id=…` | HTTP 200, `{"code":40003,"msg":"INVALID_TOKEN","data":null}` |

С `Authorization: Bearer` из `userToken` (проверено на реальном аккаунте, 2026-10-28):
`GET /api/v0/users/current` → `code 0` (тело содержит профиль и **сам токен** — поэтому
диагностика его маскирует), `GET /api/v0/chat_session/fetch_page?count=100` → `code 0` и
100 диалогов, а `POST /api/v0/chat_session/fetch_page` → `code 40003` **с тем же самым
токеном**. Отсюда правило: отказ одного endpoint'а не означает, что сессия негодна —
перебор продолжается, и «auth failure» объявляется только если отказали все endpoint'ы.

Следствия: **HTTP-статус здесь ничего не означает** — ошибка приходит внутри тела
(`code != 0`), а cookies сами по себе недостаточны: нужен заголовок с токеном.

Как плагин добывает этот токен (всё — внутри guest'а):

1. **Наблюдение за трафиком сайта.** После загрузки страницы в её контекст ставится
   перехватчик `fetch`/`XMLHttpRequest`: любой credential-заголовок
   (`authorization`, `x-…token…`, `…-token`) на запросах к `/api/v0/` запоминается вместе с
   именем заголовка и подставляется первым — это ровно то, что принимает сервер.
2. **Хранилище.** Если наблюдения ещё нет, токен ищется в `localStorage`/`sessionStorage`
   (включая двойную JSON-обёртку `{"value":"{\"value\":\"<token>\"}"}`) и, в крайнем случае,
   в IndexedDB; из найденного собирается до четырёх кандидатов.
3. **Проверка лестницей.** Кандидаты пробуются по очереди в двух схемах
   (`Authorization: Bearer <t>` и «сырой» `<t>`), затем cookie-запрос; первый ответ без
   auth-конверта запоминается и переиспользуется. Неверная догадка стоит одного пробного
   запроса, а не всего экспорта.
4. **Коды `40001–40005`** означают «сессия непригодна»: плагин сразу сообщает
   «войдите в панели» и прекращает обход диалогов.

Токен живёт только внутри guest'а: он не возвращается в панель, не пишется в кэш и не
попадает в отчёты и логи — в диагностику уходят лишь имя источника и схема
(например `live:x-ds-token`, `userToken/bearer`, `cookie/none`).

Если DeepSeek поменяет API: откройте **Диагностика** в панели (`status`, `tokenUsed`,
`envelope`, усечённое тело ответа, а также строку `history …`: `records/kept/users/
assistants/sources`, причины отбрасывания и перепись типов фрагментов `fragments={…}`)
либо прочитайте
`<workspace>/.dsh-chat-exporter-diagnostics.json` — туда клиентская половина сама пишет
`panel-ready` / `panel-failed` / `export-empty` / `export-failed` / `export-ok` вместе с
результатом проверки сессии. Затем поправьте `api.listEndpoints` / `api.historyEndpoints` в
конфигурации; пересобирать клиент не нужно — таблица приходит с хоста.

Живость клиентской половины видна и снаружи: `status` возвращает
`client: { polls, readyPolls, lastPollAt, … }` — опросчик в браузере вызывает `poll`
постоянно, поэтому `polls: 0` означает, что клиент вообще не дошёл до хоста.

## Ограничения

1. **Сессия не переживает перезапуск приложения.** Внутри одного запуска DSH сессия
   сохраняется при переключении панелей, сворачивании и повторном открытии панели, но не
   после выхода из приложения. Это ограничение политики Desktop, а не плагина: main-процесс
   выдаёт guest'у partition `dsh-sidebar-browser-<uuid>` через
   `session.fromPartition(partition)` без префикса `persist:` и отклоняет любой guest без
   аренды. Тот же предел заявлен в README штатной панели Browser:
   «Cookies and Web storage do not survive application restart». Обойти его из плагина
   нельзя, не изменяя `app.asar` (запрещено) и не сохраняя токен (запрещено).
   Практическое следствие: после перезапуска DSH нужно один раз снова войти в панели.
2. **Панель работает только в DSH Desktop.** В обычном браузере нет ни `dshDesktop`, ни
   изолированного guest'а; панель покажет пояснение и ссылку на сайт.
3. **API DeepSeek недокументирован.** Автор не может гарантировать, что конкретные
   endpoint'ы живут вечно; отсюда конфигурируемая таблица, терпимый нормализатор и
   диагностика. DOM-фолбэк — аварийный: он открывает диалог в панели и читает сообщения по
   селекторам, поэтому медленный и зависит от разметки сайта.
4. **Длинные диалоги** выгружаются целиком; очень большие истории увеличивают время прогона
   (пауза 120 мс между диалогами, чтобы не злоупотреблять API).
5. **Вложения и изображения** не выгружаются: только текст реплик.

## Устранение неполадок

| Симптом | Что проверить |
| --- | --- |
| Иконки панели нет | плагин включён? `~/.dsh/profiles/desktop/package.json` содержит bundle; перезапустите DSH |
| «Встроенная панель требует DSH Desktop» | страница открыта в браузере, а не в окне DSH Desktop |
| «Панель DeepSeek не открыта» при `/export-chats` | откройте панель, дождитесь загрузки страницы, войдите и повторите |
| «Страница DeepSeek ещё не готова» | дождитесь загрузки `chat.deepseek.com` (индикатор «Загрузка…») |
| Экспорт: «no usable endpoint is configured» | **Диагностика** → проверьте статусы endpoint'ов и поправьте конфигурацию |
| Экспорт: «chat.deepseek.com отклонил сессию (Missing Token / INVALID_TOKEN)» | убедитесь, что вошли **в этой панели**; если вход есть — откройте в панели любой диалог (перехватчик увидит настоящий заголовок сайта) и повторите; смотрите `token=…` в «Диагностике» |
| Файлы не появились | 1) итоговая строка внизу панели; 2) `status` → `entries` и `client.polls` (`polls: 0` — клиент не достучался до хоста); 3) `.dsh-chat-exporter-diagnostics.json` в корне workspace |
| Нужно выгрузить заново все диалоги | удалите `.dsh-chat-exporter-cache.json` или вызовите `clearCache` |

## Проверка критериев приёмки

| # | Критерий | Результат | Чем подтверждено |
| --- | --- | --- | --- |
| 1 | Собирается и ставится в DSH Desktop без ошибок | ✅ | `plugin_manager install_bundle` → `application: applied`, `warnings: []`; строка и bundle записаны в профиль |
| 2 | Вкладка открывается и показывает `chat.deepseek.com` | ✅ логически, 👁 визуально не проверено | клиентская половина активирована: `main` и `sidebar.panellist` содержат `deepseek-chat-exporter` (`active: true`); гость создаётся по аренде lease и навигируется на `https://chat.deepseek.com` — это надо один раз увидеть глазами |
| 3 | Сессия сохраняется после перезапуска | ❌ невозможно в текущем Desktop | политика webview: partition без `persist:` + запрет guest'ов без аренды (см. «Ограничения»); внутри одного запуска сессия сохраняется |
| 4 | `/export-chats` создаёт `.md` в `research/` | ✅ | live-проверка на работающем хосте: `export #1 → exported=2`, файлы в `research/`; команда проверена в `test/host-contract.test.mjs` |
| 5 | YAML frontmatter + полный текст без reasoning | ✅ | содержимое реального файла выше + `test/host-contract.test.mjs`, `test/export.test.mjs` |
| 6 | Неизменённые диалоги не перезаписываются | ✅ | `export #2 → skipped=2`, mtime не изменился; тест «unchanged chat is skipped…» |
| 7 | Изменённый диалог обновляется в том же файле | ✅ | `export #3 → exported=1`, то же имя файла, новый `last_message_hash`, сохранённый `exported_at` |
| 8 | Ошибки API/сети обрабатываются, виден прогресс и итог | ✅ | прогресс и ошибки в панели (`error.*`, `progress.*`), ошибки санитизируются; хост возвращает конверт `{ok:false,error:{code,message}}`; тесты протокола |

## Разработка

```
plugins/dsh-plugin-deepseek-chat-exporter/
├─ package.json            манифест: dsh.bundle.patch + dsh.client
├─ cordis.patch.yml        строка плагина и все настройки по умолчанию
├─ index.js                хост-половина: маршрут /dsh-chat-exporter/rpc, /export-chats, очередь
├─ lib/export.js           чистый движок: кэш, имена файлов, Markdown, запись (без Cordis и сети)
├─ src/shared/normalize.js нормализация ответов DeepSeek (общая для хоста и клиента)
├─ src/client/main.js      клиентская половина: панель, guest, API, прогресс, диагностика
├─ client.js               СГЕНЕРИРОВАННЫЙ артефакт (не править)
├─ scripts/build-client.mjs сборка client.js (инлайн normalize.js)
├─ test/                   нормализатор, движок экспорта, контракт хоста, wiring клиента, live smoke
├─ locale/{en,ru}.json     отображаемые название и описание для Plugin Manager
└─ icon.svg                иконка панели и карточки плагина
```

Сборка и тесты:

```powershell
cd plugins\dsh-plugin-deepseek-chat-exporter
node scripts/build-client.mjs          # пересобрать client.js
node scripts/build-client.mjs --check  # проверить, что client.js не устарел
node test/normalize.test.mjs           # 25 проверок (в т.ч. ответы, ссылки, источники)
node test/export.test.mjs              # 11 проверок
node test/host-contract.test.mjs       # 11 проверок (реальный маршрут + команда + диагностика)
node test/client-wiring.test.mjs       #  4 проверки (loader-handshake + слоты)
node test/guest-token.test.mjs         #  8 проверок (лестница токенов в guest'е)
node test/endpoint-ladder.test.mjs     #  5 проверок (отказ одного endpoint'а не фатален)
node test/live-export-smoke.mjs        # проверка на запущенном DSH (нужен живой хост)
```

`client.js` — обычный классический скрипт с `window.__ModuleLoader__.load({ id, factory })`,
как и у штатных клиентских пакетов DSH; сборщик лишь подставляет код нормализатора на место
маркера `/* __INLINE_NORMALIZE__ */`, потому что загрузчик принимает один файл на пакет.
