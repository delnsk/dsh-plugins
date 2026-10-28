/**
 * Dependency-free normalizers shared by both halves of the plugin.
 *
 * This file has a dual life:
 * - the Host half imports it as a normal ES module;
 * - scripts/build-client.mjs strips the leading declaration keyword from every
 *   line and inlines the rest into the browser bundle.
 *
 * That is why the file is self-contained: only `export`-prefixed function and
 * const declarations, one per line, no imports, no Node builtins, no globals and
 * no top-level side effects. ES2019 syntax only, so the inlined copy parses in
 * the Electron renderer exactly as it does in Node.
 *
 * The live endpoints are undocumented, so nothing here trusts a single shape:
 * containers are walked breadth-first and every field has an ordered alias list.
 */

const REASONING_TYPES = [
  'reasoning',
  'reasoning_content',
  'thinking',
  'think',
  'cot',
  'thought',
  'chain_of_thought',
  'analysis',
  'summary_of_thinking'
]

const REASONING_FLAG_KEYS = [
  'reasoning',
  'is_reasoning',
  'thinking',
  'is_thinking',
  'cot',
  'thought'
]

// Fragment types that carry transcript text. Everything else is protocol: search status
// ("Found 28 web pages"), tool traffic, files, sources. An allow-list, not a deny-list,
// because an unknown search variant once leaked its status copy into the archive.
const TEXT_FRAGMENT_TYPES = ['request', 'response', 'text', 'message', 'answer', 'content', 'markdown', 'output']

// Where source lists live. DeepSeek attaches them to the search fragment (`references`,
// `results`) and sometimes to the message or the payload level.
const REFERENCE_CONTAINER_KEYS = ['references', 'search_results', 'results', 'sources', 'citations']
const REFERENCE_URL_KEYS = ['url', 'link', 'href', 'source_url', 'origin_url', 'site_url', 'uri']
const REFERENCE_TITLE_KEYS = ['title', 'name', 'site_name', 'snippet', 'description']
// Inline citation markers in the answer text: `[reference:0]`, `[citation:3]`.
const REFERENCE_MARKER = /\[(?:reference|citation):(\d+)\]/gu
const REFERENCE_HEADING = '**Источники:**'

const CHAT_URL_BASE = 'https://chat.deepseek.com/a/chat/s/'

// Timestamps arrive in seconds, milliseconds or microseconds. 1e11 ms is 1973 and
// 1e14 ms is year 5138, so anything below the first bound is seconds and anything
// above the second is microseconds.
const SECONDS_CEILING = 1e11
const MICROSECONDS_FLOOR = 1e14

// Envelope keys that wrap the actual payload; walked breadth-first because the
// endpoints nest them differently (`data.biz_data`, `result.data`, ...).
const NESTED_CONTAINER_KEYS = ['data', 'biz_data', 'result']
const MAX_CONTAINER_DEPTH = 4

const CHAT_ID_KEYS = ['id', 'chat_session_id', 'session_id', 'chatId', 'conversation_id']
const CHAT_TITLE_KEYS = ['title', 'name', 'topic', 'chat_title']
const CHAT_UPDATED_KEYS = ['updated_at', 'updatedAt', 'update_time', 'modified_at']
const CHAT_CREATED_KEYS = ['created_at', 'createdAt', 'create_time', 'inserted_at']
const CHAT_ARRAY_KEYS = [
  'chat_sessions',
  'chatSessions',
  'sessions',
  'chats',
  'chat_list',
  'list',
  'items',
  'rows',
  'records'
]

const MESSAGE_ID_KEYS = ['id', 'message_id', 'msg_id', 'messageId']
const MESSAGE_CREATED_KEYS = ['created_at', 'createdAt', 'timestamp', 'inserted_at', 'update_time']
const MESSAGE_ARRAY_KEYS = [
  'chat_messages',
  'chatMessages',
  'messages',
  'history',
  'items',
  'message_list',
  'list',
  'rows'
]
const MESSAGE_SHAPE_KEYS = ['content', 'fragments', 'role', 'type']

