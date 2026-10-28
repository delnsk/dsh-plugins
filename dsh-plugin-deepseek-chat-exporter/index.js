/**
 * Host half of @local/dsh-deepseek-chat-exporter.
 *
 * Carries the JSON rendezvous the client panel talks to (`/dsh-chat-exporter/rpc`),
 * owns the export cache and Markdown files, and exposes the `/export-chats` command.
 * It never touches cookies, tokens or the network: those belong to the webview guest.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { readCache, runExport, writeCache } from './lib/export.js'

export const name = 'deepseek-chat-exporter'

// Mirrors package.json; a separate JSON import would only add loader-compatibility risk.
const VERSION = '1.0.0'

const ROUTE_PATH = '/dsh-chat-exporter'
const RPC_PATH = '/dsh-chat-exporter/rpc'
const MAX_BODY_BYTES = 24 * 1024 * 1024
const NO_CLIENT_MS = 8000
const SUMMARY_MAX_CHARS = 4000
/** How many client reports the diagnostics file keeps. */
const REPORT_LIMIT = 30
/** Longest diagnostic string kept inside one report entry. */
const REPORT_TEXT_MAX_CHARS = 2000
const ERROR_MAX_CHARS = 300

// CONTRACT §5 defaults. The row config is merged over this table; unknown keys and
// wrongly typed values are ignored, so a stale cordis.patch.yml cannot break the Host.
const API_DEFAULTS = Object.freeze({
  base: 'https://chat.deepseek.com',
  authProbe: Object.freeze({ method: 'GET', path: '/api/v0/users/current' }),
  // GET first: measured on 2026-10-28, `GET …/fetch_page?count=100` answers 200 with the full
  // list while `POST …/fetch_page` answers `{"code":40003,"msg":"INVALID_TOKEN"}` for the very
  // same credential. The POST variant stays as a fallback in case DeepSeek swaps them back.
  listEndpoints: Object.freeze([
    Object.freeze({ method: 'GET', path: '/api/v0/chat_session/fetch_page?count=100' }),
    Object.freeze({ method: 'POST', path: '/api/v0/chat_session/fetch_page?count=100', body: '{}' }),
  ]),
  historyEndpoints: Object.freeze([
    Object.freeze({ method: 'GET', path: '/api/v0/chat/history_messages?chat_session_id={chatId}' }),
    Object.freeze({ method: 'POST', path: '/api/v0/chat/history_messages', body: '{"chat_session_id":"{chatId}"}' }),
  ]),
  domFallback: Object.freeze({
    enabled: true,
    messageSelector: '[data-message-author-role], .ds-message',
    roleAttribute: 'data-message-author-role',
  }),
})

const DEFAULTS = Object.freeze({
  outputDir: 'research',
  cacheFileName: '.dsh-chat-exporter-cache.json',
  workspaceRoot: '',
  labelUser: 'Пользователь',
  labelAssistant: 'Ассистент',
  fileNameMaxTitle: 60,
  commandWaitMs: 180000,
  maxChats: 500,
  api: API_DEFAULTS,
})

/**
 * Register the HTTP route and the `/export-chats` command.
 *
 * Both services are optional: `ctx.inject` keeps the plugin completely inert when the
 * Web carrier or the command registry is not composed into this profile.
 *
 * @param {object} ctx Cordis context of this plugin entry
 * @param {unknown} config row `config` from cordis.patch.yml
 * @returns {unknown} disposer of the injected scope, when the runtime returns one
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config)
  const logger = createLogger(ctx)

  return ctx.inject(['webServer', 'commands'], (scope) => {
    const bus = createJobBus({ commandWaitMs: settings.commandWaitMs, logger })

    // Pending commands reject instead of hanging when the plugin unloads.
    scope.effect(() => () => bus.dispose())

    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: ROUTE_PATH,
      handler: createHandler({ ctx, settings, bus, logger }),
    }))

    scope.effect(() => scope.commands.register({
      name: 'export-chats',
      description: 'Экспортирует диалоги DeepSeek в Markdown-файлы в папку research рабочего пространства',
      handler: (invocation) => runExportChatsCommand({ bus, invocation }),
    }))
  })
}

/* ------------------------------------------------------------ HTTP handler ---- */

