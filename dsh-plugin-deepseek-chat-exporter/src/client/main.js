/**
 * Client half of the DeepSeek chat exporter.
 *
 * Responsibilities, and deliberately nothing else:
 *  - own the sandboxed `chat.deepseek.com` guest (lease → partition → webview),
 *  - call the DeepSeek web API *inside* that guest so requests carry its session,
 *  - normalize the payloads and hand them to the Host half over one HTTP route,
 *  - render progress, the run summary and diagnostics.
 *
 * The Host half writes files, owns the cache and the `/export-chats` command. Files,
 * cookies and tokens never cross the boundary in either direction.
 *
 * The module is generated into `client.js` by scripts/build-client.mjs, which inlines
 * `src/shared/normalize.js` at the marker below (the Client loader accepts one classic
 * script per package, so shared code cannot be imported).
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-chat-exporter',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /* __INLINE_NORMALIZE__ */

    const NS = 'deepseek-chat-exporter'
    const PANEL_ID = 'deepseek-chat-exporter'
    const RPC_PATH = '/dsh-chat-exporter/rpc'
    const HOME_URL = 'https://chat.deepseek.com'
    /** Stable storage-account key: the desktop keeps one process-lifetime partition per key. */
    const WORKSPACE_KEY = 'dsh-plugin-deepseek-chat-exporter'
    const POLL_INTERVAL_MS = 1200
    const POLL_IDLE_MS = 2500
    const PACE_MS = 120
    const GUEST_READY_TIMEOUT_MS = 30000
    const DIAGNOSTIC_TEXT_LIMIT = 400
    const SUMMARY_FILE_LIMIT = 8

    // ---------------------------------------------------------------- copy ---

    const en = {
      'panel.title': 'DeepSeek',
      'panel.export': 'Export chats',
      'panel.reload': 'Reload',
      'panel.diagnostics': 'Diagnostics',
      'panel.hideDiagnostics': 'Hide diagnostics',
      'panel.workspace': 'Workspace',
      'panel.exporting': 'Exporting…',
      'panel.stop': 'Stop',
      'panel.stopping': 'Stopping…',
      'status.connecting': 'Opening chat.deepseek.com…',
      'status.ready': 'Signed in',
      'status.signedOut': 'Sign in inside this panel',
      'status.unknown': 'Checking session…',
      'status.loading': 'Loading…',
      'status.exporting': 'Exporting',
      'needDesktop.title': 'An in-app panel needs DSH Desktop',
      'needDesktop.body':
        'This page runs in a plain browser, so it cannot host the isolated webview that keeps the DeepSeek session. Open this profile in DSH Desktop, or export from the agent with the /export-chats command while the Desktop panel is open.',
      'error.guestGone': 'The embedded page was closed unexpectedly. Reload the panel.',
      'error.noGuest': 'The DeepSeek page is not ready yet. Wait for it to load and sign in.',
      'error.host': 'The plugin Host half is not active, so files cannot be written.',
      'error.export': 'Export failed',
      'error.auth': 'chat.deepseek.com rejected the session ({message}). Sign in inside this panel and retry.',
      'progress.found': 'Found {count} chats',
      'progress.chat': 'Reading {index}/{total}: {title}',
      'progress.write': 'Writing {total} files…',
      'progress.stopping': 'Stopping after the current chat…',
      'summary.ok':
        'Found {found}, exported {exported}, skipped {skipped} unchanged, failed {failed}. Files: {dir}',
      'summary.files': 'Written: {files}',
      'summary.failures': 'Failures: {failures}',
      'summary.stopped': 'Stopped by user — the chats already read were written, the rest were skipped.',
    }

    const ru = {
      'panel.title': 'DeepSeek',
      'panel.export': 'Экспорт чатов',
      'panel.reload': 'Перезагрузить',
      'panel.diagnostics': 'Диагностика',
      'panel.hideDiagnostics': 'Скрыть диагностику',
      'panel.workspace': 'Рабочая область',
      'panel.exporting': 'Экспорт…',
      'panel.stop': 'Стоп',
      'panel.stopping': 'Останавливаю…',
      'status.connecting': 'Открываю chat.deepseek.com…',
      'status.ready': 'Вход выполнен',
      'status.signedOut': 'Войдите в эту панель',
      'status.unknown': 'Проверяю сессию…',
      'status.loading': 'Загрузка…',
      'status.exporting': 'Экспорт',
      'needDesktop.title': 'Встроенная панель требует DSH Desktop',
      'needDesktop.body':
        'Страница открыта в обычном браузере, поэтому изолированный WebView с сессией DeepSeek недоступен. Откройте профиль в DSH Desktop или запустите /export-chats в агенте, пока панель Desktop открыта.',
      'error.guestGone': 'Встроенная страница неожиданно закрылась. Перезагрузите панель.',
      'error.noGuest': 'Страница DeepSeek ещё не готова. Дождитесь загрузки и войдите в аккаунт.',
      'error.host': 'Хост-часть плагина не активна — запись файлов недоступна.',
      'error.export': 'Экспорт не удался',
      'error.auth': 'chat.deepseek.com отклонил сессию ({message}). Войдите в аккаунт в этой панели и повторите.',
      'progress.found': 'Найдено чатов: {count}',
      'progress.chat': 'Читаю {index}/{total}: {title}',
      'progress.write': 'Записываю файлы: {total}',
      'progress.stopping': 'Останавливаю после текущего диалога…',
      'summary.ok':
        'Найдено {found}, экспортировано {exported}, пропущено без изменений {skipped}, ошибок {failed}. Папка: {dir}',
      'summary.files': 'Записаны: {files}',
      'summary.failures': 'Ошибки: {failures}',
      'summary.stopped': 'Остановлено пользователем: уже прочитанные диалоги записаны, остальные пропущены.',
    }

    const zh = {
      'panel.title': 'DeepSeek',
      'panel.export': '导出对话',
      'panel.reload': '重新加载',
      'panel.diagnostics': '诊断',
      'panel.hideDiagnostics': '隐藏诊断',
      'panel.workspace': '工作区',
      'panel.exporting': '正在导出…',
      'panel.stop': '停止',
      'panel.stopping': '正在停止…',
      'status.connecting': '正在打开 chat.deepseek.com…',
      'status.ready': '已登录',
      'status.signedOut': '请在此面板中登录',
      'status.unknown': '正在检查会话…',
      'status.loading': '加载中…',
      'status.exporting': '导出中',
      'needDesktop.title': '内置面板需要 DSH Desktop',
      'needDesktop.body':
        '此页面在普通浏览器中运行，无法承载保留 DeepSeek 会话的隔离 WebView。请在 DSH Desktop 中打开此配置，或在 Desktop 面板打开时使用 /export-chats 命令。',
      'error.guestGone': '内置页面意外关闭，请重新加载面板。',
      'error.noGuest': 'DeepSeek 页面尚未就绪，请等待加载完成并登录。',
      'error.host': '插件 Host 部分未激活，无法写入文件。',
      'error.export': '导出失败',
      'error.auth': 'chat.deepseek.com 拒绝了会话（{message}）。请在此面板登录后重试。',
      'progress.found': '找到 {count} 个对话',
      'progress.chat': '读取 {index}/{total}：{title}',
      'progress.write': '写入 {total} 个文件…',
      'progress.stopping': '正在当前对话后停止…',
      'summary.ok': '找到 {found}，已导出 {exported}，未变更跳过 {skipped}，失败 {failed}。目录：{dir}',
      'summary.files': '已写入：{files}',
      'summary.failures': '失败：{failures}',
      'summary.stopped': '已由用户停止：已读取的对话已写入，其余已跳过。',
    }

    const translate = (dictionary, fallback) => (key, values) => {
      const template = dictionary[key] ?? fallback[key] ?? key
      if (values === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] === undefined ? match : String(values[name]),
      )
    }

    const localTranslate = translate(en, en)

    // -------------------------------------------------------------- helpers ---

    const describe = (error) => {
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
      return String(error)
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const isDesktopCarrier = () => {
      const carrier = globalThis.dshDesktop
      if (carrier === undefined || carrier === null || carrier.protocolVersion !== 1) return undefined
      const bridge = carrier.browser
      if (bridge === undefined || bridge === null) return undefined
      if (typeof bridge.acquire !== 'function' || typeof bridge.release !== 'function') return undefined
      return bridge
    }

    async function rpc(method, params) {
      const response = await fetch(RPC_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      const raw = await response.text()
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        throw new Error(`host returned HTTP ${response.status}`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`
        throw new Error(String(message))
      }
      return payload.value
    }

    /** Endpoint table rows are user-editable, so every field is coerced defensively. */
    const resolveEndpoint = (endpoint, chatId, base) => {
      if (endpoint === null || typeof endpoint !== 'object' || typeof endpoint.path !== 'string' || endpoint.path === '') return undefined
      const path = endpoint.path.split('{chatId}').join(encodeURIComponent(chatId === undefined ? '' : chatId))
      let url
      try {
        url = new URL(path, base).href
      } catch {
        return undefined
      }
      const body = typeof endpoint.body === 'string' ? endpoint.body.split('{chatId}').join(chatId === undefined ? '' : chatId) : undefined
      const headers = endpoint.headers !== null && typeof endpoint.headers === 'object' ? endpoint.headers : undefined
      return {
        url,
        method: String(endpoint.method === undefined ? 'GET' : endpoint.method).toUpperCase(),
        body,
        headers,
        label: `${String(endpoint.method === undefined ? 'GET' : endpoint.method).toUpperCase()} ${path}`,
      }
    }

    /**
     * Fetch from inside the guest document so the request carries that session's
     * cookies. DeepSeek's web client keeps its bearer token in web storage, so an
     * unauthenticated cookie-only request is retried once with that token; the token
     * stays inside the guest and is never returned to the panel or the Host.
     */
        const GUEST_REQUEST = `(request) => {
      // DeepSeek wraps its bearer token in web storage, sometimes twice:
      //   userToken = {"value":"<token>","__version":"0"}   or   {"value":"{\"value\":\"<token>\"}"}
      // A token is a base64url/JWT-shaped string, so anything containing JSON punctuation is
      // unwrapped again instead of being sent verbatim. Every harvested candidate is then
      // tried against the server, which is the only authority on which one is valid.
      const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/u
      const isToken = (value) => typeof value === 'string' && value.length >= 16 && value.length <= 8192 && TOKEN_PATTERN.test(value)
      const TOKEN_KEY = /token|jwt|auth/iu
      // Depth-first walk that collects token-shaped strings instead of trusting one shape.
      // Only the server can say which one is the API credential, so several are offered to it.
      const collect = (value, depth, out, source) => {
        if (out.length >= 4 || depth > 6 || value === null || value === undefined) return
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (isToken(trimmed)) {
            if (!out.some((entry) => entry.token === trimmed)) out.push({ source, token: trimmed })
            return
          }
          if (trimmed.length <= 8192 && (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) {
            try {
              collect(JSON.parse(trimmed), depth + 1, out, source)
            } catch (error) {
              // Not JSON after all: it simply is not a credential.
            }
          }
          return
        }
        if (typeof value !== 'object') return
        const keys = Object.keys(value).slice(0, 20)
        const ordered = keys.filter((key) => TOKEN_KEY.test(key)).concat(keys.filter((key) => !TOKEN_KEY.test(key)))
        for (const key of ordered) collect(value[key], depth + 1, out, source)
      }
      // Keys that look like tokens but are not the API credential are tried last.
      const DEMOTED_SOURCES = ['settingsjwt']
      const PREFERRED_KEYS = ['userToken', 'user_token', 'token', 'access_token', 'accessToken', 'jwt', 'auth_token']
      const harvest = () => {
        const found = []
        const push = (source, raw) => {
          if (typeof raw !== 'string' || raw === '') return
          collect(raw, 0, found, source)
        }
        const stores = [window.localStorage, window.sessionStorage]
        try {
          for (const key of PREFERRED_KEYS) {
            for (const store of stores) {
              if (store === null || store === undefined) continue
              push(key, store.getItem(key))
            }
          }
          for (const store of stores) {
            if (store === null || store === undefined) continue
            for (let index = 0; index < store.length; index += 1) {
              const key = store.key(index)
              if (key === null || !TOKEN_KEY.test(key)) continue
              push(key, store.getItem(key))
            }
          }
        } catch (error) {
          // An unreadable storage must not prevent the cookie-only attempt.
        }
        const demoted = found.filter((entry) => DEMOTED_SOURCES.includes(entry.source.toLowerCase()))
        const primary = found.filter((entry) => !DEMOTED_SOURCES.includes(entry.source.toLowerCase()))
        return primary.concat(demoted).slice(0, 4)
      }
      const scanIndexedDb = async () => {
        try {
          if (indexedDB === undefined || typeof indexedDB.databases !== 'function') return ''
          const databases = await indexedDB.databases()
          for (const entry of (databases || []).slice(0, 6)) {
            const name = entry && entry.name
            if (typeof name !== 'string' || name === '') continue
            const found = await new Promise((resolve) => {
              let request
              try {
                request = indexedDB.open(name)
              } catch (error) {
                resolve('')
                return
              }
              const close = (value) => {
                try {
                  request.result.close()
                } catch (error) {
                  /* already closed */
                }
                resolve(value)
              }
              request.onerror = () => resolve('')
              request.onblocked = () => resolve('')
              request.onsuccess = () => {
                try {
                  const stores = Array.from(request.result.objectStoreNames || [])
                  if (stores.length === 0) {
                    close('')
                    return
                  }
                  const transaction = request.result.transaction(stores, 'readonly')
                  let remaining = stores.length
                  let settled = false
                  const done = (value) => {
                    if (settled) return
                    settled = true
                    close(value)
                  }
                  for (const storeName of stores) {
                    let cursorRequest
                    try {
                      cursorRequest = transaction.objectStore(storeName).openCursor()
                    } catch (error) {
                      remaining -= 1
                      if (remaining === 0) done('')
                      continue
                    }
                    let seen = 0
                    cursorRequest.onerror = () => {
                      remaining -= 1
                      if (remaining === 0) done('')
                    }
                    cursorRequest.onsuccess = () => {
                      const cursor = cursorRequest.result
                      if (cursor === null || seen >= 200) {
                        remaining -= 1
                        if (remaining === 0) done('')
                        return
                      }
                      seen += 1
                      const value = cursor.value
                      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                        for (const key of Object.keys(value).slice(0, 30)) {
                          if (!TOKEN_KEY.test(key)) continue
                          const collected = []
                          collect(value[key], 1, collected, 'indexedDB')
                          if (collected.length > 0) {
                            done(collected[0].token)
                            return
                          }
                        }
                      }
                      cursor.continue()
                    }
                  }
                  if (remaining === 0) done('')
                } catch (error) {
                  close('')
                }
              }
            })
            if (found !== '') return found
          }
        } catch (error) {
          return ''
        }
        return ''
      }
      const harvestAll = async () => {
        const cached = window.__dshDeepseekTokenCandidates
        if (cached !== null && cached !== undefined && Array.isArray(cached.list) && Date.now() - (cached.at || 0) < 30000) {
          return cached.list
        }
        const list = harvest()
        if (list.length === 0) {
          const fromIndexedDb = await scanIndexedDb()
          if (fromIndexedDb !== '') list.push({ source: 'indexedDB', token: fromIndexedDb })
        }
        try {
          window.__dshDeepseekTokenCandidates = { list, at: Date.now() }
        } catch (error) {
          /* a frozen window still leaves the request usable */
        }
        return list
      }
      const isAuthEnvelope = (text) => {
        try {
          const parsed = JSON.parse(text)
          if (parsed === null || typeof parsed !== 'object') return false
          const code = Number(parsed.code)
          return code === 40001 || code === 40002 || code === 40003 || code === 40004 || code === 40005
        } catch (error) {
          return false
        }
      }
      const headers = Object.assign({ accept: 'application/json, text/plain, */*' }, request.headers || {})
      if (request.body !== undefined && request.body !== null && headers['content-type'] === undefined) {
        headers['content-type'] = 'application/json'
      }
      const send = (extra) => fetch(request.url, {
        method: request.method,
        credentials: 'include',
        headers: Object.assign({}, headers, extra),
        body: request.body === undefined || request.body === null ? undefined : request.body,
        redirect: 'follow',
        cache: 'no-store',
      })
      return (async () => {
        try {
          const accepted = (response, text) => response.status >= 200 && response.status < 300 && !isAuthEnvelope(text)
          // A validated credential wins every later request; only an auth-shaped answer makes
          // this loop continue, so a wrong storage key costs one probe, not one wrong export.
          const known = window.__dshDeepseekAuth
          const attempts = []
          if (known !== null && known !== undefined && typeof known.token === 'string' && known.token !== '') {
            attempts.push({ source: known.source || 'cached', token: known.token, scheme: known.scheme || 'bearer', headerName: known.headerName })
          } else {
            // The site's own last credential beats anything guessed from storage: it is what
            // chat.deepseek.com actually accepts, in the header name and scheme it uses.
            const live = window.__dshDeepseekAuthHeader
            if (live !== null && live !== undefined && typeof live.value === 'string' && live.value !== '' && typeof live.name === 'string') {
              attempts.push({ source: 'live:' + live.name, token: live.value, scheme: 'exact', headerName: live.name })
            }
            const candidates = request.withoutToken === true ? [] : await harvestAll()
            for (const candidate of candidates) {
              attempts.push({ source: candidate.source, token: candidate.token, scheme: 'bearer', headerName: 'authorization' })
              attempts.push({ source: candidate.source, token: candidate.token, scheme: 'raw', headerName: 'authorization' })
            }
          }
          attempts.push({ source: 'cookie', token: '', scheme: 'none' })
          let last = null
          for (const attempt of attempts) {
            let extra = {}
            if (attempt.token !== '') {
              if (attempt.scheme === 'bearer') extra = { authorization: 'Bearer ' + attempt.token }
              else if (attempt.scheme === 'raw') extra = { authorization: attempt.token }
              else if (attempt.scheme === 'exact' && typeof attempt.headerName === 'string' && attempt.headerName !== '') {
                extra = { [attempt.headerName]: attempt.token }
              }
            }
            const response = await send(extra)
            const text = await response.text()
            last = {
              status: response.status,
              ok: response.ok,
              url: response.url,
              text,
              tokenUsed: attempt.token !== '',
              tokenSource: attempt.source,
              scheme: attempt.scheme,
            }
            if (accepted(response, text)) {
              if (attempt.token !== '') {
                try {
                  window.__dshDeepseekAuth = {
                    source: attempt.source,
                    token: attempt.token,
                    scheme: attempt.scheme,
                    headerName: attempt.headerName,
                  }
                } catch (error) {
                  /* cache is an optimisation only */
                }
              }
              return last
            }
          }
          return last
        } catch (error) {
          return { status: 0, ok: false, error: String((error && error.message) || error) }
        }
      })()
    }`

    async function guestRequest(element, request) {
      const argument = JSON.stringify({
        url: request.url,
        method: request.method,
        body: request.body === undefined ? undefined : String(request.body),
        headers: request.headers,
      })
      const code = `(${GUEST_REQUEST})(${argument})`
      let value
      try {
        value = await element.executeJavaScript(code, false)
      } catch (error) {
        return { status: 0, ok: false, error: describe(error) }
      }
      if (value === null || typeof value !== 'object') return { status: 0, ok: false, error: 'unexpected guest result' }
      return value
    }

    /**
     * Inventory of the guest's own storage, reported when an export cannot start.
     *
     * When DeepSeek answers "Missing Token" the only question that matters is *where* the
     * session lives. Returning key names, value lengths and JSON shapes (never values, never
     * the token) answers it without opening DevTools and without leaking anything.
     */
    const GUEST_STORAGE_PROBE = `(async () => {
      const describe = (store) => {
        const out = []
        try {
          if (store === null || store === undefined) return out
          const size = Math.min(store.length, 40)
          for (let index = 0; index < size; index += 1) {
            const key = store.key(index)
            if (key === null) continue
            const value = store.getItem(key)
            const length = typeof value === 'string' ? value.length : 0
            let shape = 'string'
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
              try {
                const parsed = JSON.parse(value)
                shape = Array.isArray(parsed) ? 'json-array' : 'json-object:' + Object.keys(parsed).slice(0, 5).join('|')
              } catch (error) {
                shape = 'json-broken'
              }
            }
            out.push({ key: String(key).slice(0, 48), length, shape })
          }
        } catch (error) {
          out.push({ key: '<unreadable>', length: 0, shape: String((error && error.message) || error) })
        }
        return out
      }
      const cookieNames = () => {
        try {
          return document.cookie.split(';').map((part) => part.split('=')[0].trim()).filter((name) => name !== '').slice(0, 30)
        } catch (error) {
          return []
        }
      }
      const databases = async () => {
        try {
          if (indexedDB === undefined || typeof indexedDB.databases !== 'function') return []
          const list = await indexedDB.databases()
          return (list || []).slice(0, 10).map((entry) => (entry && entry.name) || '')
        } catch (error) {
          return ['<unavailable>']
        }
      }
      const count = (selector) => {
        try {
          return document.querySelectorAll(selector).length
        } catch (error) {
          return -1
        }
      }
      const cached = window.__dshDeepseekTokenCandidates
      const accepted = window.__dshDeepseekAuth
      const live = window.__dshDeepseekAuthHeader
      return {
        href: location.href,
        title: (document.title || '').slice(0, 80),
        readyState: document.readyState,
        interceptor: window.__dshDeepseekInterceptor === true,
        liveAuthName: live !== null && live !== undefined && typeof live.name === 'string' ? live.name : '',
        // Counts and names only: a credential never leaves this document.
        tokenCandidates: cached !== null && cached !== undefined && Array.isArray(cached.list) ? cached.list.length : 0,
        tokenCached: accepted !== null && accepted !== undefined && typeof accepted.token === 'string' && accepted.token !== '',
        acceptedSource: accepted !== null && accepted !== undefined && typeof accepted.source === 'string' ? accepted.source : '',
        localStorage: describe(window.localStorage),
        sessionStorage: describe(window.sessionStorage),
        cookies: cookieNames(),
        databases: await databases(),
        chatLinks: count('a[href*="/a/chat/s/"]'),
        loginFields: count('input[type="password"], input[type="tel"]'),
      }
    })()`

    /**
     * Learn the credential chat.deepseek.com itself sends.
     *
     * Guessing the storage key and the `Bearer` scheme already failed once, so the panel also
     * observes the site's real traffic: any credential-shaped header on a `/api/v0/` request
     * is remembered verbatim (name and value) and offered to the server first. It lives only
     * in this document and is never reported, logged or persisted.
     */
    const GUEST_INTERCEPTOR = `(() => {
      if (window.__dshDeepseekInterceptor === true) return true
      window.__dshDeepseekInterceptor = true
      const readHeaders = (headers) => {
        const out = {}
        try {
          if (headers === null || headers === undefined) return out
          if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
            headers.forEach((value, key) => {
              out[String(key).toLowerCase()] = String(value)
            })
            return out
          }
          for (const key of Object.keys(headers)) {
            const value = headers[key]
            if (typeof value === 'string') out[String(key).toLowerCase()] = value
          }
        } catch (error) {
          return out
        }
        return out
      }
      const CREDENTIAL_HEADER = /^(authorization|x-api-key|x-[a-z0-9-]*token[a-z0-9-]*|[a-z0-9-]*-token)$/u
      const store = (url, headers) => {
        try {
          if (typeof url !== 'string' || !/\\/api\\/v0\\//u.test(url)) return
          const lower = readHeaders(headers)
          for (const name of Object.keys(lower)) {
            if (!CREDENTIAL_HEADER.test(name)) continue
            const value = lower[name]
            if (typeof value === 'string' && value.length >= 8 && value.length <= 8192) {
              window.__dshDeepseekAuthHeader = { name, value, at: Date.now() }
            }
          }
        } catch (error) {
          /* observation must never disturb the page */
        }
      }
      try {
        const originalFetch = window.fetch
        if (typeof originalFetch === 'function') {
          window.fetch = function (input, init) {
            try {
              const url = typeof input === 'string'
                ? input
                : (input !== null && input !== undefined && typeof input.url === 'string' ? input.url : '')
              const headers = (init !== null && init !== undefined && init.headers !== undefined && init.headers !== null)
                ? init.headers
                : (input !== null && input !== undefined ? input.headers : undefined)
              store(url, headers)
            } catch (error) {
              /* observation must never disturb the page */
            }
            return originalFetch.apply(this, arguments)
          }
        }
      } catch (error) {
        /* no fetch to observe */
      }
      try {
        const open = XMLHttpRequest.prototype.open
        const setHeader = XMLHttpRequest.prototype.setRequestHeader
        const send = XMLHttpRequest.prototype.send
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__dshUrl = typeof url === 'string' ? url : ''
          this.__dshHeaders = {}
          return open.apply(this, arguments)
        }
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          try {
            if (typeof name === 'string') this.__dshHeaders[String(name).toLowerCase()] = String(value)
          } catch (error) {
            /* observation must never disturb the page */
          }
          return setHeader.apply(this, arguments)
        }
        XMLHttpRequest.prototype.send = function () {
          try {
            store(this.__dshUrl, this.__dshHeaders)
          } catch (error) {
            /* observation must never disturb the page */
          }
          return send.apply(this, arguments)
        }
      } catch (error) {
        /* no XHR to observe */
      }
      return true
    })()`

    async function installInterceptor(element) {
      if (element === null || element === undefined) return false
      try {
        const value = await element.executeJavaScript(GUEST_INTERCEPTOR, false)
        return value === true
      } catch (error) {
        return false
      }
    }

    async function guestStorageProbe(element) {
      if (element === null || element === undefined) return null
      try {
        const value = await element.executeJavaScript(GUEST_STORAGE_PROBE, false)
        return value !== null && typeof value === 'object' ? value : null
      } catch (error) {
        return { error: describe(error) }
      }
    }

    /** Marker error for a user-requested stop: it is not a failure and must not be reported as one. */
    const cancelledError = () => {
      const error = new Error('cancelled')
      error.cancelled = true
      return error
    }

    const isCancelled = (error) => error !== null && typeof error === 'object' && error.cancelled === true

    async function requestWithCandidates(element, api, endpoints, chatId, signal) {
      const base = typeof api.base === 'string' && api.base !== '' ? api.base : HOME_URL
      const list = Array.isArray(endpoints) ? endpoints : []
      const failures = []
      let authFailures = 0
      for (const endpoint of list) {
        if (signal !== undefined && signal.aborted) throw cancelledError()
        const request = resolveEndpoint(endpoint, chatId, base)
        if (request === undefined) continue
        const response = await guestRequest(element, request)
        if (response.error !== undefined) {
          failures.push(`${request.label}: ${response.error}`)
          continue
        }
        if (response.status < 200 || response.status >= 300) {
          failures.push(`${request.label}: HTTP ${response.status}`)
          continue
        }
        const parsed = extractJsonText(response.text)
        if (parsed === undefined) {
          failures.push(`${request.label}: response is not JSON`)
          continue
        }
        // HTTP 200 is not success here: DeepSeek reports refusals inside the body. A refusal on
        // ONE endpoint says nothing about the session — the same credential that the server
        // rejects for `POST …/fetch_page` is accepted for `GET …/fetch_page` — so the next
        // endpoint is still worth trying. Only a full sweep of auth refusals means the session
        // itself is unusable.
        const envelopeFailure = deepseekFailure(parsed)
        if (envelopeFailure !== undefined) {
          failures.push(`${request.label}: ${envelopeFailure.message} (code ${envelopeFailure.code})`)
          if (isAuthFailure(envelopeFailure)) authFailures += 1
          continue
        }
        return { parsed, request, response }
      }
      const error = new Error(failures.length === 0 ? 'no usable endpoint is configured' : failures.join('; '))
      error.endpointFailures = failures
      error.authFailure = failures.length > 0 && authFailures === failures.length
      throw error
    }

    async function collectChats(element, api, hooks, options) {
      const failures = []
      const signal = options.signal
      const aborted = () => signal !== undefined && signal.aborted === true
      let chats = []
      let sessionRejected = false
      let cancelled = false
      if (aborted()) return { chats: [], failures, cancelled: true }
      try {
        const listed = await requestWithCandidates(element, api, api.listEndpoints, undefined, signal)
        chats = normalizeChatList(listed.parsed)
      } catch (error) {
        if (isCancelled(error) || aborted()) return { chats: [], failures, cancelled: true }
        failures.push({ title: '', chatId: '', reason: `chat list: ${describe(error)}` })
        sessionRejected = error !== null && typeof error === 'object' && error.authFailure === true
      }
      // A rejected session cannot be rescued by reading the DOM: stop here instead of
      // starting a slow navigation per chat that would end in the same answer.
      if (sessionRejected) return { chats: [], failures, cancelled: false }
      if (aborted()) return { chats: [], failures, cancelled: true }
      if (chats.length === 0 && api.domFallback !== null && typeof api.domFallback === 'object' && api.domFallback.enabled !== false) {
        try {
          chats = await readDomChatList(element, api.domFallback)
        } catch (error) {
          failures.push({ title: '', chatId: '', reason: `DOM chat list: ${describe(error)}` })
        }
      }
      if (options.maxChats > 0) chats = chats.slice(0, options.maxChats)
      hooks.onList(chats.length)

      const bags = []
      for (let index = 0; index < chats.length; index += 1) {
        // Stop on the nearest chat boundary: the collected chats are still written, so a
        // stop during a long export keeps what was already read.
        if (aborted()) {
          cancelled = true
          break
        }
        const chat = chats[index]
        hooks.onChat(index + 1, chats.length, chat.title)
        try {
          let messages = []
          let rejected = false
          try {
            const history = await requestWithCandidates(element, api, api.historyEndpoints, chat.chatId, signal)
            messages = normalizeHistory(history.parsed)
          } catch (error) {
            if (isCancelled(error) || aborted()) {
              cancelled = true
              break
            }
            failures.push({ title: chat.title, chatId: chat.chatId, reason: describe(error) })
            rejected = error !== null && typeof error === 'object' && error.authFailure === true
          }
          if (rejected) {
            failures.push({ title: '', chatId: '', reason: 'session rejected while reading histories' })
            break
          }
          if (aborted()) {
            cancelled = true
            break
          }
          if (messages.length === 0 && api.domFallback !== null && typeof api.domFallback === 'object' && api.domFallback.enabled !== false) {
            try {
              messages = await readDomHistory(element, chat, api.domFallback, signal)
            } catch (error) {
              if (aborted()) {
                cancelled = true
                break
              }
              failures.push({ title: chat.title, chatId: chat.chatId, reason: `DOM history: ${describe(error)}` })
            }
          }
          if (aborted()) {
            cancelled = true
            break
          }
          if (messages.length === 0) {
            failures.push({ title: chat.title, chatId: chat.chatId, reason: 'no messages were extracted' })
            continue
          }
          const last = messages[messages.length - 1]
          bags.push({
            chatId: chat.chatId,
            title: chat.title,
            sourceUrl: chat.sourceUrl,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            lastMessageId: typeof last.id === 'string' ? last.id : '',
            messages,
          })
        } catch (error) {
          if (isCancelled(error) || aborted()) {
            cancelled = true
            break
          }
          failures.push({ title: chat.title, chatId: chat.chatId, reason: describe(error) })
        }
        await sleep(PACE_MS)
      }
      return { chats: bags, failures, cancelled: cancelled || aborted() }
    }

    /**
     * Navigate the guest and wait for the document to settle.
     *
     * A user stop must interrupt the wait immediately: a per-chat DOM fallback otherwise
     * keeps the panel busy for the full 20 s navigation timeout after the user pressed Stop.
     */
    async function navigateGuest(element, url, signal) {
      if (signal !== undefined && signal.aborted) return { ok: false, reason: 'aborted', cancelled: true }
      const settled = new Promise((resolve) => {
        let timer = null
        function finish(outcome) {
          if (timer !== null) clearTimeout(timer)
          element.removeEventListener('did-stop-loading', onStop)
          element.removeEventListener('did-fail-load', onFail)
          if (signal !== undefined) signal.removeEventListener('abort', onAbort)
          resolve(outcome)
        }
        function onStop() {
          finish({ ok: true })
        }
        function onFail(event) {
          if (event !== null && typeof event === 'object' && event.isMainFrame === false) return
          finish({ ok: false, reason: 'navigation failed' })
        }
        function onAbort() {
          finish({ ok: false, reason: 'aborted', cancelled: true })
        }
        element.addEventListener('did-stop-loading', onStop)
        element.addEventListener('did-fail-load', onFail)
        if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => finish({ ok: false, reason: 'navigation timed out' }), 20000)
      })
      try {
        await element.loadURL(url)
      } catch (error) {
        return { ok: false, reason: describe(error) }
      }
      return settled
    }

    /** Last-resort extraction, used only when the API rejected every configured endpoint. */
    async function readDomChatList(element, selectors) {
      const linkSelector = typeof selectors.chatLinkSelector === 'string' && selectors.chatLinkSelector !== ''
        ? selectors.chatLinkSelector
        : 'a[href*="/a/chat/s/"]'
      const code = `(() => {
        const out = []
        const seen = new Set()
        for (const link of Array.from(document.querySelectorAll(${JSON.stringify(linkSelector)}))) {
          const href = link.getAttribute('href') || ''
          const match = href.match(/\\/a\\/chat\\/s\\/([A-Za-z0-9_-]+)/u)
          if (match === null || seen.has(match[1])) continue
          seen.add(match[1])
          out.push({ chatId: match[1], title: (link.textContent || '').trim() })
        }
        return out
      })()`
      const value = await element.executeJavaScript(code, false)
      if (!Array.isArray(value)) return []
      return value
        .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.chatId === 'string')
        .map((entry) => ({
          chatId: entry.chatId,
          title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : entry.chatId,
          sourceUrl: `${HOME_URL}/a/chat/s/${entry.chatId}`,
          createdAt: undefined,
          updatedAt: undefined,
        }))
    }

    async function readDomHistory(element, chat, selectors, signal) {
      const ready = await navigateGuest(element, chat.sourceUrl, signal)
      if (!ready.ok) throw new Error(ready.reason === undefined ? 'cannot open the chat page' : ready.reason)
      const messageSelector = typeof selectors.messageSelector === 'string' && selectors.messageSelector !== ''
        ? selectors.messageSelector
        : '[data-message-author-role], .ds-message'
      const roleAttribute = typeof selectors.roleAttribute === 'string' && selectors.roleAttribute !== ''
        ? selectors.roleAttribute
        : 'data-message-author-role'
      const code = `(() => {
        const role = (node) => {
          const raw = [node.getAttribute(${JSON.stringify(roleAttribute)}), node.getAttribute('data-role'), node.className]
            .filter((value) => typeof value === 'string')
            .join(' ')
            .toLowerCase()
          if (/user|human|request|question/u.test(raw)) return 'user'
          if (/assistant|bot|response|answer/u.test(raw)) return 'assistant'
          return ''
        }
        const out = []
        for (const node of Array.from(document.querySelectorAll(${JSON.stringify(messageSelector)}))) {
          const kind = role(node)
          const text = (node.innerText || '').trim()
          if (kind === '' || text === '') continue
          out.push({
            id: node.getAttribute('data-message-id') || '',
            role: kind,
            text,
            createdAt: undefined,
          })
        }
        return out
      })()`
      const value = await element.executeJavaScript(code, false)
      return Array.isArray(value) ? value : []
    }

    /**
     * Remove credentials and account identifiers before anything reaches the Host, the
     * diagnostics file or the panel. `GET /api/v0/users/current` literally returns the
     * account token and the e-mail in its body, so masking only "Bearer …" was not enough.
     */
    const REDACTED = '<redacted>'
    const redact = (text) => {
      if (typeof text !== 'string') return ''
      const masked = text
        .replace(
          /"(token|access_token|refresh_token|jwt|authorization|cookie|email|mobile_number|phone|picture|userToken)"\s*:\s*"[^"]*"/giu,
          (match, key) => `"${key}":"${REDACTED}"`,
        )
        .replace(/(bearer\s+)[\w.~+/=-]+/giu, `$1${REDACTED}`)
        .replace(/[A-Za-z0-9_+/=-]{32,}/gu, REDACTED)
      return masked.length > DIAGNOSTIC_TEXT_LIMIT ? `${masked.slice(0, DIAGNOSTIC_TEXT_LIMIT)}…` : masked
    }

    // ------------------------------------------------------------------ UI ---

    const css = `