const ROLE_KEYS = ['role', 'author_role', 'sender_role']
const TYPE_KEYS = ['type', 'message_type']
const FRAGMENT_LIST_KEYS = ['fragments']
const FRAGMENT_SINGLE_KEYS = ['fragment']
const REASONING_CONTENT_KEYS = ['reasoning_content', 'reasoningContent']

const REASONING_TYPE_SET = new Set(REASONING_TYPES.map(normalizeToken))
const REASONING_FLAG_SET = new Set(REASONING_FLAG_KEYS.map(normalizeToken))

/**
 * Shorten an identifier-ish token: lowercase, drop separators. Used for type and
 * role comparisons only, so `chain_of_thought`, `ChainOfThought` and
 * `chain-of-thought` all collapse to the same key.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeToken(value) {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().replace(/[_\-\s]+/g, '')
}

/**
 * Shorten an object key the same way, so `chat_session_id` and `chatSessionId`
 * are interchangeable when reading tolerated aliases.
 *
 * @param {string} key
 * @returns {string}
 */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_\-\s]+/g, '')
}

/**
 * @param {unknown} value
 * @returns {boolean} true for a non-null, non-array object
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read the first present, non-null value among ordered aliases. A second pass
 * compares normalized keys, so payloads that use `chatSessionId` or
 * `SESSION_ID` still resolve. Priority order is kept in both passes.
 *
 * @param {object} record
 * @param {string[]} keys aliases in descending priority
 * @returns {unknown}
 */
function readField(record, keys) {
  if (!isRecord(record)) return undefined
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const value = record[key]
    if (value !== undefined && value !== null) return value
  }
  for (const key of keys) {
    const target = normalizeKey(key)
    for (const candidate of Object.keys(record)) {
      if (normalizeKey(candidate) !== target) continue
      const value = record[candidate]
      if (value !== undefined && value !== null) return value
    }
  }
  return undefined
}

/**
 * @param {unknown} value
 * @returns {string} trimmed string, '' when the value is unusable
 */