function createHandler({ ctx, settings, bus, logger }) {
  return async function handler(req, res) {
    try {
      const url = new URL(typeof req?.url === 'string' ? req.url : '/', 'http://localhost')
      if (url.pathname !== RPC_PATH) {
        sendJson(res, 404, rpcFailure('E_ROUTE', `unknown route: ${url.pathname}`))
        return
      }
      if ((req.method || '').toUpperCase() !== 'POST') {
        setHeader(res, 'allow', 'POST')
        sendJson(res, 405, rpcFailure('E_HTTP_METHOD', 'only POST is supported'))
        return
      }

      let body
      try {
        body = await readBody(req, MAX_BODY_BYTES)
      } catch (error) {
        sendJson(res, 413, rpcFailure(error?.code || 'E_BODY', error))
        return
      }

      let rpc
      try {
        rpc = JSON.parse(body)
      } catch {
        sendJson(res, 400, rpcFailure('E_BAD_JSON', 'request body is not valid JSON'))
        return
      }
      if (!isRecord(rpc) || typeof rpc.method !== 'string') {
        sendJson(res, 400, rpcFailure('E_BAD_REQUEST', 'method must be a string'))
        return
      }

      try {
        const value = await dispatch({ ctx, settings, bus, logger, method: rpc.method, params: rpc.params })
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        const code = isErrorCode(error?.code) ? error.code : 'E_INTERNAL'
        logger.warn(`rpc ${rpc.method} failed: ${code}`)
        sendJson(res, 200, { ok: false, error: { code, message: sanitizeError(error) } })
      }
    } catch (error) {
      // A route handler must never reject: the HTTP carrier has no error channel.
      logger.error(`request failed: ${sanitizeError(error)}`)
      try {
        sendJson(res, 500, rpcFailure('E_INTERNAL', error))
      } catch {
        // Response already gone; nothing left to report to.
      }
    }
  }
}

async function dispatch({ ctx, settings, bus, logger, method, params }) {
  const input = isRecord(params) ? params : {}
  switch (method) {
    case 'hello':
      return buildHello(ctx, settings)
    case 'export':
      return handleExport(ctx, settings, logger, input)
    case 'poll':
      return { job: bus.poll({ clientId: input.clientId, ready: input.ready === true }) }
    case 'jobResult':
      return {
        accepted: bus.settle({
          jobId: input.jobId,
          ok: input.ok === true,
          summary: input.summary,
          error: input.error,
        }),
      }
    case 'status':
      return handleStatus(ctx, settings, bus)
    case 'clearCache':
      return handleClearCache(ctx, settings)
    case 'report':
      return handleReport(ctx, settings, logger, input)
    default:
      throw codedError('E_METHOD', `unknown method: ${truncate(method, 64)}`)
  }
}

async function buildHello(ctx, settings) {
  const workspaceRoot = await resolveWorkspaceRoot(ctx, settings)
  return {
    plugin: name,
    version: VERSION,
    workspaceRoot,
    outputDir: settings.outputDir,
    cachePath: path.join(workspaceRoot, settings.cacheFileName),
    api: settings.api,
    limits: {
      commandWaitMs: settings.commandWaitMs,
      maxChats: settings.maxChats,
      fileNameMaxTitle: settings.fileNameMaxTitle,
    },
  }
}

async function handleExport(ctx, settings, logger, params) {
  const chats = Array.isArray(params.chats) ? params.chats : []
  if (chats.length > settings.maxChats) {
    logger.warn(`request carries ${chats.length} chats, capping at ${settings.maxChats}`)
  }
  const workspaceRoot = await resolveWorkspaceRoot(ctx, settings, params.workspacePath)
  return runExport({
    chats: chats.slice(0, settings.maxChats),
    workspaceRoot,
    outputDir: settings.outputDir,
    cacheFileName: settings.cacheFileName,
    labels: { labelUser: settings.labelUser, labelAssistant: settings.labelAssistant },
    fileNameMaxTitle: settings.fileNameMaxTitle,
    logger,
  })
}

