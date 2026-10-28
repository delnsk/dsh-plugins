/**
 * Pure filesystem/text core of the DeepSeek chat exporter.
 *
 * Deliberately free of Cordis, network access and module-level mutable state: every
 * entry point takes its dependencies as arguments so `node --test` can drive the
 * whole export without a Host. The caller (`index.js`) owns configuration, routing
 * and logging policy.
 */

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

const CACHE_VERSION = 1
const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const DEFAULT_MAX_TITLE = 60
const DEFAULT_LABELS = { labelUser: 'Пользователь', labelAssistant: 'Ассистент' }

// Mirrors CONTRACT §8: records carrying any of these flags/type names are reasoning,
// never transcript text, and must not reach the archive.
const REASONING_FLAGS = ['reasoning', 'is_reasoning', 'thinking', 'is_thinking', 'cot']
const REASONING_TYPES = new Set([
  'reasoning', 'reasoning_content', 'thinking', 'think', 'cot', 'thought',
  'chain_of_thought', 'analysis', 'summary_of_thinking',
])

// Legacy DeepSeek records express the role through `type` instead of `role`.
const ROLE_BY_SOURCE_TYPE = new Map([
  ['request', 'user'],
  ['user', 'user'],
  ['response', 'assistant'],
  ['assistant', 'assistant'],
])

const WRITE_TMP_COUNTER = { value: 0 }

/**
 * Defensive validation of one client-supplied chat (CONTRACT §3).
 *
 * Drops reasoning records, non-user/assistant roles and empty texts, normalizes
 * timestamps to epoch ms and recomputes `lastMessageId` from the kept messages so a
 * client bug can never corrupt the archive.
 *
 * @param {unknown} raw untrusted chat object from the wire
 * @param {{ maxMessages?: number }} [options] optional defensive message cap
 * @returns {{ chatId: string, title: string, sourceUrl: string, createdAt?: number,
 *   updatedAt?: number, lastMessageId: string, messages: Array<{ id: string,
 *   role: 'user'|'assistant', text: string, createdAt?: number }> }}
 * @throws {Error & { code: string }} `E_CHAT_ID` for an illegal id,
 *   `E_EMPTY_MESSAGES` when nothing exportable remains
 */
export function normalizeHostChat(raw, options = {}) {
  if (!isRecord(raw)) throw codedError('E_CHAT', 'chat payload is not an object')

  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  if (!CHAT_ID_RE.test(chatId)) throw codedError('E_CHAT_ID', `invalid chatId: ${preview(chatId)}`)

  const messages = []
  const limit = Number.isFinite(options?.maxMessages) && options.maxMessages > 0
    ? Math.floor(options.maxMessages)
    : Infinity
  for (const candidate of Array.isArray(raw.messages) ? raw.messages : []) {
    if (messages.length >= limit) break
    const message = normalizeMessage(candidate)
    if (message) messages.push(message)
  }
  if (!messages.length) throw codedError('E_EMPTY_MESSAGES', `chat ${chatId.slice(0, 8)} has no exportable messages`)

  const chat = {
    chatId,
    title: typeof raw.title === 'string' ? raw.title : '',
    sourceUrl: normalizeSourceUrl(raw.sourceUrl, chatId),
    lastMessageId: messages[messages.length - 1].id,
    messages,
  }
  const createdAt = toEpochMs(raw.createdAt)
  if (createdAt) chat.createdAt = createdAt
  const updatedAt = toEpochMs(raw.updatedAt)
  if (updatedAt) chat.updatedAt = updatedAt
  return chat
}

/**
 * Content fingerprint of the last transcript message (CONTRACT §3):
 * `sha256(id + "\0" + text)` as 64 hex chars.
 *
 * @param {{ id?: string, text?: string } | null | undefined} message
 * @returns {string}
 */
export function hashLastMessage(message) {
  const id = typeof message?.id === 'string' ? message.id : ''
  const text = typeof message?.text === 'string' ? message.text : ''
  return createHash('sha256').update(`${id}\u0000${text}`, 'utf8').digest('hex')
}