.dsce-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 13px; line-height: 1.55; }
.dsce-toolbar { display: flex; align-items: center; gap: 8px; flex: none; height: 40px; padding: 0 10px; border-bottom: .5px solid var(--dsw-alias-border-l1); }
.dsce-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 500; }
.dsce-titleIcon { color: var(--dsw-alias-brand-primary); flex: none; }
.dsce-spacer { flex: auto; min-width: 0; }
.dsce-workspace { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 34%; color: var(--dsw-alias-label-secondary); }
.dsce-workspaceLabel { flex: none; }
.dsce-workspaceSelect { min-width: 0; max-width: 100%; height: 26px; padding: 0 6px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; font: inherit; }
.dsce-button { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 28px; padding: 0 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; font: inherit; cursor: pointer; }
.dsce-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsce-button:disabled { color: var(--dsw-alias-state-idle-primary); cursor: default; }
.dsce-button[data-primary=true] { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); border-color: transparent; }
.dsce-button[data-tone=danger] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.dsce-button[data-tone=danger]:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsce-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsce-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-idle-primary); }
.dsce-dot[data-tone=ok] { background: var(--dsw-alias-state-success-primary); }
.dsce-dot[data-tone=warn] { background: var(--dsw-alias-state-warn-primary); }
.dsce-dot[data-tone=error] { background: var(--dsw-alias-state-error-primary); }
.dsce-status { display: flex; align-items: center; gap: 6px; flex: none; color: var(--dsw-alias-label-secondary); }
.dsce-viewport { position: relative; display: flex; flex: auto; min-height: 0; }
.dsce-guest { display: flex; flex: auto; width: 100%; height: 100%; min-height: 0; border: 0; background: var(--dsw-alias-bg-base); }
.dsce-placeholder { display: flex; flex: auto; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; }
.dsce-placeholder h2 { margin: 0; font-size: 15px; font-weight: 500; }
.dsce-placeholder p { margin: 0; max-width: 520px; color: var(--dsw-alias-label-secondary); }
.dsce-placeholder a { color: var(--dsw-alias-brand-primary); }
.dsce-footer { display: flex; align-items: center; gap: 12px; flex: none; min-height: 26px; padding: 4px 10px; color: var(--dsw-alias-label-secondary); border-top: .5px solid var(--dsw-alias-border-l1); font-size: 12px; }
.dsce-footerText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsce-footerText[data-tone=error] { color: var(--dsw-alias-state-error-primary); }
.dsce-footerText[data-tone=warn] { color: var(--dsw-alias-state-warn-primary); }
.dsce-footerText[data-tone=ok] { color: var(--dsw-alias-state-success-primary); }
.dsce-diagnostics { flex: none; max-height: 40%; overflow: auto; margin: 0; padding: 10px 12px; border-top: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11, 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace); white-space: pre-wrap; word-break: break-word; }
`

    function PanelIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 18
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M5.6 4.5h12.8a2.6 2.6 0 0 1 2.6 2.6v7.2a2.6 2.6 0 0 1-2.6 2.6H11l-4.4 3.1a.6.6 0 0 1-.95-.49v-2.61H5.6A2.6 2.6 0 0 1 3 14.3V7.1a2.6 2.6 0 0 1 2.6-2.6Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12 7.7v5.2M9.6 10.7 12 13.1l2.4-2.4M9.4 15.4h5.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function Panel(props) {
      const { bus } = props
      const t = typeof props.t === 'function' ? props.t : localTranslate
      const tRef = React.useRef(t)
      tRef.current = t

      const useWorkspaces = props.useWorkspaces
      const workspaceSnapshot = typeof useWorkspaces === 'function' ? useWorkspaces((snapshot) => snapshot) : undefined

      const hostRef = React.useRef(null)
      const guestRef = React.useRef({ element: null, lease: null, ready: false, url: '' })
      const configRef = React.useRef(null)
      /** AbortController of the running export, or null when nothing runs. */
      const abortRef = React.useRef(null)

      const [phase, setPhase] = React.useState('boot')
      const [error, setError] = React.useState('')
      const [auth, setAuth] = React.useState('unknown')
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [stopping, setStopping] = React.useState(false)
      const [wasStopped, setWasStopped] = React.useState(false)
      const [progress, setProgress] = React.useState(null)
      const [summary, setSummary] = React.useState(null)
      const [diagnostics, setDiagnostics] = React.useState(null)
      const [workspacePath, setWorkspacePath] = React.useState('')
      const workspacePathRef = React.useRef('')
      workspacePathRef.current = workspacePath

      const workspaceItems = React.useMemo(() => {
        if (workspaceSnapshot === undefined || workspaceSnapshot === null) return []
        if (workspaceSnapshot.phase !== 'ready' || !Array.isArray(workspaceSnapshot.items)) return []
        return workspaceSnapshot.items.filter((item) => item !== null && typeof item === 'object' && typeof item.path === 'string')
      }, [workspaceSnapshot])

      React.useEffect(() => {
        if (workspaceItems.length === 0) return
        setWorkspacePath((current) => {
          if (current !== '') return current
          return workspaceItems[0].path
        })
      }, [workspaceItems])

      /** Last auth probe: reported alongside failures so the cause needs no DevTools. */
      const probeRef = React.useRef(null)

      const probeSession = React.useCallback(async () => {
        const state = guestRef.current
        const config = configRef.current
        if (state.element === null || !state.ready || config === null) return null
        const api = config.api !== null && typeof config.api === 'object' ? config.api : {}
        const base = typeof api.base === 'string' && api.base !== '' ? api.base : HOME_URL
        const request = resolveEndpoint(api.authProbe, undefined, base)
        if (request === undefined) return null
        const response = await guestRequest(state.element, request)
        const parsed = response.error === undefined && response.status !== 0 ? extractJsonText(response.text) : undefined
        const envelopeFailure = parsed === undefined ? undefined : deepseekFailure(parsed)
        const probe = {
          status: response.status,
          tokenUsed: response.tokenUsed === true,
          tokenSource: response.tokenSource,
          scheme: response.scheme,
          error: response.error,
          code: envelopeFailure === undefined ? undefined : envelopeFailure.code,
          message: envelopeFailure === undefined ? undefined : envelopeFailure.message,
          body: response.error === undefined ? redact(response.text) : undefined,
        }
        probeRef.current = probe
        if (response.error !== undefined || response.status === 0) return probe
        if (envelopeFailure !== undefined) {
          setAuth(isAuthFailure(envelopeFailure) ? 'signed-out' : 'unknown')
          return probe
        }
        setAuth(response.status >= 200 && response.status < 400 ? 'signed-in' : 'signed-out')
        return probe
      }, [])

      const probeAuth = probeSession

      const report = React.useCallback((kind, payload) => {
        rpc('report', {
          kind,
          workspacePath: workspacePathRef.current === '' ? undefined : workspacePathRef.current,
          payload,
        }).catch(() => {
          // Reporting is best effort: a failed report must never mask the real failure.
        })
      }, [])

      const guestReady = React.useCallback(() => {
        const state = guestRef.current
        return state.element !== null && state.ready
      }, [])

      /** Cancels the running export; collected chats are still written by the run itself. */
      const stopExport = React.useCallback(() => {
        const controller = abortRef.current
        if (controller === null || controller.signal.aborted) return
        setStopping(true)
        setProgress({ kind: 'stop', text: tRef.current('progress.stopping') })
        controller.abort()
      }, [])

      const runExport = React.useCallback(async () => {
        const state = guestRef.current
        const config = configRef.current
        if (config === null) {
          const message = tRef.current('error.host')
          setError(message)
          return { ok: false, summary: message }
        }
        if (!guestReady()) {
          const message = tRef.current('error.noGuest')
          setError(message)
          report('export-blocked', { reason: message, phase: 'no-guest', url: guestRef.current.url })
          return { ok: false, summary: message }
        }
        if (abortRef.current !== null) return { ok: false, summary: tRef.current('panel.exporting') }
        const api = config.api !== null && typeof config.api === 'object' ? config.api : {}
        // One controller per run: the Stop button flips it, and every collection step
        // checks it before doing more work.
        const controller = new AbortController()
        abortRef.current = controller
        setStopping(false)
        setWasStopped(false)
        setBusy(true)
        setError('')
        setSummary(null)
        setProgress({ kind: 'list', text: tRef.current('status.loading') })
        let failures = []
        let found = 0
        try {
          // A cheap probe first: when the session is unusable, it explains why in one call
          // instead of turning every endpoint attempt into a separate mystery.
          await probeSession().catch(() => null)
          const collected = await collectChats(
            state.element,
            api,
            {
              onList: (count) => {
                if (controller.signal.aborted) return
                setProgress({ kind: 'list', text: tRef.current('progress.found', { count }) })
              },
              onChat: (index, total, title) => {
                if (controller.signal.aborted) return
                setProgress({ kind: 'chat', text: tRef.current('progress.chat', { index, total, title: title === '' ? '—' : title }) })
              },
            },
            { maxChats: Number(config.limits && config.limits.maxChats) || 0, signal: controller.signal },
          )
          failures = collected.failures
          found = collected.chats.length
          const stopped = collected.cancelled === true
          if (found === 0 && stopped) {
            // Nothing was read yet: report the stop instead of an export error.
            const text = tRef.current('summary.stopped')
            setWasStopped(true)
            setSummary(text)
            setProgress(null)
            report('export-stopped', { found: 0, stopped: true })
            return { ok: true, summary: text }
          }
          if (found === 0) {
            const reasons = failures.map((failure) => failure.reason)
            const authFailure = reasons.some((reason) => /code 4000[1-5]|missing token|invalid_token|unauthor/i.test(reason))
            const message = authFailure
              ? tRef.current('error.auth', { message: reasons[0] === undefined ? '' : reasons[0] })
              : `${tRef.current('error.export')}: ${(reasons.length > 0 ? reasons.slice(0, 3).join('; ') : 'no chats were found')}`
            const inventory = await guestStorageProbe(state.element).catch(() => null)
            report('export-empty', { probe: probeRef.current, failures, auth: authFailure, inventory })
            throw new Error(message)
          }
          setProgress({ kind: 'write', text: tRef.current('progress.write', { total: found }) })
          const result = await rpc('export', {
            chats: collected.chats,
            workspacePath: workspacePathRef.current === '' ? undefined : workspacePathRef.current,
          })
          const details = failures.map((failure) => `${failure.title === '' ? failure.chatId : failure.title}: ${failure.reason}`)
          const text = formatSummary(result, details, stopped)
          setWasStopped(stopped === true)
          setSummary(text)
          setProgress(null)
          report(stopped ? 'export-stopped' : 'export-ok', {
            found,
            exported: result.exported,
            skipped: result.skipped,
            failed: result.failed,
            stopped,
            failures: details.slice(0, 10),
          })
          return { ok: true, summary: text }
        } catch (failure) {
          if (isCancelled(failure)) {
            const text = tRef.current('summary.stopped')
            setWasStopped(true)
            setSummary(text)
            setError('')
            setProgress(null)
            report('export-stopped', { found, stopped: true })
            return { ok: true, summary: text }
          }
          const message = describe(failure)
          const full = message.startsWith(tRef.current('error.export')) || message.startsWith(tRef.current('error.auth'))
            ? message
            : `${tRef.current('error.export')}: ${message}`
          setError(full)
          setSummary(null)
          setProgress(null)
          if (found > 0) report('export-failed', { message: full, probe: probeRef.current, failures: failures.slice(0, 10) })
          return { ok: false, summary: full }
        } finally {
          if (abortRef.current === controller) abortRef.current = null
          setBusy(false)
          setStopping(false)
        }
      }, [guestReady, probeSession, report])
      const runExportRef = React.useRef(runExport)
      runExportRef.current = runExport

      const formatSummary = (result, failures, stopped) => {
        const tNow = tRef.current
        const base = tNow('summary.ok', {
          found: result.found,
          exported: result.exported,
          skipped: result.skipped,
          failed: result.failed,
          dir: result.researchDir,
        })
        const written = Array.isArray(result.results)
          ? result.results.filter((entry) => entry.status === 'exported').map((entry) => entry.file).slice(0, SUMMARY_FILE_LIMIT)
          : []
        const lines = stopped === true ? [tNow('summary.stopped'), base] : [base]
        if (written.length > 0) lines.push(tNow('summary.files', { files: written.join(', ') }))
        const all = failures.concat(Array.isArray(result.errors) ? result.errors : [])
        if (all.length > 0) lines.push(tNow('summary.failures', { failures: all.slice(0, 4).join('; ') }))
        return lines.join('\n')
      }

      const runDiagnostics = React.useCallback(async () => {
        const lines = []
        const carrier = globalThis.dshDesktop
        lines.push(`desktop bridge: ${isDesktopCarrier() === undefined ? 'missing' : 'ok'} (dshDesktop=${carrier === undefined ? 'undefined' : 'defined'})`)
        const state = guestRef.current
        lines.push(`guest: phase=${phase} ready=${state.ready} url=${state.url === '' ? '(none)' : state.url}`)
        try {
          const hello = await rpc('hello')
          configRef.current = hello
          const historySummary = { explained: null, endpoint: '' }
          lines.push(`host: ok version=${hello.version} workspaceRoot=${hello.workspaceRoot} outputDir=${hello.outputDir}`)
          lines.push(`api.base: ${hello.api && hello.api.base ? hello.api.base : '(none)'}`)
          const api = hello.api !== null && typeof hello.api === 'object' ? hello.api : {}
          const base = typeof api.base === 'string' && api.base !== '' ? api.base : HOME_URL
          const probe = resolveEndpoint(api.authProbe, undefined, base)
          if (probe === undefined || state.element === null || !state.ready) {
            lines.push('auth probe: skipped (no guest or no endpoint)')
          } else {
            const response = await guestRequest(state.element, probe)
            lines.push(
              `auth probe ${probe.label}: status=${response.status} tokenUsed=${response.tokenUsed === true}`
              + ` token=${response.tokenSource === undefined ? '?' : response.tokenSource}/${response.scheme === undefined ? '?' : response.scheme}`
              + ` body=${redact(response.text)}`,
            )
          }
          if (state.element !== null && state.ready) {
            let firstChatId = ''
            for (const endpoint of Array.isArray(api.listEndpoints) ? api.listEndpoints : []) {
              const request = resolveEndpoint(endpoint, undefined, base)
              if (request === undefined) continue
              const response = await guestRequest(state.element, request)
              const parsed = extractJsonText(response.text)
              const envelopeFailure = parsed === undefined ? undefined : deepseekFailure(parsed)
              const chats = parsed === undefined ? [] : normalizeChatList(parsed)
              if (firstChatId === '' && chats.length > 0) firstChatId = chats[0].chatId
              lines.push(
                `list ${request.label}: status=${response.status} tokenUsed=${response.tokenUsed === true}`
                + ` token=${response.tokenSource === undefined ? '?' : response.tokenSource}/${response.scheme === undefined ? '?' : response.scheme}`
                + ` chats=${chats.length}`
                + `${envelopeFailure === undefined ? '' : ` envelope=${envelopeFailure.code} ${envelopeFailure.message}`}`
                + ` body=${redact(response.text).slice(0, 160)}`,
              )
            }
            // One real history, reduced to counts: the fastest way to see why an assistant
            // reply is missing (all records dropped as reasoning? no role? empty text?).
            if (firstChatId !== '') {
              try {
                const history = await requestWithCandidates(state.element, api, api.historyEndpoints, firstChatId, undefined)
                const explained = explainHistory(history.parsed)
                const historyLine =
                  `history ${history.request.label}: records=${explained.records} kept=${explained.kept}`
                  + ` users=${explained.users} assistants=${explained.assistants} sources=${explained.sources}`
                  + ` droppedReasoning=${explained.dropped.reasoning} droppedRole=${explained.dropped.role}`
                  + ` droppedEmpty=${explained.dropped.empty}`
                  + ` fragments=${JSON.stringify(explained.fragmentTypes)}`
                lines.push(historyLine)
                historySummary.explained = explained
                historySummary.endpoint = history.request.label
              } catch (failure) {
                lines.push(`history: ${describe(failure)}`)
              }
            }
          }
          const inventory = await guestStorageProbe(state.element).catch(() => null)
          if (inventory !== null) {
            lines.push(
              `storage: href=${redact(inventory.href)} title=${JSON.stringify(inventory.title)} readyState=${inventory.readyState}`
              + ` candidates=${inventory.tokenCandidates} accepted=${JSON.stringify(inventory.acceptedSource)}`
              + ` interceptor=${inventory.interceptor === true} liveAuth=${JSON.stringify(inventory.liveAuthName)}`
              + ` chatLinks=${inventory.chatLinks} loginFields=${inventory.loginFields}`,
            )
            lines.push(`storage.localStorage: ${JSON.stringify(inventory.localStorage)}`)
            lines.push(`storage.sessionStorage: ${JSON.stringify(inventory.sessionStorage)}`)
            lines.push(`storage.cookies: ${JSON.stringify(inventory.cookies)}`)
            lines.push(`storage.indexedDB: ${JSON.stringify(inventory.databases)}`)
          }
          report('diagnostics', { probe: probeRef.current, inventory, history: historySummary, phase })
        } catch (failure) {
          lines.push(`host: ${describe(failure)}`)
        }
        setDiagnostics(lines.join('\n'))
      }, [phase, report])

      // Guest lifecycle: one lease per panel mount. Releasing a lease keeps the
      // process-lifetime partition, so reopening the panel keeps the signed-in session.
      React.useEffect(() => {
        const bridge = isDesktopCarrier()
        if (bridge === undefined) {
          setPhase('no-desktop')
          setLoading(false)
          return undefined
        }
        const abort = new AbortController()
        let released = false
        const releaseLease = (lease) => {
          if (lease === null || released) return
          released = true
          Promise.resolve(bridge.release(lease)).catch(() => {
            /* the window may already be gone; nothing actionable */
          })
        }
        setPhase('connecting')
        const boot = async () => {
          let reservation
          try {
            reservation = await bridge.acquire(WORKSPACE_KEY)
          } catch (failure) {
            if (!abort.signal.aborted) {
              setPhase('failed')
              setError(describe(failure))
              setLoading(false)
            }
            return
          }
          if (abort.signal.aborted) {
            releaseLease(reservation.lease)
            return
          }
          const host = hostRef.current
          if (host === null) {
            releaseLease(reservation.lease)
            return
          }
          const element = document.createElement('webview')
          element.dataset.sidebarBrowserFrame = 'webview'
          element.className = 'dsce-guest'
          element.setAttribute('name', reservation.lease)
          element.setAttribute('partition', reservation.partition)
          element.setAttribute('src', `about:blank#${reservation.lease}`)
          guestRef.current = { element, lease: reservation.lease, ready: false, url: '' }
          let navigated = false
          let reportedReady = false
          const openHome = () => {
            guestRef.current.ready = true
            setPhase('ready')
            if (navigated) return
            navigated = true
            element.loadURL(HOME_URL).catch((failure) => {
              if (!abort.signal.aborted) setError(describe(failure))
            })
          }
          element.addEventListener('dom-ready', openHome, { signal: abort.signal })
          element.addEventListener(
            'did-navigate',
            (event) => {
              const url = event !== null && typeof event === 'object' && typeof event.url === 'string' ? event.url : element.getURL()
              guestRef.current.url = url
              // Report readiness only once the real site navigated: the first `dom-ready`
              // belongs to `about:blank#<lease>` and says nothing about the guest.
              if (!reportedReady && typeof url === 'string' && url.startsWith(HOME_URL)) {
                reportedReady = true
                report('panel-ready', { url, desktop: true })
                // The document is now the real site: watch its own API traffic for the credential.
                installInterceptor(element).catch(() => {})
              }
              probeAuth().catch(() => {})
            },
            { signal: abort.signal },
          )
          element.addEventListener(
            'did-navigate-in-page',
            () => {
              guestRef.current.url = element.getURL()
              probeAuth().catch(() => {})
            },
            { signal: abort.signal },
          )
          element.addEventListener('did-start-loading', () => setLoading(true), { signal: abort.signal })
          element.addEventListener(
            'did-stop-loading',
            () => {
              setLoading(false)
              const current = guestRef.current.url
              if (typeof current === 'string' && current.startsWith(HOME_URL)) installInterceptor(element).catch(() => {})
              probeAuth().catch(() => {})
            },
            { signal: abort.signal },
          )
          element.addEventListener(
            'did-fail-load',
            (event) => {
              const failure = event !== null && typeof event === 'object' ? event : {}
              if (failure.isMainFrame === false || failure.errorCode === -3) return
              setLoading(false)
              const message = `${failure.errorDescription === undefined ? 'load failed' : failure.errorDescription} (${failure.errorCode})`
              setError(message)
              report('panel-load-failed', { message, url: guestRef.current.url })
            },
            { signal: abort.signal },
          )
          for (const name of ['render-process-gone', 'destroyed']) {
            element.addEventListener(
              name,
              () => {
                if (abort.signal.aborted) return
                setPhase('failed')
                setError(tRef.current('error.guestGone'))
                setLoading(false)
              },
              { signal: abort.signal },
            )
          }
          host.append(element)
          setTimeout(() => {
            if (abort.signal.aborted) return
            if (!guestRef.current.ready) {
              setLoading(false)
              setPhase('failed')
              setError(tRef.current('error.noGuest'))
            }
          }, GUEST_READY_TIMEOUT_MS)
        }
        boot().catch((failure) => {
          if (abort.signal.aborted) return
          setPhase('failed')
          setError(describe(failure))
          setLoading(false)
        })
        return () => {
          abort.abort()
          // Leaving the panel mid-export must not orphan the collection loop: the guest is
          // about to disappear, so cancel the run before releasing its lease.
          if (abortRef.current !== null) abortRef.current.abort()
          releaseLease(guestRef.current.lease)
          if (guestRef.current.element !== null) guestRef.current.element.remove()
          guestRef.current = { element: null, lease: null, ready: false, url: '' }
        }
      }, [probeAuth])

      // Host contract (endpoint table, workspace root) — fetched once per panel mount.
      React.useEffect(() => {
        let cancelled = false
        rpc('hello')
          .then((hello) => {
            if (cancelled) return
            configRef.current = hello
            setPhase((current) => (current === 'boot' ? 'connecting' : current))
          })
          .catch((failure) => {
            if (!cancelled) setError(describe(failure))
          })
        return () => {
          cancelled = true
        }
      }, [])

      // `/export-chats` hand-off: the Host queues a job, the poller in apply() hands it
      // to whichever panel instance is mounted with a live guest.
      React.useEffect(() => {
        if (bus === undefined || bus === null) return undefined
        return bus.attach(async () => runExportRef.current())
      }, [bus])

      // Self-diagnosis: the Host writes these entries to
      // `<workspace>/.dsh-chat-exporter-diagnostics.json`, so a panel that never reaches
      // its export still leaves a trace (broken guest, missing bridge, refused attach).
      const errorRef = React.useRef(error)
      errorRef.current = error
      React.useEffect(() => {
        if (phase === 'no-desktop') report('panel-no-desktop', { desktop: false })
        else if (phase === 'failed') report('panel-failed', { error: errorRef.current, url: guestRef.current.url })
      }, [phase, report])

      const statusTone = auth === 'signed-in' ? 'ok' : auth === 'signed-out' ? 'warn' : 'idle'
      const statusText =
        phase === 'no-desktop'
          ? t('needDesktop.title')
          : auth === 'signed-in'
            ? t('status.ready')
            : auth === 'signed-out'
              ? t('status.signedOut')
              : loading
                ? t('status.loading')
                : t('status.unknown')

      const footerText = progress !== null ? progress.text : error !== '' ? error : summary !== null ? summary : ''
      const footerTone =
        progress !== null ? 'idle' : error !== '' ? 'error' : wasStopped ? 'warn' : summary !== null ? 'ok' : 'idle'

      const toolbar = h(
        'div',
        { className: 'dsce-toolbar' },
        h(
          'span',
          { className: 'dsce-title' },
          h('span', { className: 'dsce-titleIcon' }, h(PanelIcon, { size: 16 })),
          t('panel.title'),
        ),
        h('span', { className: 'dsce-spacer' }),
        workspaceItems.length > 0
          ? h(
              'span',
              { className: 'dsce-workspace' },
              h('span', { className: 'dsce-workspaceLabel' }, t('panel.workspace')),
              workspaceItems.length === 1
                ? h('span', { title: workspaceItems[0].path }, shortenPath(workspaceItems[0].path))
                : h(
                    'select',
                    {
                      className: 'dsce-workspaceSelect',
                      value: workspacePath,
                      onChange: (event) => setWorkspacePath(event.target.value),
                      'aria-label': t('panel.workspace'),
                    },
                    workspaceItems.map((item) => h('option', { key: item.path, value: item.path }, shortenPath(item.path))),
                  ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsce-button',
            disabled: busy || phase !== 'ready',
            onClick: () => {
              runExportRef.current().catch((failure) => setError(describe(failure)))
            },
          },
          busy ? t('panel.exporting') : t('panel.export'),
        ),
        // Testing/one-off escape hatch: stop reading further chats. Everything already
        // collected is still written by the running export.
        busy
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsce-button',
                'data-tone': 'danger',
                disabled: stopping,
                title: t('panel.stop'),
                onClick: stopExport,
              },
              stopping ? t('panel.stopping') : t('panel.stop'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsce-button',
            disabled: guestRef.current.element === null,
            onClick: () => {
              const element = guestRef.current.element
              if (element === null) return
              setSummary(null)
              setError('')
              element.loadURL(HOME_URL).catch((failure) => setError(describe(failure)))
            },
          },
          t('panel.reload'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsce-button',
            onClick: () => {
              if (diagnostics !== null) {
                setDiagnostics(null)
                return
              }
              runDiagnostics().catch((failure) => setError(describe(failure)))
            },
          },
          diagnostics === null ? t('panel.diagnostics') : t('panel.hideDiagnostics'),
        ),
      )

      const body =
        phase === 'no-desktop'
          ? h(
              'div',
              { className: 'dsce-placeholder' },
              h('h2', null, t('needDesktop.title')),
              h('p', null, t('needDesktop.body')),
              h('a', { href: HOME_URL, target: '_blank', rel: 'noreferrer noopener' }, HOME_URL),
            )
          : h('div', { className: 'dsce-viewport', ref: hostRef })

      return h(
        'div',
        { className: 'dsce-root' },
        h('style', null, css),
        toolbar,
        body,
        diagnostics !== null ? h('pre', { className: 'dsce-diagnostics' }, diagnostics) : null,
        h(
          'div',
          { className: 'dsce-footer' },
          h('span', { className: 'dsce-dot', 'data-tone': statusTone, 'aria-hidden': true }),
          h('span', { className: 'dsce-status' }, statusText),
          footerText !== '' ? h('span', { className: 'dsce-footerText', 'data-tone': footerTone, title: footerText }, footerText) : null,
        ),
      )
    }

    const shortenPath = (value) => {
      if (typeof value !== 'string' || value.length <= 40) return value
      const separator = value.includes('\\') ? '\\' : '/'
      const parts = value.split(separator)
      return parts.length <= 2 ? value : `…${separator}${parts.slice(-2).join(separator)}`
    }

    // --------------------------------------------------------------- plugin ---

    const inject = ['slots', 'locale']

    /** Rendezvous between the module-scope poller and whichever panel instance is mounted. */
    function createCommandBus() {
      let runner = null
      return {
        get ready() {
          return runner !== null
        },
        attach(next) {
          runner = next
          return () => {
            if (runner === next) runner = null
          }
        },
        run(jobId) {
          return runner === null ? Promise.resolve({ ok: false, summary: 'panel is not mounted' }) : runner(jobId)
        },
      }
    }

    function startPoller(ctx, bus) {
      const clientId = `dsc-${Math.random().toString(36).slice(2, 10)}`
      return ctx.effect(() => {
        let stopped = false
        let timer = null
        const schedule = (delay) => {
          if (stopped) return
          timer = setTimeout(tick, delay)
        }
        const tick = async () => {
          if (stopped) return
          try {
            const value = await rpc('poll', { clientId, ready: bus.ready })
            const job = value !== null && typeof value === 'object' ? value.job : null
            if (job !== null && job !== undefined) {
              let outcome
              try {
                outcome = await bus.run(job.id)
              } catch (failure) {
                outcome = { ok: false, summary: describe(failure) }
              }
              await rpc('jobResult', {
                jobId: job.id,
                ok: outcome.ok !== false,
                summary: outcome.summary,
                error: outcome.ok === false ? outcome.summary : undefined,
              })
            }
            schedule(bus.ready ? POLL_INTERVAL_MS : POLL_IDLE_MS)
          } catch {
            // The Host route appears only after its fiber activates, and a transient
            // failure must not kill the channel: back off and retry.
            schedule(POLL_IDLE_MS)
          }
        }
        schedule(600)
        return () => {
          stopped = true
          if (timer !== null) clearTimeout(timer)
          timer = null
        }
      }, 'deepseek-chat-exporter:command-poller')
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const disposers = []
        try {
          disposers.push(ctx.locale.register(NS, { en, zh }))
        } catch (failure) {
          console.error('deepseek-chat-exporter: locale registration failed', failure)
        }
        try {
          disposers.push(ctx.locale.register(NS, 'ru', ru))
        } catch (failure) {
          console.error('deepseek-chat-exporter: ru locale registration failed', failure)
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              /* already gone */
            }
          }
        }
      }, 'deepseek-chat-exporter:copy')

      const bus = createCommandBus()
      startPoller(ctx, bus)

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ bus }) },
          Panel,
        ),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel.title') },
          PanelIcon,
        ),
      )
    }

    // Test seam: `test/endpoint-ladder.test.mjs` drives the endpoint fallback directly, because
    // the behaviour it guards (one refused endpoint must not abort the whole request) cannot be
    // reached through the UI without a live chat.deepseek.com. The loader reads only apply/inject.
    return { inject, apply, __test: { requestWithCandidates } }
  },
})