function toTrimmedString(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * @param {unknown} value
 * @returns {string|undefined} trimmed id, `undefined` when absent/blank
 */
function toIdentifier(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * @param {unknown} value truthiness that also rejects '' / 'false' / empty containers
 * @returns {boolean}
 */
function isTruthyFlag(value) {
  if (value === undefined || value === null || value === false) return false
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase()
    return token !== '' && token !== 'false' && token !== '0'
  }
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

/**
 * Scale a numeric timestamp to epoch milliseconds.
 *
 * @param {number} value finite positive number
 * @returns {number|undefined}
 */
function epochMsFromNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (value < SECONDS_CEILING) return Math.round(value * 1000)
  if (value > MICROSECONDS_FLOOR) return Math.round(value / 1000)
  return Math.round(value)
}

/**
 * Normalize seconds / milliseconds / microseconds / ISO strings to epoch ms.
 *
 * @param {unknown} value
 * @returns {number|undefined} epoch ms, `undefined` when unusable
 */
function toEpochMs(value) {
  if (typeof value === 'number') return epochMsFromNumber(value)
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return undefined
    // Numeric strings occur when a backend stringifies counters and clocks, so
    // scale them exactly like numbers instead of letting Date.parse guess.
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return epochMsFromNumber(Number(text))
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * Walk the known envelopes breadth-first and return every object that could hold
 * the arrays we look for. Deduplicated by identity, so `payload.data.biz_data`
 * present once is visited once, and the payload itself is always first.
 *
 * @param {unknown} payload raw response body (already JSON-parsed)
 * @returns {object[]} candidate container roots in visit order
 */
function collectRoots(payload) {
  const roots = []
  const seen = new Set()
  const queue = []
  if (payload !== null && typeof payload === 'object') {
    seen.add(payload)
    roots.push(payload)
    queue.push({ node: payload, depth: 0 })
  }
  let index = 0
  while (index < queue.length) {
    const current = queue[index]
    index += 1
    if (current.depth >= MAX_CONTAINER_DEPTH) continue
    // Envelopes are objects; an array root is a payload already, not a wrapper.
    if (!isRecord(current.node)) continue
    for (const key of NESTED_CONTAINER_KEYS) {
      const child = readField(current.node, [key])
      if (child === null || typeof child !== 'object' || Array.isArray(child)) continue
      if (seen.has(child)) continue
      seen.add(child)
      roots.push(child)
      queue.push({ node: child, depth: current.depth + 1 })
    }
  }
  return roots
}

/**
 * @param {object} record
 * @returns {boolean} true when the object exposes a usable chat id
 */
function hasChatId(record) {
  return toIdentifier(readField(record, CHAT_ID_KEYS)) !== undefined
}

/**
 * @param {object} record
 * @returns {boolean} true when the object exposes message-ish fields
 */
function hasMessageShape(record) {
  for (const key of MESSAGE_SHAPE_KEYS) {
    if (readField(record, [key]) !== undefined) return true
  }
  return false
}

/**
 * @param {unknown} value
 * @returns {boolean} true when at least one element looks like a chat session
 */
function looksLikeChatArray(value) {
  if (!Array.isArray(value)) return false
  for (const item of value) {
    if (!isRecord(item)) continue
    if (hasChatId(item)) return true
  }
  return false
}

/**
 * @param {unknown} value
 * @returns {boolean} true when at least one element looks like a message
 */
function looksLikeMessageArray(value) {
  if (!Array.isArray(value)) return false
  for (const item of value) {
    if (!isRecord(item)) continue
    if (hasMessageShape(item)) return true
  }
  return false
}

/**
 * Find the array of chat sessions. Keyed arrays (`chat_sessions`, `sessions`, ...)
 * are searched at every candidate root first; any other array of chat-like
 * objects is only a fallback, so a nested wrapper never beats a named key.
 *
 * @param {unknown} payload
 * @returns {unknown[]|null}
 */
function findChatArray(payload) {
  const roots = collectRoots(payload)
  for (const root of roots) {
    if (looksLikeChatArray(root)) return root
    if (!isRecord(root)) continue
    for (const key of CHAT_ARRAY_KEYS) {
      const value = readField(root, [key])
      if (looksLikeChatArray(value)) return value
    }
  }
  for (const root of roots) {
    if (!isRecord(root)) continue
    for (const key of Object.keys(root)) {
      const value = root[key]
      if (looksLikeChatArray(value)) return value
    }
  }
  return null
}

/**
 * Find the array of history messages. Names such as `chat_messages` and
 * `messages` win over an anonymous nested array at every root.
 *
 * @param {unknown} payload
 * @returns {unknown[]|null}
 */
function findMessageArray(payload) {
  const roots = collectRoots(payload)
  for (const root of roots) {
    if (looksLikeMessageArray(root)) return root
    if (!isRecord(root)) continue
    for (const key of MESSAGE_ARRAY_KEYS) {
      const value = readField(root, [key])
      if (looksLikeMessageArray(value)) return value
    }
  }
  for (const root of roots) {
    if (!isRecord(root)) continue
    for (const key of Object.keys(root)) {
      const value = root[key]
      if (looksLikeMessageArray(value)) return value
    }
  }
  return null
}

/**
 * @param {unknown} value
 * @returns {'user'|'assistant'|null}
 */
function roleFromToken(value) {
  const token = normalizeToken(value)
  if (token === 'user' || token === 'human') return 'user'
  if (token === 'assistant' || token === 'ai' || token === 'bot' || token === 'model' || token === 'chatbot') {
    return 'assistant'
  }
  return null
}

/**
 * Fragment types encode the turn direction: REQUEST is what the user sent,
 * RESPONSE is what the model answered.
 *
 * @param {unknown} value
 * @returns {'user'|'assistant'|null}
 */
function roleFromFragmentType(value) {
  const token = normalizeToken(value)
  if (token === 'request') return 'user'
  if (token === 'response') return 'assistant'
  return null
}

/**
 * @param {unknown} value
 * @returns {'user'|'assistant'|null}
 */
function roleFromAnyTypeToken(value) {
  const direct = roleFromFragmentType(value)
  if (direct !== null) return direct
  return roleFromToken(value)
}

/**
 * Derive the transcript role of one raw record.
 *
 * Order is contractual: explicit `role`, then message `type`, then fragments.
 * An explicit-but-unknown role (SYSTEM, SERVICE, TOOL, ...) returns null instead
 * of falling through: guessing there would invent transcript turns.
 *
 * @param {object} record
 * @returns {'user'|'assistant'|null}
 */
function deriveRole(record) {
  const roleValue = readField(record, ROLE_KEYS)
  if (roleValue !== undefined && normalizeToken(roleValue) !== '') return roleFromToken(roleValue)

  const typeRole = roleFromAnyTypeToken(readField(record, TYPE_KEYS))
  if (typeRole !== null) return typeRole

  const single = readField(record, FRAGMENT_SINGLE_KEYS)
  if (isRecord(single)) {
    const fromSingle = roleFromAnyTypeToken(single.type)
    if (fromSingle !== null) return fromSingle
  }

  const fragments = readField(record, FRAGMENT_LIST_KEYS)
  if (Array.isArray(fragments)) {
    for (const fragment of fragments) {
      if (!isRecord(fragment)) continue
      const fromFragment = roleFromAnyTypeToken(fragment.type)
      if (fromFragment !== null) return fromFragment
    }
  }
  return null
}

/**
 * @param {object} fragment
 * @returns {boolean} true when the fragment carries hidden reasoning
 */
function isReasoningFragment(fragment) {
  if (!isRecord(fragment)) return true
  if (REASONING_TYPE_SET.has(normalizeToken(fragment.type))) return true
  for (const key of Object.keys(fragment)) {
    if (!REASONING_FLAG_SET.has(normalizeToken(key))) continue
    if (isTruthyFlag(fragment[key])) return true
  }
  return false
}

/**
 * @param {object} record
 * @returns {object[]} the single legacy fragment plus the `fragments` array, in order
 */
function collectFragments(record) {
  const fragments = []
  const single = readField(record, FRAGMENT_SINGLE_KEYS)
  if (isRecord(single)) fragments.push(single)
  const list = readField(record, FRAGMENT_LIST_KEYS)
  if (Array.isArray(list)) {
    for (const fragment of list) {
      if (isRecord(fragment)) fragments.push(fragment)
    }
  }
  return fragments
}

/**
 * @param {object} fragment
 * @returns {string} fragment text from `content` or the legacy `text` field
 */
function fragmentText(fragment) {
  if (typeof fragment.content === 'string') return fragment.content
  if (typeof fragment.text === 'string') return fragment.text
  return ''
}

/**
 * Whether a fragment contributes transcript text.
 *
 * The DeepSeek transcript is built from `REQUEST`/`RESPONSE` fragments; every other type
 * is protocol (search status, tool traffic, files). Listing the protocol types one by one
 * failed in practice — an unknown search variant leaked "Found 28 web pages" into the
 * archive — so the rule is inverted: a typed fragment must be a text type, and an untyped
 * legacy fragment is still text.
 *
 * @param {object} fragment
 * @returns {boolean}
 */
function isTextFragment(fragment) {
  const token = normalizeToken(fragment.type)
  if (token === '') return true
  return TEXT_FRAGMENT_TYPES.includes(token)
}

/**
 * Build markdown-ready text: `content` when it has visible characters, else the
 * non-hidden fragments joined in array order. Only the outer edges are trimmed,
 * so intentional formatting inside the message survives.
 *
 * @param {object} record
 * @returns {string} '' when the record has no visible text
 */
function extractMessageText(record) {
  const content = readField(record, ['content'])
  if (typeof content === 'string' && content.trim() !== '') return content.trim()

  const parts = []
  for (const fragment of collectFragments(record)) {
    if (isReasoningFragment(fragment)) continue
    if (!isTextFragment(fragment)) continue
    const part = fragmentText(fragment).trim()
    if (part !== '') parts.push(part)
  }
  return parts.join('\n\n').trim()
}

/**
 * @param {unknown} record one raw history entry
 * @returns {object|null} NormalizedMessage, or null when the record must be dropped
 */
function toNormalizedMessage(record) {
  if (!isRecord(record)) return null
  if (isReasoningRecord(record)) return null

  const role = deriveRole(record)
  if (role === null) return null

  const text = extractMessageText(record)
  if (text === '') return null

  const message = {
    id: toIdentifier(readField(record, MESSAGE_ID_KEYS)) ?? '',
    role,
    text
  }
  const createdAt = toEpochMs(readField(record, MESSAGE_CREATED_KEYS))
  if (createdAt !== undefined) message.createdAt = createdAt
  return message
}

/**
 * @param {object} chat NormalizedChat-ish object
 * @returns {number} sort key: newest known timestamp, 0 when unknown
 */
function chatSortKey(chat) {
  if (typeof chat.updatedAt === 'number') return chat.updatedAt
  if (typeof chat.createdAt === 'number') return chat.createdAt
  return 0
}

/**
 * Turn any chat-list response into the normalized, de-duplicated, newest-first
 * list the Host expects.
 *
 * @param {unknown} payload raw chat-list response (parsed JSON)
 * @returns {Array<{chatId: string, title: string, sourceUrl: string,
 *   createdAt: number|undefined, updatedAt: number|undefined}>}
 */
export function normalizeChatList(payload) {
  const records = findChatArray(payload)
  if (records === null) return []

  const byId = new Map()
  for (const record of records) {
    if (!isRecord(record)) continue
    const chatId = toIdentifier(readField(record, CHAT_ID_KEYS))
    if (chatId === undefined) continue

    const title = toTrimmedString(readField(record, CHAT_TITLE_KEYS))
    const createdAt = toEpochMs(readField(record, CHAT_CREATED_KEYS))
    const updatedAt = toEpochMs(readField(record, CHAT_UPDATED_KEYS))

    const known = byId.get(chatId)
    if (known !== undefined) {
      // The same session can show up on two pages of the endpoint: keep the
      // first position (payload order is meaningful) and only fill fields that
      // copy left empty.
      if (known.title === '' && title !== '') known.title = title
      if (known.createdAt === undefined && createdAt !== undefined) known.createdAt = createdAt
      if (known.updatedAt === undefined && updatedAt !== undefined) known.updatedAt = updatedAt
      continue
    }
    byId.set(chatId, {
      chatId,
      title,
      sourceUrl: CHAT_URL_BASE + chatId,
      createdAt,
      updatedAt
    })
  }

  const chats = []
  for (const chat of byId.values()) chats.push(chat)
  // Descending recency; Equal keys keep payload order (Array#sort is stable).
  chats.sort((left, right) => chatSortKey(right) - chatSortKey(left))
  return chats
}

/**
 * @param {unknown} item candidate source entry
 * @returns {{url: string, title: string}|null} usable reference, http(s) only
 */
function toReference(item) {
  if (!isRecord(item)) return null
  const url = toTrimmedString(readField(item, REFERENCE_URL_KEYS))
  if (!/^https?:\/\/[^\s]+$/iu.test(url)) return null
  const title = toTrimmedString(readField(item, REFERENCE_TITLE_KEYS))
  return { url, title: title === '' ? url : title }
}

/**
 * @param {unknown} container message record or fragment
 * @returns {Array<{url: string, title: string}>} references declared on it
 */
function referencesOf(container) {
  const out = []
  if (!isRecord(container)) return out
  for (const key of REFERENCE_CONTAINER_KEYS) {
    const value = readField(container, [key])
    if (Array.isArray(value)) {
      for (const item of value) {
        const reference = toReference(item)
        if (reference !== null) out.push(reference)
      }
      continue
    }
    // Some payloads deliver the list as a JSON string.
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const reference = toReference(item)
            if (reference !== null) out.push(reference)
          }
        }
      } catch (error) {
        // Not a serialized list: nothing to add.
      }
    }
  }
  return out
}