/**
 * Filename-safe slug: keeps Unicode letters/digits plus `-` and `_`, turns every other
 * run into a single `-`, then trims separators and cuts to `maxLength` code points.
 *
 * @param {unknown} title raw chat title
 * @param {number} [maxLength] maximum length, default 60
 * @returns {string} slug, possibly `""` for an empty/unsafe title
 */
export function slugifyTitle(title, maxLength) {
  const text = typeof title === 'string' ? title : ''
  const limit = Number.isFinite(maxLength) && maxLength >= 1 ? Math.floor(maxLength) : DEFAULT_MAX_TITLE
  const slug = text
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
  const trimmed = slug.replace(/^[-_.\s]+|[-_.\s]+$/g, '')
  return sliceCodePoints(trimmed, limit).replace(/[-_.\s]+$/g, '')
}

/**
 * Decide the Markdown file name for a chat (CONTRACT §4).
 *
 * A chat already present in the cache keeps its recorded name, so updates overwrite
 * the same file instead of creating duplicates; only a fresh chat gets a new name.
 *
 * @param {{ chatId: string, title?: string, createdAt?: number, updatedAt?: number }} chat
 *   normalized chat
 * @param {{ file?: string } | null | undefined} cacheEntry previous cache record
 * @param {{ fileNameMaxTitle?: number }} [options]
 * @returns {{ fileName: string, datePrefix: string }}
 */
export function buildFileName(chat, cacheEntry, options = {}) {
  const recorded = typeof cacheEntry?.file === 'string' ? cacheEntry.file.trim() : ''
  const stamp = chat?.createdAt ?? chat?.updatedAt ?? Date.now()
  const datePrefix = formatDate(stamp)
  if (recorded) return { fileName: path.basename(recorded.replace(/[\\/]+$/, '')), datePrefix }

  const maxTitle = Number.isFinite(options.fileNameMaxTitle)
    ? options.fileNameMaxTitle
    : DEFAULT_MAX_TITLE
  // An empty slug would leave `__<id>.md`; `chat` keeps the name readable and unique.
  const slug = slugifyTitle(chat?.title, maxTitle) || 'chat'
  const shortId = String(chat?.chatId ?? '').slice(0, 8)
  return { fileName: `${datePrefix}_${slug}_${shortId}.md`, datePrefix }
}

/**
 * Render one Markdown file: YAML frontmatter (CONTRACT §7), blank line, then one
 * `**label:**` block per message separated by blank lines. Message text is inserted
 * verbatim; the document ends with exactly one newline.
 *
 * @param {{ chatId: string, title?: string, sourceUrl?: string,
 *   messages: Array<{ role: string, text: string }> }} chat
 * @param {{ exportedAt?: string, updatedAt?: string, lastMessageId?: string,
 *   lastMessageHash?: string }} [meta] timestamps and fingerprint from the cache
 * @param {{ labelUser?: string, labelAssistant?: string,
 *   labels?: { labelUser?: string, labelAssistant?: string } }} [options]
 * @returns {string}
 */
export function renderMarkdown(chat, meta = {}, options = {}) {
  const labels = resolveLabels(options)
  const messages = (Array.isArray(chat?.messages) ? chat.messages : []).filter((message) => {
    if (!isRecord(message)) return false
    if (message.role !== 'user' && message.role !== 'assistant') return false
    return typeof message.text === 'string' && message.text.trim() !== ''
  })

  const frontmatter = [
    '---',
    `title: ${yamlScalar(chat?.title ?? '')}`,
    `chat_id: ${yamlScalar(chat?.chatId ?? '')}`,
    `source_url: ${yamlScalar(chat?.sourceUrl ?? '')}`,
    `exported_at: ${yamlScalar(meta.exportedAt ?? '')}`,
    `updated_at: ${yamlScalar(meta.updatedAt ?? '')}`,
    `message_count: ${messages.length}`,
    `last_message_id: ${yamlScalar(meta.lastMessageId ?? '')}`,
    `last_message_hash: ${yamlScalar(meta.lastMessageHash ?? '')}`,
    '---',
  ].join('\n')

  const blocks = messages.map((message) => {
    const label = message.role === 'assistant' ? labels.labelAssistant : labels.labelUser
    // Trailing whitespace is trimmed only at the very end of a block, otherwise the
    // "exactly one trailing newline" rule could be violated by sloppy source text.
    return `**${label}:**\n\n${trimEnd(message.text)}`
  })
  if (!blocks.length) return `${frontmatter}\n`
  return `${frontmatter}\n\n${blocks.join('\n\n')}\n`
}

