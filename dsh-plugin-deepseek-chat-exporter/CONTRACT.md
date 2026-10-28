# Internal contract — `@local/dsh-deepseek-chat-exporter`

Authoritative interface document for the plugin's two halves. Every implementer works
against this file; do not change a signature here without telling the Team Lead.

## 0. Facts established from the installed DSH Desktop (authority, not guesswork)

| Fact | Evidence |
| --- | --- |
| The Web UI renderer is an Electron `BrowserWindow` with `webviewTag: primary` | `resources\app.asar\lib\main.js`: `createWindow(... primary)` → `webPreferences.webviewTag: primary` |
| `<webview>` is **not** free-form: the main process rejects any guest without a lease | `DesktopBrowserGuests.bind()` → `will-attach-webview` calls `event.preventDefault()` unless `params.src === "about:blank#" + leaseId` and `params.partition === lease.partition` |
| A lease comes from the preload bridge `globalThis.dshDesktop.browser.acquire(workspaceKey)` → `{ lease, partition }` | preload-app.cjs `createDesktopBrowserBridge`; main.js `ipcMain.handle(DESKTOP_IPC.browserAcquire, …)` |
| The lease partition is process-lifetime only (`dsh-sidebar-browser-<uuid>`, no `persist:` prefix) | `DesktopBrowserGuests.acquire()`; shipped package README: "Cookies and Web storage do not survive application restart" |
| The renderer origin is `dsh-app://app`; all other paths are forwarded to the local Host HTTP server with the Host cookie | main.js `protocol.handle(SCHEME, …)` → `forwardWebRequest(request, hostUrl, hostCookie)`, which forwards **method, headers and body** |
| A plugin panel = keyed `main` slot + matching `sidebar.panellist` id | live slot catalog (`cordis_inspect_query`): "Each list id addresses the matching main panel" |
| Commands are host-side, async, and return one final text | `ctx.commands.register({ name, description, handler })`, `CommandResult` |
| The Host process is a plain Node child process (no Electron APIs) | main.js `new DesktopHostProcess(resources.node, resources.dsh, …)`; `dsh.cmd` sets `ELECTRON_RUN_AS_NODE=1` |

## 1. Runtime shape

```text
BrowserWindow (renderer, origin dsh-app://app)
  └─ client half  client.js   ← webview guest (lease), DeepSeek API calls, UI
        │  POST /dsh-chat-exporter/rpc  (same-origin fetch)
        ▼
Host Node process
  └─ host half  index.js + lib/export.js   ← cache, Markdown, files, /export-chats
        │  fs
        ▼
  <workspaceRoot>/research/*.md  +  <workspaceRoot>/.dsh-chat-exporter-cache.json
```

The client half never touches the filesystem; the host half never touches cookies,
tokens or the network. DeepSeek HTTP requests happen **only** inside the webview guest,
so they carry that session's cookies by construction.

## 2. Wire protocol

Single route, registered by the host half:

```js
ctx.webServer.register({ kind: 'prefix', path: '/dsh-chat-exporter', handler })
```

`POST /dsh-chat-exporter/rpc` — request body is JSON, response is JSON, both
`content-type: application/json; charset=utf-8`.

Envelope:

```ts
type RpcRequest  = { id?: string, method: string, params?: unknown }
type RpcResponse = { ok: true, value: unknown }
                 | { ok: false, error: { code: string, message: string } }
```

Unknown methods answer `ok:false, code:"E_METHOD"`. A thrown handler answers
`ok:false, code:"E_INTERNAL"` with a sanitized message. Never echo cookies, tokens,
`Authorization` headers or raw response bodies in an error message.

### Methods

#### `hello` → `{ plugin, version, workspaceRoot, outputDir, cachePath, api, limits }`

Called once when the client half applies. `api` is the endpoint table from the host
config (see §5) so users retune endpoints in `cordis.patch.yml` without rebuilding the
client bundle. `workspaceRoot` is the resolved default root. `limits` carries
`commandWaitMs`, `maxChats`, `fileNameMaxTitle`.

#### `export` params `{ chats: NormalizedChat[], workspacePath?: string }` →

```ts
{ found: number, exported: number, skipped: number, failed: number,
  researchDir: string,
  results: Array<{ chatId, title, status: 'exported'|'skipped'|'failed',
                   file?: string, reason?: string }>,
  errors: string[] }
```

Idempotent. The host decides skip-vs-write from its cache; the client must not
pre-filter. `workspacePath` is the workspace the client believes is current; the host
ignores it unless it is an existing absolute directory (fallback: `workspaceRoot`).

#### `poll` params `{ clientId: string, ready: boolean }` → `{ job: null | { id: string } }`