async function handleStatus(ctx, settings, bus) {
  const workspaceRoot = await resolveWorkspaceRoot(ctx, settings)
  const cachePath = path.join(workspaceRoot, settings.cacheFileName)
  const cache = await readCache(cachePath)
  return {
    cachePath,
    researchDir: path.join(workspaceRoot, settings.outputDir),
    workspaceRoot,
    entries: Object.keys(cache.chats).length,
    lastExportAt: cache.updatedAt || null,
    // Panel liveness: the browser half polls `poll` continuously, so a zero counter means
    // the client artifact never ran or its request never reached this route.
    client: bus === undefined ? undefined : bus.stats(),
  }
}

/**
 * Persist a client-side report in the workspace so a failure can be diagnosed without
 * opening DevTools. It holds counts, endpoint labels and sanitized messages only.
 */
async function handleReport(ctx, settings, logger, params) {
  const hint = typeof params.workspacePath === 'string' ? params.workspacePath : undefined
  const workspaceRoot = await resolveWorkspaceRoot(ctx, settings, hint)
  const target = path.join(workspaceRoot, '.dsh-chat-exporter-diagnostics.json')
  const entry = {
    at: new Date().toISOString(),
    kind: truncate(typeof params.kind === 'string' ? params.kind : 'unknown', 64),
    payload: sanitizeReport(params.payload),
  }
  let document = { updatedAt: entry.at, entries: [] }
  try {
    const existing = JSON.parse(await fsp.readFile(target, 'utf8'))
    if (isRecord(existing) && Array.isArray(existing.entries)) {
      document = { updatedAt: entry.at, entries: existing.entries.slice(-(REPORT_LIMIT - 1)) }
    }
  } catch {
    // Absent or corrupt: start a fresh document rather than failing the report.
  }
  document.entries.push(entry)
  await fsp.writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  logger.info(`client report ${entry.kind} stored`)
  return { stored: true, path: target, entries: document.entries.length }
}

/**
 * Sanitize a diagnostic string while keeping it readable.
 *
 * `sanitizeError` blanks the bare words "token"/"cookie" too, which turns DeepSeek's own
 * "Missing Token" into "Missing [redacted]" and destroys the one clue a report exists for.
 * Here only the values are removed: bearer credentials, `cookie=`/`token=` assignments and
 * long opaque strings.
 */
