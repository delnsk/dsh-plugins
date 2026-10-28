/**
 * Pure decision helpers for the "Продолжить" entry.
 *
 * This module is shared by two consumers:
 *  - the node tests, which import it directly;
 *  - the Client half, where `scripts/build-client.mjs` inlines it verbatim at the
 *    `__INLINE_CONTINUE__` marker (the DSH client loader accepts one classic
 *    script per package, so shared code cannot be imported there).
 *
 * Rules: no imports, no browser or node globals, no side effects. Every exported
 * function must stay callable from a plain `node --test` run.
 */

/** Stop reasons after which one click should be able to resume the work. */
export const DEFAULT_TRIGGER_ON = Object.freeze(['error', 'interrupted', 'aborted'])

/**
 * Failure codes where a plain "continue" cannot help: the account or the quota
 * has to be fixed first. The turn still shows its own failure row.
 */
export const BLOCKING_FAILURE_CODES = Object.freeze([
  'ACCOUNT_SIGNED_OUT',
  'ACCOUNT_SIGN_IN_REQUIRED',
  'QUOTA',
  'ACCOUNT_QUOTA',
])

/** Longest continuation message the Client will send. */
export const MAX_PROMPT_CHARS = 4000

/** Longest failure description rendered under the button. */
export const MAX_ERROR_CHARS = 300

/**
 * Normalize a configured trigger list.
 * @param {unknown} value - raw config value (`triggerOn`).
 * @param {readonly string[]} [fallback] - list used when nothing valid is configured.
 * @returns {string[]} unique, non-empty reason kinds.
 */
export function normalizeTriggerOn(value, fallback = DEFAULT_TRIGGER_ON) {
  const list = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : []
  return list.length === 0 ? [...fallback] : [...new Set(list)]
}

/**
 * The `turn/end` reason carried by a Chat `TurnLocation`.
 * @param {unknown} turn - slot owner currency (`TurnLocation`).
 * @returns {Record<string, unknown> | undefined} reason object, when present.
 */
export function endReasonOf(turn) {
  if (turn === null || typeof turn !== 'object') return undefined
  const end = turn.end
  if (end === null || typeof end !== 'object') return undefined
  const data = end.data
  if (data === null || typeof data !== 'object') return undefined
  const reason = data.reason
  return reason !== null && typeof reason === 'object' ? reason : undefined
}

/**
 * The Turn's stop reason kind (`error`, `aborted`, `interrupted`, `max-tokens`, ...).
 * @param {unknown} turn - slot owner currency.
 * @returns {string | undefined} reason kind.
 */
export function reasonKindOf(turn) {
  const reason = endReasonOf(turn)
  return reason !== undefined && typeof reason.kind === 'string' ? reason.kind : undefined
}

/**
 * The provider/stream failure recorded on a `turn/end` error reason.
 * @param {unknown} turn - slot owner currency.
 * @returns {{ message?: unknown, code?: unknown } | undefined} failure payload.
 */
export function reasonFailure(turn) {
  const reason = endReasonOf(turn)
  if (reason === undefined || reason.kind !== 'error') return undefined
  const error = reason.error
  return error !== null && typeof error === 'object' ? error : undefined
}

/**
 * Structured failure code of a failed Turn (`AUTH`, `QUOTA`, `INTERRUPTED`, ...).
 * @param {unknown} turn - slot owner currency.
 * @returns {string | undefined} failure code.
 */
export function failureCodeOf(turn) {
  const failure = reasonFailure(turn)
  return failure !== undefined && typeof failure.code === 'string' ? failure.code : undefined
}

/**
 * Whether an aborted Turn was aborted because the DeepSeek account signed out.
 * That is a sign-in problem: a continuation would be rejected for the same reason.
 * @param {unknown} turn - slot owner currency.
 * @returns {boolean} true for a signed-out abort.
 */
export function isSignedOutAbort(turn) {
  const reason = endReasonOf(turn)
  if (reason === undefined || reason.kind !== 'aborted') return false
  const nested = reason.reason
  if (nested === null || typeof nested !== 'object') return false
  if (typeof nested.reason !== 'string') return false
  if (nested.kind === 'hook') return /\/signed-out$/u.test(nested.reason)
  return /signed-out/u.test(nested.reason)
}