Long-lived rendezvous for `/export-chats`. The host hands a queued command job to the
first client that polls with `ready:true`; `ready:false` (webview not mounted) yields
`job:null` and leaves the job queued.

#### `jobResult` params `{ jobId, ok, summary?, error? }` → `{ accepted: boolean }`

Settles the command job. `summary` is plain text (<= 4000 chars) shown as the command
result; `ok:false` turns it into a command error.

#### `status` → `{ cachePath, researchDir, workspaceRoot, entries: number, lastExportAt: string|null }`

#### `clearCache` params `{}` → `{ removed: number }`

Drops cache entries (files are not deleted; a later export rewrites them).

## 3. Data shapes

```ts
type NormalizedMessage = {
  id: string            // source message id, '' when the endpoint has none
  role: 'user' | 'assistant'
  text: string          // markdown-ready plain text, reasoning already removed
  createdAt?: number    // epoch ms
}

type NormalizedChat = {
  chatId: string
  title: string
  sourceUrl: string     // https://chat.deepseek.com/a/chat/s/<chatId>
  createdAt?: number
  updatedAt?: number
  lastMessageId: string // id of the last kept message, '' when unknown
  messages: NormalizedMessage[]  // chronological, non-empty for export
}
```

Invariants the host enforces defensively (a client bug must not corrupt the archive):

- messages whose `role` is not `user`/`assistant` are dropped;
- messages with `reasoning: true`, `type` in `REASONING_TYPES`, or empty text are dropped;
- consecutive messages with the same role are kept but separated by a blank line;
- `chatId` must match `/^[A-Za-z0-9_-]{1,128}$/`, otherwise the chat fails with
  `E_CHAT_ID` and is counted in `failed`.

`lastMessageId` and the hash are computed **by the host**:
`sha256(lastMessage.id + "\u0000" + lastMessage.text)` (hex, 64 chars). The client may
send `lastMessageId` but the host recomputes it from `messages` and uses its own value.

## 4. Cache

`<workspaceRoot>/.dsh-chat-exporter-cache.json`, UTF-8, pretty-printed, atomically
replaced (write `*.tmp` then rename):

```json
{
  "version": 1,
  "updatedAt": "2026-10-27T06:00:00.000Z",
  "chats": {
    "<chatId>": {
      "title": "…",
      "file": "research/2026-10-27_Title_1a2b3c4d.md",
      "lastMessageId": "…",
      "lastMessageHash": "…",
      "messageCount": 12,
      "exportedAt": "…",
      "updatedAt": "…",
      "lastExportAt": "…"
    }
  }
}
```

Skip rule: `lastMessageId` **and** `lastMessageHash` equal the cache **and** the recorded
file still exists on disk. Otherwise write (overwriting the recorded file, never adding a
new one for a known chat). File name: `{YYYY-MM-DD}_{slug(title)}_{first8(chatId)}.md`,
`slug` keeping letters/digits/`-`/`_` (Cyrillic and CJK letters are letters), collapsing
runs, trimmed to `fileNameMaxTitle` characters; the date is `createdAt ?? updatedAt ?? now`.

## 5. Host config (row `config` in `cordis.patch.yml`)

No `Config` export is used: the package is installed as a linked directory and must not
depend on `@deepseek-ai/schemastery` resolution. Every key is optional; the host merges
it over the defaults below and ignores unknown keys.

```yaml
config:
  outputDir: research                    # relative to workspaceRoot
  cacheFileName: .dsh-chat-exporter-cache.json
  workspaceRoot: ""                      # absolute override; default = Host working directory
  labelUser: "Пользователь"
  labelAssistant: "Ассистент"
  fileNameMaxTitle: 60
  commandWaitMs: 180000
  maxChats: 500
  api:
    base: "https://chat.deepseek.com"
    authProbe:   { method: GET,  path: "/api/v0/users/current" }
    listEndpoints:
      - { method: POST, path: "/api/v0/chat_session/fetch_page?count=100", body: "{}" }
      - { method: GET,  path: "/api/v0/chat_session/fetch_page?count=100" }
    historyEndpoints:
      - { method: GET,  path: "/api/v0/chat/history_messages?chat_session_id={chatId}" }
      - { method: POST, path: "/api/v0/chat/history_messages", body: "{\"chat_session_id\":\"{chatId}\"}" }
    domFallback:
      enabled: true
      messageSelector: "[data-message-author-role], .ds-message"
      roleAttribute: "data-message-author-role"
```

## 6. Host module layout (`index.js` is thin, `lib/export.js` is pure)

`lib/export.js` — no Cordis, no network, no global state; unit-testable with `node --test`:

