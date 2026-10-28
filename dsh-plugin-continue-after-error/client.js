// GENERATED FILE — do not edit.
// Source: src/client/main.js + src/shared/continue.js
// Rebuild: node scripts/build-client.mjs
/**
 * Client half of `@local/dsh-plugin-continue-after-error`.
 *
 * Registers one list entry in the Chat target's completed-turn tail
 * (`conversation.chat.turnTail`). The entry renders a localized "Продолжить"
 * button directly under a Turn that stopped on a provider/stream error (or was
 * stopped by the user), and one click sends a continuation message into the
 * same Session so the agent resumes where it left off.
 *
 * Generated into `client.js` by `scripts/build-client.mjs`, which inlines
 * `src/shared/continue.js` at the marker below. The DSH client loader accepts one
 * classic script per package, so shared logic cannot be imported here.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-continue-after-error',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // ---- begin inlined src/shared/continue.js ----
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
const DEFAULT_TRIGGER_ON = Object.freeze(['error', 'interrupted', 'aborted'])

/**
 * Failure codes where a plain "continue" cannot help: the account or the quota
 * has to be fixed first. The turn still shows its own failure row.
 */
const BLOCKING_FAILURE_CODES = Object.freeze([
  'ACCOUNT_SIGNED_OUT',
  'ACCOUNT_SIGN_IN_REQUIRED',
  'QUOTA',
  'ACCOUNT_QUOTA',
])

/** Longest continuation message the Client will send. */
const MAX_PROMPT_CHARS = 4000

/** Longest failure description rendered under the button. */
const MAX_ERROR_CHARS = 300

/**
 * Normalize a configured trigger list.
 * @param {unknown} value - raw config value (`triggerOn`).
 * @param {readonly string[]} [fallback] - list used when nothing valid is configured.
 * @returns {string[]} unique, non-empty reason kinds.
 */