/**
 * @param {Array<{url: string, title: string}>} references
 * @returns {Array<{url: string, title: string}>} first occurrence per URL, order kept
 */
function dedupeReferences(references) {
  const seen = new Set()
  const out = []
  for (const reference of references) {
    if (seen.has(reference.url)) continue
    seen.add(reference.url)
    out.push(reference)
  }
  return out
}

/**
 * Collect the sources of one answer set, in payload order.
 *
 * The numbering used by inline markers (`[reference:0]`) is positional over this list,
 * which is why the walk is ordered: messages, then their fragments, then payload-level
 * containers.
 *
 * @param {unknown} payload raw history response (parsed JSON)
 * @returns {Array<{url: string, title: string}>} deduplicated http(s) sources
 */
export function collectReferences(payload) {
  const collected = []
  const records = findMessageArray(payload)
  if (records !== null) {
    for (const record of records) {
      collected.push(...referencesOf(record))
      for (const fragment of collectFragments(record)) collected.push(...referencesOf(fragment))
    }
  }
  for (const root of collectRoots(payload)) collected.push(...referencesOf(root))
  return dedupeReferences(collected)
}

/**
 * @param {string} text answer text with inline markers
 * @param {Array<{url: string, title: string}>} references positional source list
 * @returns {string} text where resolvable markers became numbered Markdown links
 */