```js
export function normalizeHostChat(raw, options)   // defensive validation (§3 invariants)
export function hashLastMessage(message)          // sha256(m.id + "\0" + m.text), hex
export function slugifyTitle(title, maxLength)    // filename-safe, may return ""
export function buildFileName(chat, cacheEntry, options) // returns { fileName, datePrefix }
export function renderMarkdown(chat, meta, options)      // frontmatter + body (§7)
export async function readCache(cachePath)        // {version,updatedAt,chats} | empty cache
export async function writeCache(cachePath, cache) // atomic
export async function runExport({ chats, workspaceRoot, outputDir, cacheFileName,
                                  labels, fileNameMaxTitle, logger }) // → §2 `export` value
export function yamlScalar(value)                 // double-quoted YAML scalar escaping
```

`index.js`:
`export const name`, `export const inject = ['webServer']` (soft: use
`ctx.inject(['webServer','commands'], …)` so the plugin stays inert without them),
`export function apply(ctx, config)`, plus the job bus and the `/export-chats` command.
All registrations go through `ctx.effect(...)`/`ctx.on(...)` and return their disposers.

## 7. Markdown file

```markdown
---
title: "…"
chat_id: "…"
source_url: "https://chat.deepseek.com/a/chat/s/…"
exported_at: "2026-10-27T06:00:00.000Z"
updated_at: "2026-10-27T06:00:00.000Z"
message_count: 12
last_message_id: "…"
last_message_hash: "…"
---

**Пользователь:**

text

**Ассистент:**

text
```

`exported_at` — first export of this chat (kept from cache on updates);
`updated_at` — content timestamp of the last write. Body ends with exactly one `\n`.

## 8. Client half (`client.js`, generated from `src/client/main.js`)

- registers `main` (key `deepseek-chat-exporter`) and `sidebar.panellist`
  (id `deepseek-chat-exporter`, `order: 20`, icon component);
- creates the guest with the lease recipe from §0 and navigates it to
  `https://chat.deepseek.com`;
- runs `window.__ModuleLoader__.load({ id: '@local/dsh-deepseek-chat-exporter', factory })`
  exactly like the shipped client packages;
- degrades without `globalThis.dshDesktop` (plain browser) to an explanatory panel;
- background poller started in `apply`, cleaned up with `ctx.effect`.

### Inlined shared code

`client.js` is generated by `scripts/build-client.mjs`, which inlines
`src/shared/normalize.js` (ESM, `export`-stripped) into `src/client/main.js` at the marker

```js
/* __INLINE_NORMALIZE__ */
```

`src/shared/normalize.js` is also imported directly by the host, so both halves share one
implementation:

```js
export function normalizeChatList(payload)  // → Array<{chatId,title,sourceUrl,createdAt,updatedAt}>
export function normalizeHistory(payload)   // → Array<NormalizedMessage> (chronological)
export function isReasoningRecord(record)   // boolean
export function extractJsonText(bodyText)   // tolerant JSON parse (SSE/prefix junk)
```

Tolerance rules (the live endpoints are not contractually documented, so the normalizer
walks shapes instead of trusting one):

- chat list: first array found under `biz_data`/`data`/`result` whose objects expose an
  id field (`id`, `chat_session_id`, `session_id`, `chatId`) — title from
  `title`/`name`/`topic`, timestamps from `updated_at`/`updatedAt`/`create_time` (seconds
  or ms, normalized to ms);
- history: first array under the same roots matching names
  `chat_messages`/`messages`/`history`/`items`;
- message text: `content` (string) else concatenation of `fragments[].content` in order;
- message role: `role` (`USER`/`ASSISTANT`…), else `type` (`REQUEST`/`RESPONSE`), else
  `fragments[].type`;
- reasoning records (dropped): `reasoning`, `is_reasoning`, `thinking`, `is_thinking`,
  `cot`, and `type`/`fragment.type` in
  `REASONING_TYPES = {reasoning, reasoning_content, thinking, think, cot, thought,
  chain_of_thought, analysis, summary_of_thinking}`.

## 9. Acceptance matrix (what "done" means)

| # | Criterion | How it is proven |
| --- | --- | --- |
| 1 | installs into the desktop profile without errors | `plugin_manager install_bundle` result `application: applied` |
| 2 | panel opens and shows chat.deepseek.com | live slot occupants + user-visible panel; guest URL reported by the panel |
| 3 | session survives an app restart | **blocked by the desktop webview policy** (§0) — documented with evidence, session survives every panel switch/remount inside one app run |
| 4 | `/export-chats` writes `research/*.md` | command run + files listed on disk |
| 5 | frontmatter + full transcript, no reasoning | `test/export.test.mjs` + a real exported file |
| 6 | unchanged chats are not rewritten | mtime comparison + `status: 'skipped'` in the summary |
| 7 | changed chats update the same file | second export with a new last message → same path, new hash |
| 8 | API/network errors surface progress and a final statistic | forced failure path in the panel + command error text |