function normalizeTriggerOn(value, fallback = DEFAULT_TRIGGER_ON) {
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
function endReasonOf(turn) {
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
function reasonKindOf(turn) {
  const reason = endReasonOf(turn)
  return reason !== undefined && typeof reason.kind === 'string' ? reason.kind : undefined
}

/**
 * The provider/stream failure recorded on a `turn/end` error reason.
 * @param {unknown} turn - slot owner currency.
 * @returns {{ message?: unknown, code?: unknown } | undefined} failure payload.
 */
function reasonFailure(turn) {
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
function failureCodeOf(turn) {
  const failure = reasonFailure(turn)
  return failure !== undefined && typeof failure.code === 'string' ? failure.code : undefined
}

/**
 * Whether an aborted Turn was aborted because the DeepSeek account signed out.
 * That is a sign-in problem: a continuation would be rejected for the same reason.
 * @param {unknown} turn - slot owner currency.
 * @returns {boolean} true for a signed-out abort.
 */
function isSignedOutAbort(turn) {
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
function turnNumberOf(turn) {
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
function offerForTurn({ turn, triggerOn = DEFAULT_TRIGGER_ON, latestTurn, running = false } = {}) {
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
function buildContinueMessage({ prompt, fallback, limit = MAX_PROMPT_CHARS } = {}) {
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
function describeSendError(error, limit = MAX_ERROR_CHARS) {
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
// ---- end inlined src/shared/continue.js ----

    const NS = 'continue-after-error'
    const ENTRY_ID = 'continue-after-error'
    const RPC_PATH = '/dsh-continue/rpc'
    const STYLE_ID = 'continue-after-error/styles'
    const REPORT_LIMIT = 200

    // ------------------------------------------------------------------ copy ---

    const en = {
      'continue.label': 'Continue',
      'continue.sending': 'Continuing…',
      'continue.prompt':
        'Continue from where you left off. Do not repeat work that is already done.',
      'continue.hint': 'Send a continuation message so the agent resumes this turn',
      'continue.failed': 'Could not continue: {message}',
    }

    const ru = {
      'continue.label': 'Продолжить',
      'continue.sending': 'Продолжаю…',
      'continue.prompt':
        'Продолжай с того места, где остановился. Не повторяй уже выполненную работу.',
      'continue.hint': 'Отправить продолжение, чтобы агент возобновил работу с места остановки',
      'continue.failed': 'Не удалось продолжить: {message}',
    }

    const zh = {
      'continue.label': '继续',
      'continue.sending': '正在继续…',
      'continue.prompt': '从上次中断的地方继续，不要重复已经完成的工作。',
      'continue.hint': '发送续写消息，让智能体从中断处继续',
      'continue.failed': '无法继续：{message}',
    }

    // ----------------------------------------------------------------- config ---

    /** Defaults used until the Host answers (and forever on a Host without the route). */
    let configCurrent = Object.freeze({
      prompt: '',
      triggerOn: [...DEFAULT_TRIGGER_ON],
      diagnostics: true,
    })
    const configListeners = new Set()
    let configLoad

    function publishConfig(next) {
      configCurrent = Object.freeze(next)
      for (const listener of [...configListeners]) {
        try {
          listener(configCurrent)
        } catch {
          /* a broken subscriber must not break the others */
        }
      }
    }

    function subscribeConfig(listener) {
      configListeners.add(listener)
      listener(configCurrent)
      return () => {
        configListeners.delete(listener)
      }
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
        const message = payload?.error?.message ?? `HTTP ${response.status}`
        throw new Error(String(message))
      }
      return payload.value
    }

    function loadConfig() {
      if (configLoad !== undefined) return configLoad
      configLoad = rpc('config', {})
        .then((value) => {
          const next = {
            prompt: typeof value?.prompt === 'string' ? value.prompt : '',
            triggerOn: normalizeTriggerOn(value?.triggerOn),
            diagnostics: value?.diagnostics !== false,
          }
          publishConfig(next)
          report('client-config', { triggerOn: next.triggerOn, diagnostics: next.diagnostics })
          return next
        })
        .catch(() => {
          report('client-config-fallback', {})
          return configCurrent
        })
      return configLoad
    }

    // ------------------------------------------------------------ diagnostics ---

    const reported = new Set()

    /** Fire-and-forget Host diagnostics; never affects the button. */
    function report(event, detail) {
      if (configCurrent.diagnostics !== true) return
      rpc('report', {
        event,
        ...(detail !== undefined && detail !== null && typeof detail === 'object' ? detail : {}),
      }).catch(() => {})
    }

    function reportOnce(key, event, detail) {
      if (reported.has(key)) return
      if (reported.size >= REPORT_LIMIT) return
      reported.add(key)
      report(event, detail)
    }

    // ------------------------------------------------------------------- view ---

    const css = `
.dshca-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px}
.dshca-button{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 11px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.dshca-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshca-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.08))}
.dshca-button:focus-visible{outline:2px solid var(--dsw-alias-label-secondary,#5a5f6a);outline-offset:2px}
.dshca-button:disabled{cursor:default;color:var(--dsw-alias-label-tertiary,#8a8f99)}
.dshca-icon{width:14px;height:14px;flex:none;display:block}
.dshca-error{font-size:12px;line-height:1.35;color:var(--dsw-alias-state-error-primary,#d84a4a);max-width:560px}
@media (prefers-reduced-motion:reduce){.dshca-button{transition:none}}
`

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (existing !== null) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = '@local/dsh-plugin-continue-after-error'
      style.dataset.pluginCss = STYLE_ID
      style.textContent = css
      document.head.appendChild(style)
      return () => {
        style.remove()
      }
    }

    /** Play-triangle glyph meaning "resume". */
    function ResumeIcon() {
      return h(
        'svg',
        {
          className: 'dshca-icon',
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M5.2 3.4a.9.9 0 0 1 1.38-.76l6.1 4.6a.9.9 0 0 1 0 1.52l-6.1 4.6A.9.9 0 0 1 5.2 12.6V3.4Z',
          fill: 'currentColor',
        }),
      )
    }

    /** Small busy dot row shown while the continuation is being admitted. */
    function BusyIcon() {
      return h(
        'svg',
        {
          className: 'dshca-icon',
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { cx: '3.2', cy: '8', r: '1.5', fill: 'currentColor', opacity: '0.35' }),
        h('circle', { cx: '8', cy: '8', r: '1.5', fill: 'currentColor', opacity: '0.65' }),
        h('circle', { cx: '12.8', cy: '8', r: '1.5', fill: 'currentColor' }),
      )
    }

    function selectLatestTurn(snapshot) {
      const order = snapshot?.timeline?.turnOrder
      return Array.isArray(order) && order.length > 0 ? order[order.length - 1] : undefined
    }

    function selectRunning(snapshot) {
      return snapshot !== undefined && snapshot !== null && snapshot.running === true
    }

    /** Resolve the interactive Session and send one continuation prompt into it. */
    async function sendContinuation(ctx, sessionId, text) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined || sessions === null) throw new Error('sessions service is unavailable')
      const binding = sessions.binding(sessionId)
      if (binding === undefined || binding === null) throw new Error(`session "${sessionId}" is not retained`)

      const conversation = ctx.get('conversation')
      if (conversation !== undefined && conversation !== null && typeof conversation.sendSession === 'function') {
        const outcome = await conversation.sendSession(binding.session, text, [], 'queue')
        if (outcome !== undefined && outcome !== null && outcome.kind === 'error') {
          const snapshot = typeof binding.session.getSnapshot === 'function' ? binding.session.getSnapshot() : undefined
          const promptError = snapshot?.promptError
          throw promptError?.error ?? new Error('prompt rejected')
        }
        return
      }

      // Fallback for a composition without the Conversation service: the object-layer
      // prompt is the same call the composer's default sink eventually makes.
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (result === undefined || result === null || result.ok !== true) {
        throw result?.error ?? new Error('prompt rejected')
      }
    }

    function registerContinueEntry(ctx, t) {
      const ContinueTail = function ContinueTail(props) {
        const { turn, sessionId } = props
        // The turnTail seat declares `useChat`/`useSession` as standard props. A foreign
        // composition could mount this entry without them; the entry then degrades to
        // "no latest-turn / idle" instead of breaking the transcript.
        const useChatHook = typeof props.useChat === 'function' ? props.useChat : null
        const useSessionHook = typeof props.useSession === 'function' ? props.useSession : null
        // Stable per mount (props identity does not change), so the hook order is stable.
        const latestTurn = useChatHook === null ? undefined : useChatHook(selectLatestTurn)
        const running = useSessionHook === null ? false : useSessionHook(selectRunning)
        const tr = typeof props.t === 'function' ? props.t : t
        const [config, setConfig] = React.useState(configCurrent)
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState('')

        React.useEffect(() => subscribeConfig(setConfig), [])

        const decision = offerForTurn({
          turn,
          triggerOn: config.triggerOn,
          latestTurn: typeof latestTurn === 'number' ? latestTurn : undefined,
          running,
        })
        const turnNumber = turnNumberOf(turn)
        const visible = decision !== null && typeof sessionId === 'string'

        React.useEffect(() => {
          // Contract probe: once per page, prove which live shape the seat delivered
          // (turn number, turn/end reason, latest-turn and running inputs).
          reportOnce('client-evaluated', 'client-evaluated', {
            sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            turn: typeof turnNumber === 'number' ? turnNumber : undefined,
            kind: reasonKindOf(turn),
            message:
              `latest=${typeof latestTurn === 'number' ? latestTurn : 'n/a'}`
              + ` running=${String(running)}`
              + ` turnNumber=${typeof turnNumber === 'number' ? turnNumber : 'n/a'}`
              + ` reason=${reasonKindOf(turn) ?? 'n/a'}`
              + ` hasEnd=${turn !== null && typeof turn === 'object' && turn.end !== null && turn.end !== undefined}`,
          })
        }, [])

        React.useEffect(() => {
          if (!visible || typeof sessionId !== 'string' || typeof turnNumber !== 'number') return
          reportOnce(`render:${sessionId}:${turnNumber}`, 'client-render', {
            sessionId,
            turn: turnNumber,
            kind: decision?.kind,
          })
        }, [visible, sessionId, turnNumber, decision?.kind])

        if (!visible || typeof sessionId !== 'string') return null

        const label = busy ? tr('continue.sending') : tr('continue.label')
        const hint = tr('continue.hint')
        const onContinue = () => {
          if (busy) return
          const text = buildContinueMessage({ prompt: config.prompt, fallback: tr('continue.prompt') })
          if (text === '') {
            setError(tr('continue.failed', { message: 'empty continuation prompt' }))
            return
          }
          setBusy(true)
          setError('')
          report('continue-click', { sessionId, turn: turnNumber, kind: decision?.kind })
          sendContinuation(ctx, sessionId, text).then(
            () => {
              report('continue-sent', { sessionId, turn: turnNumber })
            },
            (failure) => {
              setBusy(false)
              setError(tr('continue.failed', { message: describeSendError(failure) }))
              report('continue-failed', {
                sessionId,
                turn: turnNumber,
                message: describeSendError(failure),
              })
            },
          )
        }

        return h(
          'div',
          { className: 'dshca-row', 'data-continue-after-error': String(turnNumber) },
          h(
            'button',
            {
              type: 'button',
              className: 'dshca-button',
              disabled: busy,
              title: hint,
              'aria-label': hint,
              onClick: onContinue,
            },
            busy ? h(BusyIcon) : h(ResumeIcon),
            h('span', null, label),
          ),
          error === '' ? null : h('span', { className: 'dshca-error', role: 'alert' }, error),
        )
      }

      return ctx.slots.inject('conversation.chat.turnTail', () => {
        const dispose = ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            id: ENTRY_ID,
            order: 20,
            locale: NS,
          },
          ContinueTail,
        )
        reportOnce('client-registered', 'client-registered', {})
        return dispose
      })
    }

    // ----------------------------------------------------------------- plugin ---

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'continue-after-error: styles')
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'continue-after-error: copy')
      ctx.effect(() => ctx.locale.register(NS, 'ru', ru), 'continue-after-error: copy (ru)')

      const t = ctx.locale.bind(NS)
      loadConfig()
      reportOnce('client-mount', 'client-mount', { version: '1.0.0' })

      registerContinueEntry(ctx, t)
    }

    return { inject: ['slots', 'locale', 'sessions'], apply }
  },
})