function sanitizeDiagnostic(value) {
  const text = value instanceof Error ? value.message : String(value ?? '')
  return truncate(
    text
      .replace(/(bearer\s+)[\w.~+/=-]+/gi, '$1[redacted]')
      .replace(/((?:cookie|authorization|token|set-cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
      .replace(/[\w.~+/=-]{120,}/g, '[redacted]'),
    REPORT_TEXT_MAX_CHARS,
  )
}

/** Recursively bound a client payload: no secrets, no unbounded strings. */
function sanitizeReport(value, depth = 0) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return sanitizeDiagnostic(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 4) return '[depth]'
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeReport(item, depth + 1))
  if (isRecord(value)) {
    const out = {}
    let keys = 0
    for (const [key, item] of Object.entries(value)) {
      if (keys >= 40) break
      out[truncate(key, 64)] = sanitizeReport(item, depth + 1)
      keys += 1
    }
    return out
  }
  return String(value)
}

async function handleClearCache(ctx, settings) {
  const workspaceRoot = await resolveWorkspaceRoot(ctx, settings)
  const cachePath = path.join(workspaceRoot, settings.cacheFileName)
  const cache = await readCache(cachePath)
  const removed = Object.keys(cache.chats).length
  // Files stay on disk on purpose: the next export rewrites them from the client data.
  await writeCache(cachePath, { chats: {} })
  return { removed }
}

/**
 * Resolve the workspace root for one request (CONTRACT §2).
 *
 * Precedence: the client's `workspacePath` hint, then the configured override, each
 * only when it is an existing absolute directory; then the durable workspace registry
 * (the first registered workspace, which is the profile's default workspace); then the
 * Host's current default directory; then the process working directory.
 *
 * The profile directory itself is never a workspace: the Desktop Host process runs with
 * the profile as its working directory, so `defaultDirectory` alone would put
 * `research/` inside `~/.dsh/profiles/desktop`. Re-resolved per request so a changed
 * working directory is honoured without restarting the Host.
 */
async function resolveWorkspaceRoot(ctx, settings, hint) {
  for (const candidate of [hint, settings.workspaceRoot]) {
    if (isUsableRoot(candidate) && (await isDirectory(candidate))) return candidate
  }
  for (const candidate of await registryRoots(ctx)) {
    if (isUsableRoot(candidate)) return candidate
  }
  const workingDirectory = readWorkingDirectory(ctx)
  if (isUsableRoot(workingDirectory) && (await isDirectory(workingDirectory))) return workingDirectory
  return process.cwd()
}

/** A workspace candidate must be an absolute path outside the DSH home profile tree. */
function isUsableRoot(candidate) {
  if (typeof candidate !== 'string' || candidate === '' || !path.isAbsolute(candidate)) return false
  const profilesRoot = profileRoots()
  const normalized = path.resolve(candidate).toLowerCase()
  return profilesRoot.every((root) => !normalized.startsWith(root))
}

function profileRoots() {
  const home = process.env.DSH_HOME || ''
  const roots = []
  if (home) roots.push(`${path.resolve(home, 'profiles').toLowerCase()}${path.sep}`)
  const profileDirectory = process.env.DSH_PROFILE_DIR || ''
  if (profileDirectory) roots.push(`${path.resolve(profileDirectory).toLowerCase()}${path.sep}`)
  return roots
}

/** Registered workspace paths in registry order, skipping anything unreadable. */
async function registryRoots(ctx) {
  try {
    const service = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    if (service === undefined || service === null || typeof service.list !== 'function') return []
    const workspaces = service.list()
    if (!Array.isArray(workspaces)) return []
    const paths = []
    for (const workspace of workspaces) {
      const candidate = workspace?.path
      if (typeof candidate !== 'string' || candidate === '') continue
      if (await isDirectory(candidate)) paths.push(candidate)
    }
    return paths
  } catch {
    return []
  }
}

function readWorkingDirectory(ctx) {
  try {
    const service = ctx && typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
    if (service === undefined || service === null) return ''
    const directory = service.defaultDirectory
    return typeof directory === 'string' && path.isAbsolute(directory) ? directory : ''
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------ command job bus ---- */

/**
 * Rendezvous between `/export-chats` and a polling panel (CONTRACT §2).
 *
 * A queued job is handed to exactly one client that polls with `ready:true`. If nobody
 * polls within NO_CLIENT_MS the command fails early with an actionable instruction; a
 * claimant that never reports back is expired after `commandWaitMs` so no promise and
 * no timer outlive the panel.
 */
function createJobBus({ commandWaitMs, logger }) {
  const jobs = new Map()
  const queue = []
  let lastPollAt = 0
  let lastPollReady = false
  let pollCount = 0
  let readyPollCount = 0
  let firstPollAt = 0
  let claimedCount = 0
  let disposed = false

  /** Liveness snapshot for `status`: proves whether the browser half is talking to us. */
  function stats() {
    return {
      polls: pollCount,
      readyPolls: readyPollCount,
      claimed: claimedCount,
      firstPollAt: firstPollAt === 0 ? null : new Date(firstPollAt).toISOString(),
      lastPollAt: lastPollAt === 0 ? null : new Date(lastPollAt).toISOString(),
      lastPollReady,
      queued: queue.length,
    }
  }

  function noClientFailure() {
    const polledRecently = lastPollAt > 0 && Date.now() - lastPollAt <= NO_CLIENT_MS
    if (polledRecently && !lastPollReady) {
      return codedError(
        'E_NO_WEBVIEW',
        'Панель DeepSeek открыта, но окно chat.deepseek.com не смонтировано. '
        + 'Войдите в аккаунт DeepSeek и повторите /export-chats.',
      )
    }
    return codedError(
      'E_NO_CLIENT',
      'Панель DeepSeek не открыта. Откройте панель DeepSeek в боковой колонке, '
      + 'войдите в chat.deepseek.com и повторите /export-chats.',
    )
  }

  function enqueue({ signal } = {}) {
    if (disposed) return Promise.reject(codedError('E_DISPOSED', 'Плагин выгружен.'))
    if (signal?.aborted) return Promise.reject(codedError('E_ABORTED', 'Экспорт отменён.'))

    return new Promise((resolve, reject) => {
      const job = {
        id: randomUUID(),
        state: 'queued',
        clientId: '',
        settle: null,
        noClientTimer: null,
        waitTimer: null,
        expiryTimer: null,
      }
      jobs.set(job.id, job)
      queue.push(job)

      let settled = false
      const onAbort = () => finish({ kind: 'reject', error: codedError('E_ABORTED', 'Экспорт отменён.') })
      const finish = (outcome) => {
        if (settled) return
        settled = true
        job.state = 'settled'
        clearTimers(job)
        removeFromQueue(queue, job)
        jobs.delete(job.id)
        signal?.removeEventListener?.('abort', onAbort)
        if (outcome.kind === 'reject') reject(outcome.error)
        else resolve(outcome)
      }

      job.settle = finish
      signal?.addEventListener?.('abort', onAbort, { once: true })

      job.noClientTimer = setTimeout(() => finish({ kind: 'reject', error: noClientFailure() }), NO_CLIENT_MS)
      job.waitTimer = setTimeout(() => finish({
        kind: 'reject',
        error: codedError(
          'E_TIMEOUT',
          `Клиент не прислал результат за ${Math.round(commandWaitMs / 1000)} с. `
          + 'Откройте панель DeepSeek и повторите /export-chats.',
        ),
      }), commandWaitMs)
      unrefTimer(job.noClientTimer)
      unrefTimer(job.waitTimer)
      logger.info(`command job ${job.id.slice(0, 8)} queued`)
    })
  }

  function poll({ clientId, ready }) {
    lastPollAt = Date.now()
    if (firstPollAt === 0) firstPollAt = lastPollAt
    pollCount += 1
    lastPollReady = ready === true
    if (lastPollReady) readyPollCount += 1
    if (disposed || ready !== true) return null

    while (queue.length) {
      const job = queue.shift()
      if (job.state !== 'queued' || typeof job.settle !== 'function') continue
      job.state = 'claimed'
      claimedCount += 1
      job.clientId = typeof clientId === 'string' ? clientId.slice(0, 64) : ''
      if (job.noClientTimer) {
        clearTimeout(job.noClientTimer)
        job.noClientTimer = null
      }
      job.expiryTimer = setTimeout(() => {
        job.settle?.({
          kind: 'reject',
          error: codedError('E_EXPIRED', 'Клиент не прислал результат экспорта. Повторите /export-chats.'),
        })
      }, commandWaitMs)
      unrefTimer(job.expiryTimer)
      logger.info(`command job ${job.id.slice(0, 8)} claimed`)
      return { id: job.id }
    }
    return null
  }

  function settle({ jobId, ok, summary, error }) {
    const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined
    if (!job || typeof job.settle !== 'function' || job.state === 'settled') return false
    // A late/duplicate report must not resurrect a job; the command already settled.
    if (ok) job.settle({ kind: 'resolve', ok: true, summary })
    else {
      const reason = typeof error === 'string' && error.trim() ? error : 'Клиент сообщил об ошибке экспорта.'
      job.settle({ kind: 'resolve', ok: false, error: reason })
    }
    return true
  }

  function dispose() {
    disposed = true
    for (const job of [...jobs.values()]) {
      job.settle?.({ kind: 'reject', error: codedError('E_DISPOSED', 'Плагин выгружен.') })
    }
    jobs.clear()
    queue.length = 0
  }

  return { enqueue, poll, settle, dispose, stats }
}

async function runExportChatsCommand({ bus, invocation }) {
  try {
    const outcome = await bus.enqueue({ signal: invocation?.signal })
    if (outcome.ok) return { kind: 'success', text: formatSummary(outcome.summary) }
    return { kind: 'error', text: sanitizeError(outcome.error || 'Экспорт не удался.') }
  } catch (error) {
    return { kind: 'error', text: sanitizeError(error) }
  }
}

/**
 * Turn the client's plain-text summary (or the raw `export` result) into command text.
 * Russian, because the single registered command is user-facing.
 */
function formatSummary(value) {
  if (typeof value === 'string' && value.trim()) return truncate(value.trim(), SUMMARY_MAX_CHARS)
  if (isRecord(value)) {
    const lines = [
      `Экспорт DeepSeek: найдено ${counter(value.found)}, выгружено ${counter(value.exported)}, `
      + `пропущено ${counter(value.skipped)}, с ошибкой ${counter(value.failed)}.`,
    ]
    if (typeof value.researchDir === 'string' && value.researchDir) lines.push(`Папка: ${value.researchDir}`)
    return truncate(lines.join('\n'), SUMMARY_MAX_CHARS)
  }
  return 'Экспорт DeepSeek завершён.'
}

/* ---------------------------------------------------------------- config ---- */

function resolveSettings(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    outputDir: text(source.outputDir, DEFAULTS.outputDir),
    cacheFileName: text(source.cacheFileName, DEFAULTS.cacheFileName),
    workspaceRoot: text(source.workspaceRoot, DEFAULTS.workspaceRoot),
    labelUser: text(source.labelUser, DEFAULTS.labelUser),
    labelAssistant: text(source.labelAssistant, DEFAULTS.labelAssistant),
    fileNameMaxTitle: integer(source.fileNameMaxTitle, DEFAULTS.fileNameMaxTitle, 1),
    commandWaitMs: integer(source.commandWaitMs, DEFAULTS.commandWaitMs, 1000),
    maxChats: integer(source.maxChats, DEFAULTS.maxChats, 1),
    api: resolveApi(source.api),
  }
}

// `api` is the one deep-merged table; endpoint arrays are replaced wholesale so a row
// that lists endpoints decides exactly which ones the client tries.
function resolveApi(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    base: text(source.base, API_DEFAULTS.base),
    authProbe: resolveEndpoint(source.authProbe, API_DEFAULTS.authProbe) || copyEndpoint(API_DEFAULTS.authProbe),
    listEndpoints: resolveEndpointList(source.listEndpoints, API_DEFAULTS.listEndpoints),
    historyEndpoints: resolveEndpointList(source.historyEndpoints, API_DEFAULTS.historyEndpoints),
    domFallback: resolveDomFallback(source.domFallback),
  }
}

function resolveEndpointList(raw, fallback) {
  if (!Array.isArray(raw)) return fallback.map(copyEndpoint)
  const endpoints = raw.map((item) => resolveEndpoint(item, null)).filter(Boolean)
  return endpoints.length ? endpoints : fallback.map(copyEndpoint)
}

function resolveEndpoint(raw, fallback) {
  const source = isRecord(raw) ? raw : {}
  const endpoint = {
    method: text(source.method, fallback?.method || 'GET').toUpperCase(),
    path: text(source.path, fallback?.path || ''),
  }
  if (!endpoint.path) return null
  const body = typeof source.body === 'string'
    ? source.body
    : (typeof fallback?.body === 'string' ? fallback.body : '')
  if (body) endpoint.body = body
  // The client's endpoint resolver understands an optional `headers` map; carrying it
  // through keeps a retuned row working even though CONTRACT §5 does not list it.
  const headers = resolveHeaders(source.headers)
  if (headers) endpoint.headers = headers
  return endpoint
}

function resolveHeaders(raw) {
  if (!isRecord(raw)) return null
  const headers = {}
  let count = 0
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || key.trim() === '') continue
    headers[key.trim()] = value
    count += 1
  }
  return count === 0 ? null : headers
}