function linkReferenceMarkers(text, references) {
  return text.replace(REFERENCE_MARKER, (match, index) => {
    const position = Number(index)
    const reference = references[position]
    return reference === undefined ? match : `[${position + 1}](${reference.url})`
  })
}

/**
 * @param {Array<{url: string, title: string}>} references
 * @returns {string} numbered Markdown list, one link per source
 */
function renderReferenceList(references) {
  const lines = []
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]
    const label = reference.title.replace(/[[\]]/gu, '').replace(/\s+/gu, ' ').trim()
    lines.push(`${index + 1}. [${label === '' ? reference.url : label}](${reference.url})`)
  }
  return lines.join('\n')
}

/**
 * Turn any history response into the chronological message list with hidden
 * reasoning, non-transcript roles and empty turns removed.
 *
 * Sources are preserved, not dropped: inline `[reference:N]` markers become numbered
 * links, and the answer set gets a trailing `**Источники:**` list with every URL. They are
 * rendered into the text of the final answer, so the archive keeps them without changing
 * the Host contract.
 *
 * @param {unknown} payload raw history response (parsed JSON)
 * @returns {Array<{id: string, role: 'user'|'assistant', text: string, createdAt?: number}>}
 */
export function normalizeHistory(payload) {
  const records = findMessageArray(payload)
  if (records === null) return []

  const messages = []
  for (const record of records) {
    const message = toNormalizedMessage(record)
    if (message !== null) messages.push(message)
  }

  const references = collectReferences(payload)
  if (references.length === 0 || messages.length === 0) return messages

  for (const message of messages) message.text = linkReferenceMarkers(message.text, references)
  const target = messages.filter((message) => message.role === 'assistant').pop()
  if (target !== undefined) {
    target.text = `${target.text}\n\n${REFERENCE_HEADING}\n\n${renderReferenceList(references)}`
  } else {
    // A source-less answer set still deserves its links; keep them on the last message.
    const last = messages[messages.length - 1]
    last.text = `${last.text}\n\n${REFERENCE_HEADING}\n\n${renderReferenceList(references)}`
  }
  return messages
}

