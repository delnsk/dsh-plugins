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

    /* __INLINE_CONTINUE__ */

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