function resolveDomFallback(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : API_DEFAULTS.domFallback.enabled,
    messageSelector: text(source.messageSelector, API_DEFAULTS.domFallback.messageSelector),
    roleAttribute: text(source.roleAttribute, API_DEFAULTS.domFallback.roleAttribute),
  }
}

function copyEndpoint(endpoint) {
  return endpoint.body === undefined ? { method: endpoint.method, path: endpoint.path } : { ...endpoint }
}

/* --------------------------------------------------------------- helpers ---- */

function createLogger(ctx) {
  let base = null
  try {
    base = ctx && typeof ctx === 'object' ? ctx.logger : null
  } catch {
    base = null
  }

  const emit = (level) => (message) => {
    const line = typeof message === 'string' ? message : String(message)
    try {
      if (base && typeof base[level] === 'function') {
        // Cordis loggers may treat `%` as a printf placeholder; keep file names literal.
        base[level](line.replace(/%/g, '%%'))
      } else if (typeof console[level] === 'function') {
        console[level](`[${name}] ${line}`)
      }
    } catch {
      // Logging must never decide the outcome of a request.
    }
  }

  return { info: emit('info'), warn: emit('warn'), error: emit('error') }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false

    const settle = (settleWith, value) => {
      if (done) return
      done = true
      req.removeListener?.('data', onData)
      req.removeListener?.('end', onEnd)
      req.removeListener?.('error', onError)
      req.removeListener?.('aborted', onAbort)
      settleWith(value)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        // Keep draining so the 413 answer can still use the open socket.
        req.resume?.()
        settle(reject, codedError('E_BODY', `request body exceeds ${limit} bytes`))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => settle(resolve, Buffer.concat(chunks).toString('utf8'))
    const onError = (error) => settle(reject, error)
    const onAbort = () => settle(reject, codedError('E_BODY', 'request aborted'))

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAbort)
  })
}