/**
 * True when a record is a reasoning/thinking artifact rather than user-visible
 * transcript text.
 *
 * The decisive rule is *visible text first*: a normal assistant answer arrives as
 * `fragments: [{type:'RESPONSE',…}, {type:'THINK',…}]`, so the presence of a reasoning
 * fragment says nothing about the record as a whole — the hidden fragment is removed
 * from the text by {@link extractMessageText}, not the message from the transcript.
 * Only a record with no visible text at all and with reasoning payload is dropped.
 *
 * @param {unknown} record one raw history entry
 * @returns {boolean}
 */
export function isReasoningRecord(record) {
  if (!isRecord(record)) return false

  // Protocol markers that make the whole record hidden.
  for (const key of Object.keys(record)) {
    if (!REASONING_FLAG_SET.has(normalizeKey(key))) continue
    if (isTruthyFlag(record[key])) return true
  }
  if (REASONING_TYPE_SET.has(normalizeToken(readField(record, TYPE_KEYS)))) return true

  // Anything with visible text is a transcript entry; its reasoning fragments are already
  // excluded from that text.
  if (extractMessageText(record) !== '') return false

  // No visible text: drop the record only when it actually carries hidden reasoning.
  const single = readField(record, FRAGMENT_SINGLE_KEYS)
  if (isRecord(single) && isReasoningFragment(single)) return true

  const fragments = readField(record, FRAGMENT_LIST_KEYS)
  if (Array.isArray(fragments)) {
    for (const fragment of fragments) {
      if (isReasoningFragment(fragment)) return true
    }
  }

  const reasoningContent = readField(record, REASONING_CONTENT_KEYS)
  if (typeof reasoningContent === 'string' && reasoningContent.trim() !== '') return true
  for (const key of ['thinking_content', 'thinkingContent']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return true
  }

  return false
}