/**
 * Read the cache file (CONTRACT §4). Missing, unreadable, malformed or foreign-version
 * caches all degrade to an empty cache instead of throwing: a damaged cache must never
 * block an export, it only costs a rewrite.
 *
 * @param {string} cachePath absolute path to `.dsh-chat-exporter-cache.json`
 * @returns {Promise<{ version: number, updatedAt: string|null,
 *   chats: Record<string, object> }>}
 */
export async function readCache(cachePath) {
  const empty = { version: CACHE_VERSION, updatedAt: null, chats: {} }
  let text
  try {
    text = await fsp.readFile(cachePath, 'utf8')
  } catch {
    return empty
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return empty
  }
  if (!isRecord(parsed)) return empty
  if ('version' in parsed && parsed.version !== CACHE_VERSION) return empty
  if (!isRecord(parsed.chats)) return empty

  const chats = {}
  for (const [chatId, entry] of Object.entries(parsed.chats)) {
    if (!CHAT_ID_RE.test(chatId)) continue
    const normalized = normalizeCacheEntry(entry)
    if (normalized) chats[chatId] = normalized
  }
  return {
    version: CACHE_VERSION,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    chats,
  }
}

/**
 * Persist the cache atomically (temp file in the same directory, then rename).
 *
 * @param {string} cachePath absolute cache path
 * @param {{ version?: number, updatedAt?: string|null, chats?: object }} cache
 * @returns {Promise<void>}
 */
export async function writeCache(cachePath, cache) {
  const payload = {
    version: CACHE_VERSION,
    updatedAt: typeof cache?.updatedAt === 'string' ? cache.updatedAt : new Date().toISOString(),
    chats: isRecord(cache?.chats) ? cache.chats : {},
  }
  await writeFileAtomic(cachePath, `${JSON.stringify(payload, null, 2)}\n`)
}

/**
 * Export every chat and report per-chat outcomes (CONTRACT §2/§4).
 *
 * Unchanged chats (same last-message id + hash and the recorded file still on disk)
 * are skipped without touching the file. Changed chats rewrite their recorded path, so
 * the archive never grows duplicates. One broken chat is recorded as `failed` and the
 * run continues. The cache is persisted exactly once, after the loop.
 *
 * @param {object} input
 * @param {unknown[]} input.chats untrusted chats from the client
 * @param {string} input.workspaceRoot absolute workspace root
 * @param {string} [input.outputDir] research directory, relative to the root
 * @param {string} [input.cacheFileName] cache file name, relative to the root
 * @param {{ labelUser?: string, labelAssistant?: string }} [input.labels]
 * @param {number} [input.fileNameMaxTitle]
 * @param {{ info?: Function, warn?: Function, error?: Function }} [input.logger]
 * @returns {Promise<{ found: number, exported: number, skipped: number, failed: number,
 *   researchDir: string, results: Array<{ chatId: string, title: string,
 *   status: 'exported'|'skipped'|'failed', file?: string, reason?: string }>,
 *   errors: string[] }>}
 */
