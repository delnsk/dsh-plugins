/**
 * Host half helpers for `@local/dsh-plugin-continue-after-error`.
 *
 * The Client half needs two things the browser cannot decide alone:
 *  - profile-owned configuration (continuation text, which stop reasons trigger
 *    the entry, whether diagnostics are on), editable in `cordis.patch.yml`;
 *  - a bounded diagnostics trail, so a button that never appears can be
 *    explained from the workspace instead of the browser console.
 *
 * This module is Cordis-free and unit-testable. `index.js` only wires the route.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const VERSION = '1.0.0'
export const ROUTE_PATH = '/dsh-continue'
export const RPC_PATH = '/dsh-continue/rpc'

const MAX_BODY_BYTES = 64 * 1024
const MAX_PROMPT_CHARS = 4000
const MAX_DETAIL_CHARS = 500
const MAX_SESSION_ID_CHARS = 128
/** Newest entries kept in the diagnostics file; older ones are dropped. */
const DIAGNOSTIC_LIMIT = 100

/** Stop reasons the entry knows how to resume from. */
export const KNOWN_TRIGGERS = Object.freeze(['error', 'interrupted', 'aborted', 'max-tokens'])

export const DEFAULTS = Object.freeze({
  prompt: '',
  triggerOn: Object.freeze(['error', 'interrupted', 'aborted']),
  diagnostics: true,
  diagnosticsFileName: '.dsh-continue-diagnostics.json',
  workspaceRoot: '',
})

/**
 * Merge a Loader row's `config` over the defaults, ignoring unknown keys and
 * wrongly typed values. A stale patch must never break the Host half.
 * @param {unknown} raw - row config from `cordis.patch.yml`.
 * @returns {typeof DEFAULTS} normalized settings.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const prompt = typeof source.prompt === 'string' ? source.prompt.trim().slice(0, MAX_PROMPT_CHARS) : DEFAULTS.prompt
  const triggerOn = Array.isArray(source.triggerOn)
    ? [...new Set(source.triggerOn.filter((item) => typeof item === 'string' && KNOWN_TRIGGERS.includes(item.trim())).map((item) => item.trim()))]
    : [...DEFAULTS.triggerOn]
  const diagnostics = typeof source.diagnostics === 'boolean' ? source.diagnostics : DEFAULTS.diagnostics
  const diagnosticsFileName = sanitizeFileName(source.diagnosticsFileName)
  const workspaceRoot =
    typeof source.workspaceRoot === 'string' && source.workspaceRoot !== '' && path.isAbsolute(source.workspaceRoot)
      ? path.resolve(source.workspaceRoot)
      : ''
  return {
    prompt,
    triggerOn: triggerOn.length === 0 ? [...DEFAULTS.triggerOn] : triggerOn,
    diagnostics,
    diagnosticsFileName: diagnosticsFileName ?? DEFAULTS.diagnosticsFileName,
    workspaceRoot,
  }
}

/** Only a bare `.json` file name is accepted; a path would escape the workspace. */
function sanitizeFileName(value) {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  if (name === '' || name !== path.basename(name)) return undefined
  if (!/^\.[A-Za-z0-9._-]{1,80}\.json$/u.test(name)) return undefined
  return name
}

/**
 * Describe one diagnostic entry from Client-supplied fields.
 * @param {unknown} body - RPC params.
 * @returns {{ at: string, event: string, sessionId?: string, turn?: number, kind?: string, message?: string } | undefined}
 */
export function diagnosticEntry(body) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const event = typeof source.event === 'string' && /^[a-z][a-z0-9-]{0,40}$/u.test(source.event) ? source.event : undefined
  if (event === undefined) return undefined
  const entry = { at: new Date().toISOString(), event }
  if (typeof source.sessionId === 'string' && source.sessionId !== '') {
    entry.sessionId = source.sessionId.slice(0, MAX_SESSION_ID_CHARS)
  }
  if (typeof source.turn === 'number' && Number.isFinite(source.turn)) entry.turn = source.turn
  if (typeof source.kind === 'string' && source.kind !== '') entry.kind = source.kind.slice(0, 40)
  if (typeof source.message === 'string' && source.message !== '') {
    entry.message = source.message.replace(/\s+/gu, ' ').trim().slice(0, MAX_DETAIL_CHARS)
  }
  return entry
}

/**
 * Resolve the workspace directory that owns the diagnostics file.
 *
 * The Desktop Host process does not run with the workspace as its working
 * directory, so the durable registry comes first, then the working-directory
 * service, then the process directory.
 * @param {object} ctx - Host context (injected web-server scope works too).
 * @param {{ workspaceRoot: string }} settings - normalized host settings.
 * @returns {Promise<string>} absolute directory, existing when resolvable.
 */
export async function resolveWorkspaceRoot(ctx, settings) {
  const candidates = []
  if (settings.workspaceRoot !== '') candidates.push(settings.workspaceRoot)
  try {
    const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    const list = registry !== undefined && registry !== null && typeof registry.list === 'function' ? registry.list() : []
    if (Array.isArray(list)) {
      for (const workspace of list) {
        if (typeof workspace?.path === 'string' && path.isAbsolute(workspace.path)) candidates.push(workspace.path)
      }
    }
  } catch {
    /* the registry is optional */
  }
  try {
    const workingDirectory = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
    const directory = workingDirectory?.defaultDirectory
    if (typeof directory === 'string' && path.isAbsolute(directory)) candidates.push(directory)
  } catch {
    /* the working-directory service is optional */
  }
  candidates.push(process.cwd())

  for (const candidate of candidates) {
    try {
      const info = await fsp.stat(candidate)
      if (info.isDirectory()) return path.resolve(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  return path.resolve(candidates[0])
}

/**
 * Append one entry to the bounded diagnostics log, atomically.
 * @param {string} file - absolute diagnostics path.
 * @param {object} entry - entry from {@link diagnosticEntry}.
 * @returns {Promise<number>} entries kept.
 */
export async function appendDiagnostic(file, entry) {
  let document = { version: 1, updatedAt: entry.at, entries: [] }
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.entries)) document = parsed
  } catch {
    /* missing or corrupt diagnostics start fresh instead of failing the request */
  }
  const entries = [...document.entries, entry].slice(-DIAGNOSTIC_LIMIT)
  const next = { version: 1, updatedAt: entry.at, entries }
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await fsp.rename(temp, file)
  return entries.length
}