function sendJson(res, status, payload) {
  if (!res || res.writableEnded || res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function setHeader(res, key, value) {
  try {
    res?.setHeader?.(key, value)
  } catch {
    // Headers already flushed; the status code still carries the answer.
  }
}

function rpcFailure(code, error) {
  return { ok: false, error: { code, message: sanitizeError(error) } }
}

/**
 * Never echo cookies, tokens, Authorization headers or raw API bodies into an error
 * message; also keep the text short enough to render as a command result.
 */
function sanitizeError(value) {
  const raw = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : (typeof value?.message === 'string' ? value.message : String(value ?? ''))
  const stripped = raw.replace(/set-cookie|cookie|authorization|bearer|token/gi, '[redacted]')
  return truncate(stripped, ERROR_MAX_CHARS)
}

async function isDirectory(targetPath) {
  try {
    const stat = await fsp.stat(targetPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isErrorCode(value) {
  return typeof value === 'string' && /^E_[A-Z0-9_]+$/.test(value)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

function integer(value, fallback, minimum) {
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback
}

function counter(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function truncate(value, maxLength) {
  const source = typeof value === 'string' ? value : String(value ?? '')
  return source.length <= maxLength ? source : source.slice(0, maxLength)
}

function clearTimers(job) {
  for (const key of ['noClientTimer', 'waitTimer', 'expiryTimer']) {
    if (job[key]) {
      clearTimeout(job[key])
      job[key] = null
    }
  }
}

function removeFromQueue(queue, job) {
  const index = queue.indexOf(job)
  if (index !== -1) queue.splice(index, 1)
}

function unrefTimer(timer) {
  timer?.unref?.()
}
