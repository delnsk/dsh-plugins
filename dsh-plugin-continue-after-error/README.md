# «Продолжить» после ошибки — плагин DSH Desktop

Плагин добавляет в чат кнопку **«Продолжить»** под ходом (turn), который остановился
из‑за ошибки провайдера, обрыва стрима, перезапуска DSH или ручной остановки. Один клик
отправляет в ту же сессию короткое сообщение-продолжение, и агент продолжает работу с
места остановки — без ручного ввода «продолжай».

```
Провайдер: ошибка …            ← существующая красная строка ошибки
[▶ Продолжить]                 ← плагин
```

## Что происходит

- Кнопка появляется **только под последним ходом** сессии, если этот ход завершился с
  причиной `error`, `interrupted` или `aborted` (по умолчанию), сессия не выполняется,
  а ошибка не является проблемой входа/квоты (для `ACCOUNT_SIGNED_OUT`,
  `ACCOUNT_SIGN_IN_REQUIRED`, `QUOTA`, `ACCOUNT_QUOTA` кнопка скрыта — сначала нужно
  починить аккаунт).
- По клику в сессию отправляется обычное пользовательское сообщение
  (`Продолжай с того места, где остановился. Не повторяй уже выполненную работу.`)
  через тот же путь, которым пользуется композер (`conversation.sendSession`), поэтому
  оно появляется в транскрипте как обычная реплика, а ошибки отправки видны под кнопкой.
- Исторические (не последние) ходы кнопку не показывают: после успешного продолжения она
  исчезает сама.

## Установка

Плагин уже установлен в профиль `desktop`:

- `~/.dsh/profiles/desktop/package.json` — зависимость
  `"@local/dsh-plugin-continue-after-error": "link:…/plugins/dsh-plugin-continue-after-error"`
  и bundle в `dsh.profile.bundles`;
- `~/.dsh/profiles/desktop/node_modules/@local/dsh-plugin-continue-after-error` — junction
  на эту папку.

Повторить установку в другом профиле:

```powershell
# 1. зависимость
dsh plugin --profile <profile> add "C:\Users\maksimov2\Documents\deepseek-harness\default-workspace\plugins\dsh-plugin-continue-after-error"
# 2. bundle: добавьте "@local/dsh-plugin-continue-after-error" в dsh.profile.bundles
#    в ~/.dsh/profiles/<profile>/package.json
```

Живой DSH с HMR подхватывает изменение `dsh.profile.bundles` без перезапуска. Без HMR
нужен перезапуск приложения.

## Как устроено

```
BrowserWindow (renderer, origin dsh-app://app)
  └─ Client half  client.js
        ├─ ctx.slots.inject('conversation.chat.turnTail') → entry «Продолжить»
        │     owner props: { turn: TurnLocation, seq, openFile }
        │     стандартные props: useChat, useSession, sessionId, t, …
        └─ POST /dsh-continue/rpc  (config / report / status)
Host (Node-процесс DSH)
  └─ index.js + lib/rpc.js
        ├─ profile-конфигурация (prompt, triggerOn, diagnostics)
        └─ <workspace>/.dsh-continue-diagnostics.json (ограниченный журнал)
```

- Решение «показывать ли кнопку» принимает чистая функция
  `offerForTurn()` из `src/shared/continue.js`. Она встраивается в `client.js` при сборке
  и импортируется тестами напрямую — одна реализация на браузер и тесты.
- Хост-часть не обязательна: без неё кнопка работает на встроенных локализованных
  значениях, а журнал просто не пишется.

## Конфигурация

Все ключи необязательны и живут в `cordis.patch.yml` пакета (или в вашем patch-слое с тем
же `id`):

| Ключ | По умолчанию | Смысл |
| --- | --- | --- |
| `triggerOn` | `['error','interrupted','aborted']` | Причины остановки, при которых показывать кнопку. Допустимо добавить `max-tokens`. |
| `prompt` | `''` | Переопределяет текст сообщения. Пусто — берётся локализованный текст (ru/en/zh). |
| `diagnostics` | `true` | Писать журнал в workspace. |
| `diagnosticsFileName` | `.dsh-continue-diagnostics.json` | Имя файла журнала (только имя, без пути). |
| `workspaceRoot` | `''` | Абсолютный override каталога журнала; по умолчанию — реестр workspace. |

Пример: продолжать и после обрезания по лимиту токенов, со своим текстом:

```yaml
- id: continue-after-error
  name: '@local/dsh-plugin-continue-after-error'
  config:
    triggerOn: ['error', 'interrupted', 'aborted', 'max-tokens']
    prompt: 'Продолжай, не повторяя сделанное.'
```

## Диагностика

`<workspace>/.dsh-continue-diagnostics.json` — последние 100 событий клиента:

| Событие | Что означает |
| --- | --- |
| `client-mount` | клиентский bundle загружен и применён в браузере |
| `client-registered` | слот `conversation.chat.turnTail` найден, entry зарегистрирован |
| `client-config` | хост-часть ответила конфигурацией |
| `client-evaluated` | entry впервые получил реальные props хода (в `message`: `latest`, `running`, `turnNumber`, `reason`, `hasEnd`) |
| `client-render` | кнопка реально отрисована (sessionId + turn) |
| `continue-click` / `continue-sent` / `continue-failed` | нажатие и результат отправки |

Проверить состояние маршрута в живом DSH (из DevTools рендерера или любого клиента,
прошедшего авторизацию GUI):

```text
POST /dsh-continue/rpc  {"method":"status"}
```

## Разработка

```powershell
cd plugins/dsh-plugin-continue-after-error
node scripts/build-client.mjs           # пересобрать client.js (он генерируется)
node scripts/build-client.mjs --check   # проверить, что артефакт не устарел
node test/continue.test.mjs             #  17 проверок: правила показа и текст
node test/host.test.mjs                 #   7 проверок: config/report/status, лимиты
node test/client-harness.test.mjs       #   4 проверки: bundle, слот, рендер, клик
node test/build.test.mjs                #   2 проверки: артефакт совпадает с исходниками
```

`node --test test/` в этом окружении может падать из‑за EPERM на spawn дочерних
процессов; отдельные файлы запускаются напрямую (так и делает `npm test`).

## Ограничения

- Кнопка привязана к **последнему** завершённому ходу в загруженном окне истории.
- После нажатия в транскрипт добавляется реплика пользователя — это осознанно: DSH не
  умеет «продолжить» ход без нового ввода, а сообщение делает возобновление явным.
- Плагин использует клиентские API DSH (`conversation.chat.turnTail`, `useChat`,
  `useSession`, `conversation.sendSession`). При обновлении DSH с изменением этих
  контрактов возможны поломки; журнал `client-*` и тесты помогут локализовать причину.
- Требуется включённый `@deepseek-ai/dsh-client-ui-chat` (стандартный чат).