export async function runExport(input = {}) {
  const workspaceRoot = input.workspaceRoot
  if (typeof workspaceRoot !== 'string' || !workspaceRoot) {
    throw codedError('E_WORKSPACE', 'workspaceRoot is required')
  }
  const logger = input.logger
  const root = path.resolve(workspaceRoot)
  const researchDir = path.join(root, typeof input.outputDir === 'string' && input.outputDir ? input.outputDir : 'research')
  const cachePath = path.join(root, typeof input.cacheFileName === 'string' && input.cacheFileName
    ? input.cacheFileName
    : '.dsh-chat-exporter-cache.json')
  const fileNameMaxTitle = input.fileNameMaxTitle

  await fsp.mkdir(researchDir, { recursive: true })

  const cache = await readCache(cachePath)
  const list = Array.isArray(input.chats) ? input.chats : []
  const results = []
  const errors = []
  let exported = 0
  let skipped = 0
  let failed = 0

  log(logger, 'info', `export started: ${list.length} chat(s) -> ${researchDir}`)

  for (const raw of list) {
    const fallbackId = preview(raw?.chatId)
    const fallbackTitle = typeof raw?.title === 'string' ? raw.title : ''
    try {
      const chat = normalizeHostChat(raw)
      const lastMessage = chat.messages[chat.messages.length - 1]
      const lastMessageId = lastMessage.id
      const lastMessageHash = hashLastMessage(lastMessage)
      const entry = cache.chats[chat.chatId]
      const recordedFile = resolveCacheFile(root, entry?.file)
      const recordedFileExists = recordedFile !== '' && await isFile(recordedFile)

      // Skip requires all three: same id, same content hash, and the file still there.
      const unchanged = recordedFileExists
        && entry.lastMessageId === lastMessageId
        && entry.lastMessageHash === lastMessageHash

      if (unchanged) {
        skipped += 1
        results.push({ chatId: chat.chatId, title: chat.title, status: 'skipped', file: entry.file })
        continue
      }

      const nowIso = new Date().toISOString()
      // A stale entry whose file vanished must not pin the name any more, so only a
      // file that still exists is overwritten in place; otherwise the name is redrawn.
      const { fileName } = buildFileName(chat, recordedFileExists ? entry : undefined, { fileNameMaxTitle })
      const targetPath = recordedFileExists ? recordedFile : path.join(researchDir, fileName)
      const exportedAt = typeof entry?.exportedAt === 'string' && entry.exportedAt ? entry.exportedAt : nowIso
      const markdown = renderMarkdown(chat, {
        exportedAt,
        updatedAt: nowIso,
        lastMessageId,
        lastMessageHash,
      }, { labelUser: input.labels?.labelUser, labelAssistant: input.labels?.labelAssistant })

      await writeFileAtomic(targetPath, markdown)

      const cacheFile = toCacheFile(root, targetPath)
      cache.chats[chat.chatId] = {
        title: chat.title,
        file: cacheFile,
        lastMessageId,
        lastMessageHash,
        messageCount: chat.messages.length,
        exportedAt,
        updatedAt: nowIso,
        lastExportAt: nowIso,
      }
      exported += 1
      results.push({ chatId: chat.chatId, title: chat.title, status: 'exported', file: cacheFile })
      log(logger, 'info', `wrote ${chat.chatId.slice(0, 8)} -> ${cacheFile}`)
    } catch (error) {
      failed += 1
      const reason = reasonOf(error)
      errors.push(`${fallbackId || '?'}: ${reason}`)
      results.push({ chatId: fallbackId, title: fallbackTitle, status: 'failed', reason })
      log(logger, 'warn', `chat ${fallbackId || '?'} failed: ${reason}`)
    }
  }

  cache.version = CACHE_VERSION
  cache.updatedAt = new Date().toISOString()
  try {
    await writeCache(cachePath, cache)
  } catch (error) {
    // Files are already on disk; refusing to answer would hide that from the caller.
    const reason = reasonOf(error)
    errors.push(`cache: ${reason}`)
    log(logger, 'error', `cache write failed: ${reason}`)
  }

  log(logger, 'info', `export finished: exported ${exported}, skipped ${skipped}, failed ${failed}`)
  return { found: list.length, exported, skipped, failed, researchDir, results, errors }
}

/**
 * Double-quoted YAML scalar with `\` and `"` escaped (plus control characters), so any
 * chat title stays one valid frontmatter line.
 *
 * @param {unknown} value scalar to quote
 * @returns {string} quoted scalar, `""` for null/undefined
 */
export function yamlScalar(value) {
  const text = value == null ? '' : String(value)
  let out = ''
  for (const char of text) {
    switch (char) {
      case '\\':
        out += '\\\\'
        break
      case '"':
        out += '\\"'
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      default: {
        const code = char.codePointAt(0)
        out += code < 0x20 || code === 0x7f
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : char
      }
    }
  }
  return `"${out}"`
}

/* ---------------------------------------------------------------- internals ---- */

function normalizeMessage(raw) {
  if (!isRecord(raw)) return null
  if (isReasoning(raw)) return null
  const role = normalizeRole(raw)
  if (!role) return null
  const text = extractText(raw)
  if (!text || text.trim() === '') return null
  const message = { id: typeof raw.id === 'string' ? raw.id : '', role, text }
  const createdAt = toEpochMs(raw.createdAt)
  if (createdAt) message.createdAt = createdAt
  return message
}