/**
 * Accounting for one history payload: how many raw records exist, how many survive and
 * where the others went. Diagnostics use it to answer "why is the answer missing?"
 * without exposing any message text.
 *
 * @param {unknown} payload raw history response (parsed JSON)
 * @returns {{found: boolean, records: number, kept: number, users: number,
 *   assistants: number, dropped: {reasoning: number, role: number, empty: number,
 *   notRecord: number}}}
 */
export function explainHistory(payload) {
  const dropped = { reasoning: 0, role: 0, empty: 0, notRecord: 0 }
  const fragmentTypes = {}
  const empty = { found: false, records: 0, kept: 0, users: 0, assistants: 0, dropped, fragmentTypes, sources: 0 }
  const records = findMessageArray(payload)
  if (records === null) return empty
  let kept = 0
  let users = 0
  let assistants = 0
  for (const record of records) {
    if (!isRecord(record)) {
      dropped.notRecord += 1
      continue
    }
    // Census of fragment types: it shows which fragments the payload actually carries,
    // which is how a missing link or a leaked status line gets explained.
    for (const fragment of collectFragments(record)) {
      const token = normalizeToken(fragment.type === undefined ? '<none>' : fragment.type)
      const key = token === '' ? '<none>' : token
      fragmentTypes[key] = (fragmentTypes[key] ?? 0) + 1
    }
    if (isReasoningRecord(record)) {
      dropped.reasoning += 1
      continue
    }
    const role = deriveRole(record)
    if (role === null) {
      dropped.role += 1
      continue
    }
    if (extractMessageText(record) === '') {
      dropped.empty += 1
      continue
    }
    kept += 1
    if (role === 'user') users += 1
    else assistants += 1
  }
  return { found: true, records: records.length, kept, users, assistants, dropped, fragmentTypes, sources: collectReferences(payload).length }
}

/**
 * @param {string} text candidate JSON, already trimmed
 * @returns {{ok: boolean, value: unknown}}
 */
function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, value: undefined }
  }
}

/**
 * Drop anti-hijack preambles: `)]}'` (Google XSSI) and `for(;;);` (Facebook)
 * exist only to break script-inclusion parsing, never to carry data. Looped,
 * because a proxy can add one in front of the other.
 *
 * @param {string} text
 * @returns {string}
 */
function stripAntiHijackPrefixes(text) {
  let out = text.trim()
  for (let guard = 0; guard < 4; guard += 1) {
    const previous = out
    if (out.startsWith(")]}'")) out = out.slice(4).trim()
    const loopGuard = /^for\s*\(\s*;\s*;\s*\)\s*;/.exec(out)
    if (loopGuard !== null) out = out.slice(loopGuard[0].length).trim()
    if (out === previous) break
  }
  return out
}

/**
 * Slice from the first JSON brace/bracket to the last closing one. Fallback for
 * bodies with text wrapped around the payload.
 *
 * @param {string} text
 * @returns {string|null}
 */