/**
 * The numeric Turn number of a Chat `TurnLocation`, with tolerant fallbacks for
 * shapes that only carry the number on `turn/end` or in the turn-tail's business data.
 * @param {unknown} turn - slot owner currency.
 * @returns {number | undefined} turn number.
 */
export function turnNumberOf(turn) {
  if (turn === null || typeof turn !== 'object') return undefined
  if (typeof turn.turn === 'number' && Number.isFinite(turn.turn)) return turn.turn
  const endData = turn.end !== null && typeof turn.end === 'object' ? turn.end.data : undefined
  if (endData !== null && typeof endData === 'object' && typeof endData.turn === 'number') return endData.turn
  const tail = typeof turn.data?.get === 'function' ? turn.data.get('turn-tail') : undefined
  if (tail !== null && typeof tail === 'object' && typeof tail.turn === 'number') return tail.turn
  return undefined
}

/**
 * Decide whether the Continue entry belongs under this completed Turn.
 *
 * The entry is offered only for the latest completed Turn of an idle Session and
 * only for a stop reason the profile asked for. Sign-in and quota failures are
 * hidden: the same click would fail again until the account is repaired.
 *
 * @param {object} input - decision input.
 * @param {unknown} input.turn - slot owner currency (`TurnLocation`).
 * @param {unknown} [input.triggerOn] - configured reason kinds.
 * @param {number | undefined} [input.latestTurn] - latest Turn number in the loaded Chat timeline.
 * @param {boolean} [input.running] - whether the Session is running (a new turn already started).
 * @returns {{ kind: string, code?: string } | null} offer, or null to render nothing.
 */
export function offerForTurn({ turn, triggerOn = DEFAULT_TRIGGER_ON, latestTurn, running = false } = {}) {
  if (running === true) return null
  if (turn === null || typeof turn !== 'object') return null
  const turnNumber = turnNumberOf(turn)
  if (turnNumber === undefined) return null
  if (typeof latestTurn === 'number' && latestTurn !== turnNumber) return null
  const kind = reasonKindOf(turn)
  if (kind === undefined) return null
  if (!normalizeTriggerOn(triggerOn).includes(kind)) return null
  if (kind === 'aborted' && isSignedOutAbort(turn)) return null
  const code = failureCodeOf(turn)
  if (code !== undefined && BLOCKING_FAILURE_CODES.includes(code)) return null
  return code === undefined ? { kind } : { kind, code }
}

/**
 * Resolve the text sent when the user presses Continue.
 * @param {object} input - message input.
 * @param {unknown} [input.prompt] - Host-configured override.
 * @param {unknown} [input.fallback] - localized copy from the Client dictionary.
 * @param {number} [input.limit] - hard cap in characters.
 * @returns {string} trimmed continuation text (empty when nothing usable is configured).
 */
export function buildContinueMessage({ prompt, fallback, limit = MAX_PROMPT_CHARS } = {}) {
  for (const candidate of [prompt, fallback]) {
    if (typeof candidate !== 'string') continue
    const text = candidate.trim()
    if (text === '') continue
    return text.length > limit ? text.slice(0, limit) : text
  }
  return ''
}

/**
 * Short single-line description of a send failure (never a structured object).
 * @param {unknown} error - thrown value, `promptError`, or Remote failure.
 * @param {number} [limit] - hard cap in characters.
 * @returns {string} description, possibly empty.
 */
export function describeSendError(error, limit = MAX_ERROR_CHARS) {
  let message = ''
  if (typeof error === 'string') message = error
  else if (error !== null && typeof error === 'object') {
    if (typeof error.message === 'string') message = error.message
    else if (error.error !== null && typeof error.error === 'object' && typeof error.error.message === 'string') message = error.error.message
  }
  message = message.replace(/\s+/gu, ' ').trim()
  if (limit > 0 && message.length > limit) message = `${message.slice(0, limit - 1)}…`
  return message
}