/**
 * Build the `POST /dsh-continue/rpc` handler.
 * @param {object} input - handler dependencies.
 * @param {object} input.ctx - Host context used for optional service lookups.
 * @param {ReturnType<typeof normalizeConfig>} input.settings - normalized host settings.
 * @param {{ info?: Function, warn?: Function, error?: Function }} [input.logger] - diagnostics sink.
 * @returns {(req: any, res: any) => Promise<void>} Node HTTP handler.
 */
export function createRpcHandler({ ctx, settings, logger }) {
  let diagnosticsFile
  /** Serializes read-modify-write cycles on the diagnostics file. */
  let chain = Promise.resolve()

  async function resolveDiagnosticsFile() {
    if (diagnosticsFile === undefined) {
      const root = await resolveWorkspaceRoot(ctx, settings)
      diagnosticsFile = path.join(root, settings.diagnosticsFileName)
    }
    return diagnosticsFile
  }

  async function record(entry) {
    if (settings.diagnostics !== true) return { path: null, entries: 0 }
    const file = await resolveDiagnosticsFile()
    const run = chain.then(async () => appendDiagnostic(file, entry))
    chain = run.then(
      () => undefined,
      (failure) => {
        logger?.warn?.(`continue-after-error: could not write diagnostics: ${String(failure)}`)
      },
    )
    const entries = await run
    return { path: file, entries }
  }

  return async function handler(req, res) {
    try {
      const url = new URL(typeof req?.url === 'string' ? req.url : '/', 'http://localhost')
      if (url.pathname !== RPC_PATH) {
        sendJson(res, 404, failure('E_ROUTE', `unknown route: ${url.pathname}`))
        return
      }
      if (String(req.method ?? '').toUpperCase() !== 'POST') {
        setHeader(res, 'allow', 'POST')
        sendJson(res, 405, failure('E_HTTP_METHOD', 'only POST is supported'))
        return
      }

      let body
      try {
        body = await readBody(req, MAX_BODY_BYTES)
      } catch (error) {
        sendJson(res, 413, failure(error?.code ?? 'E_BODY', String(error?.message ?? error)))
        return
      }

      let request
      try {
        request = JSON.parse(body)
      } catch {
        sendJson(res, 400, failure('E_JSON', 'request body must be JSON'))
        return
      }
      if (request === null || typeof request !== 'object' || typeof request.method !== 'string') {
        sendJson(res, 400, failure('E_REQUEST', 'request must be { method, params }'))
        return
      }

      switch (request.method) {
        case 'config': {
          sendJson(res, 200, success({
            version: VERSION,
            prompt: settings.prompt === '' ? null : settings.prompt,
            triggerOn: settings.triggerOn,
            diagnostics: settings.diagnostics,
          }))
          return
        }
        case 'report': {
          const entry = diagnosticEntry(request.params)
          if (entry === undefined) {
            sendJson(res, 400, failure('E_REPORT', 'report needs a valid event name'))
            return
          }
          const outcome = await record(entry)
          sendJson(res, 200, success({ accepted: true, ...outcome }))
          return
        }
        case 'status': {
          let document = { entries: [] }
          try {
            document = JSON.parse(await fsp.readFile(await resolveDiagnosticsFile(), 'utf8'))
          } catch {
            /* a status read never creates the file */
          }
          const entries = Array.isArray(document.entries) ? document.entries : []
          sendJson(res, 200, success({
            version: VERSION,
            diagnostics: settings.diagnostics,
            path: settings.diagnostics ? await resolveDiagnosticsFile() : null,
            entries: entries.length,
            last: entries.slice(-1),
          }))
          return
        }
        default:
          sendJson(res, 404, failure('E_METHOD', `unknown method: ${request.method}`))
      }
    } catch (error) {
      logger?.warn?.(`continue-after-error: request failed: ${String(error)}`)
      sendJson(res, 500, failure('E_INTERNAL', String(error?.message ?? error).slice(0, MAX_DETAIL_CHARS)))
    }
  }
}

/* ------------------------------------------------------------------ helpers --- */

function success(value) {
  return { ok: true, value }
}

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

function setHeader(res, name, value) {
  try {
    res.setHeader(name, value)
  } catch {
    /* an already-sent response has no headers */
  }
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  try {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  } catch {
    /* the socket may already be gone */
  }
}

/** Read one request body with a hard byte cap. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      req.removeListener?.('data', onData)
      req.removeListener?.('end', onEnd)
      req.removeListener?.('error', onError)
      if (outcome.error !== undefined) reject(outcome.error)
      else resolve(outcome.text)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('request body is too large')
        error.code = 'E_BODY_TOO_LARGE'
        finish({ error })
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish({ text: Buffer.concat(chunks).toString('utf8') })
    const onError = (error) => finish({ error })
    req.on?.('data', onData)
    req.on?.('end', onEnd)
    req.on?.('error', onError)
  })
}