function isReasoning(raw) {
  for (const flag of REASONING_FLAGS) {
    if (raw[flag] === true) return true
  }
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''
  if (type && REASONING_TYPES.has(type)) return true
  const fragmentType = typeof raw.fragment?.type === 'string'
    ? raw.fragment.type.trim().toLowerCase()
    : ''
  return Boolean(fragmentType) && REASONING_TYPES.has(fragmentType)
}

function normalizeRole(raw) {
  const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : ''
  if (role === 'user' || role === 'assistant') return role
  if (role) return null
  const sourceType = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''
  return ROLE_BY_SOURCE_TYPE.get(sourceType) || null
}

function extractText(raw) {
  if (typeof raw.text === 'string') return raw.text
  if (typeof raw.content === 'string') return raw.content
  return ''
}

function normalizeSourceUrl(value, chatId) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^https?:\/\//i.test(text)) return text
  return `https://chat.deepseek.com/a/chat/s/${chatId}`
}

function normalizeCacheEntry(raw) {
  if (!isRecord(raw)) return null
  const file = typeof raw.file === 'string' ? raw.file.trim() : ''
  if (!file) return null
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    file,
    lastMessageId: typeof raw.lastMessageId === 'string' ? raw.lastMessageId : '',
    lastMessageHash: typeof raw.lastMessageHash === 'string' ? raw.lastMessageHash : '',
    messageCount: Number.isFinite(raw.messageCount) ? Math.max(0, Math.floor(raw.messageCount)) : 0,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    lastExportAt: typeof raw.lastExportAt === 'string' ? raw.lastExportAt : '',
  }
}

function resolveLabels(options) {
  const source = isRecord(options) ? options : {}
  const nested = isRecord(source.labels) ? source.labels : source
  return {
    labelUser: nonEmptyString(nested.labelUser) || DEFAULT_LABELS.labelUser,
    labelAssistant: nonEmptyString(nested.labelAssistant) || DEFAULT_LABELS.labelAssistant,
  }
}

function formatDate(epochMs) {
  const value = Number.isFinite(epochMs) ? epochMs : Date.now()
  return new Date(value).toISOString().slice(0, 10)
}

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Endpoints report both seconds and milliseconds; anything below 1e11 is seconds.
    return Math.round(value < 1e11 ? value * 1000 : value)
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return toEpochMs(numeric)
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function resolveCacheFile(workspaceRoot, file) {
  if (typeof file !== 'string' || !file.trim()) return ''
  const normalized = file.trim().replace(/\\/g, '/')
  return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(workspaceRoot, normalized)
}

function toCacheFile(workspaceRoot, absolutePath) {
  const relative = path.relative(workspaceRoot, absolutePath)
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  return (inside ? relative : absolutePath).split(path.sep).join('/')
}

async function isFile(targetPath) {
  try {
    const stat = await fsp.stat(targetPath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function writeFileAtomic(targetPath, content) {
  const directory = path.dirname(targetPath)
  await fsp.mkdir(directory, { recursive: true })
  WRITE_TMP_COUNTER.value += 1
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${WRITE_TMP_COUNTER.value}.tmp`,
  )
  await fsp.writeFile(tempPath, content, 'utf8')
  try {
    await fsp.rename(tempPath, targetPath)
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

function log(logger, level, message) {
  const sink = logger?.[level]
  if (typeof sink !== 'function') return
  try {
    sink.call(logger, message)
  } catch {
    // Logging must never decide the outcome of an export.
  }
}

function reasonOf(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '')
  return truncate(code || message, 300)
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : ''
}

function preview(value) {
  if (typeof value !== 'string') return ''
  return Array.from(value).slice(0, 8).join('')
}

function truncate(value, maxLength) {
  const text = typeof value === 'string' ? value : ''
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}

function trimEnd(value) {
  return typeof value === 'string' ? value.replace(/[\s\uFEFF\u00A0]+$/u, '') : ''
}

function sliceCodePoints(value, limit) {
  const characters = Array.from(value)
  return characters.length <= limit ? value : characters.slice(0, limit).join('')
}