function sliceJsonPayload(text) {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  let start = -1
  if (objectStart === -1) start = arrayStart
  else if (arrayStart === -1) start = objectStart
  else start = Math.min(objectStart, arrayStart)
  if (start === -1) return null
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (end <= start) return null
  return text.slice(start, end + 1)
}

/**
 * Tolerantly parse a response body that may be plain JSON, SSE frames, or JSON
 * behind an anti-hijack prefix. Callers treat `undefined` as "no usable body".
 *
 * @param {unknown} bodyText raw response text
 * @returns {unknown} parsed value, or `undefined` when nothing parses
 */
export function extractJsonText(bodyText) {
  if (typeof bodyText !== 'string') return undefined
  const text = bodyText.replace(/^\uFEFF/, '').trim()
  if (text === '') return undefined

  const direct = tryParseJson(stripAntiHijackPrefixes(text))
  if (direct.ok) return direct.value

  // SSE bodies keep the payload on `data:` lines (often several, usually ending
  // with `[DONE]`). Walk them backwards: the last frame that parses is the one
  // the caller wants, because earlier frames can be empty heartbeats (`data: {}`).
  const frames = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = /^data\s*:/i.exec(trimmed)
    if (match === null) continue
    const frame = trimmed.slice(match[0].length).trim()
    if (frame === '' || frame === '[DONE]') continue
    frames.push(frame)
  }
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(stripAntiHijackPrefixes(frames[index]))
    if (parsed.ok) return parsed.value
  }

  const sliced = sliceJsonPayload(stripAntiHijackPrefixes(text))
  if (sliced !== null) {
    const parsed = tryParseJson(sliced)
    if (parsed.ok) return parsed.value
  }
  return undefined
}

/**
 * DeepSeek answers business errors with HTTP 200 and an envelope
 * `{"code": <non-zero>, "msg": "...", "data": null}` — verified against the live
 * origin on 2026-10-27:
 *
 *   GET /api/v0/users/current              -> {"code":40002,"msg":"Missing Token","data":null}
 *   GET /api/v0/chat_session/fetch_page    -> {"code":40003,"msg":"INVALID_TOKEN","data":null}
 *   GET /api/v0/chat/history_messages      -> {"code":40003,"msg":"INVALID_TOKEN","data":null}
 *
 * A caller that trusts `response.ok` therefore treats an authentication failure as an
 * empty result list. This helper turns that envelope into an explicit failure.
 *
 * @param {unknown} payload parsed response body
 * @returns {{code: number|string, message: string}|undefined} failure, or undefined when
 *   the payload carries no envelope error
 */
export function deepseekFailure(payload) {
  if (!isRecord(payload)) return undefined
  const rawCode = payload.code
  if (rawCode === undefined || rawCode === null) return undefined
  const numeric = typeof rawCode === 'number' ? rawCode : Number(rawCode)
  const code = Number.isFinite(numeric) ? numeric : rawCode
  if (code === 0 || code === '0' || code === '') return undefined
  const data = payload.data
  // A successful answer may still carry a message; only a payload without data is an error.
  if (data !== undefined && data !== null) return undefined
  const messages = [payload.msg, payload.message, payload.error_msg, payload.detail]
  const text = messages.find((value) => typeof value === 'string' && value.trim() !== '')
  return {
    code,
    message: typeof text === 'string' ? text.trim() : 'request rejected by chat.deepseek.com',
  }
}

/** Envelope codes that mean "this session is not usable", not "retry later". */
const AUTH_FAILURE_CODES = new Set([40001, 40002, 40003, 40004, 40005])

/**
 * @param {{code: number|string, message: string}|undefined} failure value from {@link deepseekFailure}
 * @returns {boolean} whether the failure is an authentication/session problem
 */
export function isAuthFailure(failure) {
  if (failure === undefined) return false
  const numeric = typeof failure.code === 'number' ? failure.code : Number(failure.code)
  if (Number.isFinite(numeric) && AUTH_FAILURE_CODES.has(numeric)) return true
  return /token|auth|unauthor|log\s?in|sign\s?in|session/i.test(failure.message)
}

