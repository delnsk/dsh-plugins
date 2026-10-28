import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * Node harness for the generated Client bundle.
 *
 * The DSH client loader consumes one classic script per package
 * (`window.__ModuleLoader__.load({ id, factory })`), so the bundle is evaluated in
 * a VM context with a fake loader, a minimal React hook runtime, and a fake
 * Cordis context. This proves the artifact registers the right slot entry and
 * that the entry renders/behaves for the decisions the shared helpers make.
 */

const CLIENT_URL = new URL('../client.js', import.meta.url)

/* ------------------------------------------------------------------- react --- */

function sameDeps(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createFakeReact() {
  let active = null

  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged, __element: true }
    },
    Fragment: Symbol.for('Fragment'),
    useState(initial) {
      const state = active
      const index = state.index
      state.index += 1
      if (!(index in state.hooks)) state.hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(state.hooks[index]) : next
        if (Object.is(value, state.hooks[index])) return
        state.hooks[index] = value
        state.dirty = true
        state.schedule()
      }
      return [state.hooks[index], set]
    },
    useEffect(effect, deps) {
      const state = active
      const index = state.index
      state.index += 1
      const previous = state.effects[index]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      state.pending.push({ index, effect, deps })
    },
  }

  function commit(state) {
    while (state.pending.length > 0) {
      const { index, effect, deps } = state.pending.shift()
      const previous = state.effects[index]
      if (previous !== undefined && typeof previous.cleanup === 'function') {
        try {
          previous.cleanup()
        } catch {
          /* cleanup errors are not the assertion target */
        }
      }
      const cleanup = effect()
      state.effects[index] = { deps, cleanup }
    }
  }

  function createRoot(Component, props) {
    const state = {
      index: 0,
      hooks: [],
      effects: [],
      pending: [],
      dirty: false,
      tree: null,
      props,
      schedule() {
        if (state.scheduled === true) return
        state.scheduled = true
        queueMicrotask(() => {
          state.scheduled = false
          if (state.dirty !== true) return
          state.dirty = false
          render()
        })
      },
    }
    function render() {
      state.index = 0
      state.pending = []
      active = state
      try {
        state.tree = Component(props)
      } finally {
        active = null
      }
      commit(state)
      return state.tree
    }
    return {
      render,
      get tree() {
        return state.tree
      },
      get hooks() {
        return state.hooks
      },
    }
  }

  return { React, createRoot }
}

/* ---------------------------------------------------------------- fake ctx --- */

function createFakeLocale() {
  const namespaces = new Map()
  return {
    namespaces,
    register(namespace, languageOrDictionaries, dictionary) {
      const store = namespaces.get(namespace) ?? {}
      if (typeof languageOrDictionaries === 'string') {
        store[languageOrDictionaries] = { ...(store[languageOrDictionaries] ?? {}), ...dictionary }
      } else {
        for (const [language, value] of Object.entries(languageOrDictionaries)) {
          store[language] = { ...(store[language] ?? {}), ...value }
        }
      }
      namespaces.set(namespace, store)
      return () => {}
    },
    bind(namespace) {
      const store = namespaces.get(namespace) ?? {}
      const active = store.ru ?? store.en ?? {}
      const fallback = store.en ?? {}
      return (key, values) => {
        const template = active[key] ?? fallback[key] ?? key
        if (values === undefined) return template
        return template.replace(/\{(\w+)\}/gu, (match, name) => (values[name] === undefined ? match : String(values[name])))
      }
    },
  }
}

function createFakeContext({ services = {} } = {}) {
  const registrations = []
  const disposers = []
  const locale = createFakeLocale()
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    locale,
    slots: {
      inject(name, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    get(name) {
      return services[name]
    },
  }
  return { ctx, registrations, disposers, locale }
}

/* -------------------------------------------------------------- fake loader --- */

async function loadClientBundle({ fetchImpl } = {}) {
  const source = await readFile(fileURLToPath(CLIENT_URL), 'utf8')
  let definition
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(candidate) {
          definition = candidate
        },
      },
    },
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition !== undefined, 'client.js must register itself with __ModuleLoader__')
  return definition
}

const silentFetch = async () => ({
  status: 200,
  async text() {
    return JSON.stringify({
      ok: true,
      value: { prompt: null, triggerOn: ['error', 'interrupted', 'aborted'], diagnostics: true },
    })
  },
})

/* ----------------------------------------------------------------- fixtures --- */

const errorTurn = (number, code = 'PROVIDER_ERROR') => ({
  turn: number,
  status: 'closed',
  start: { seq: 1, time: 0, data: { turn: number } },
  end: { seq: 9, time: 10, data: { turn: number, reason: { kind: 'error', error: { message: 'boom', code } } } },
  steps: [],
  data: new Map(),
})

const abortTurn = (number) => ({
  turn: number,
  status: 'closed',
  start: { seq: 1, time: 0, data: { turn: number } },
  end: { seq: 9, time: 10, data: { turn: number, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
  steps: [],
  data: new Map(),
})

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  if (node.props !== undefined) walk(node.props.children, visit)
}

function findButton(tree) {
  let found
  walk(tree, (node) => {
    if (found === undefined && node.props !== undefined && node.props.className === 'dshca-button') found = node
  })
  return found
}

function labelOf(tree) {
  const parts = []
  const visit = (node) => {
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node !== null && typeof node === 'object') visit(node.props?.children)
  }
  visit(tree)
  return parts.join(' ')
}

/* -------------------------------------------------------------------- tests --- */

test('bundle registers the id, the locale dictionaries and the turnTail entry', async () => {
  const definition = await loadClientBundle({ fetchImpl: silentFetch })
  assert.equal(definition.id, '@local/dsh-plugin-continue-after-error')
  const { React } = createFakeReact()
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'sessions'])

  const { ctx, registrations, locale } = createFakeContext()
  plugin.apply(ctx)
  assert.equal(registrations.length, 1)
  const entry = registrations[0]
  assert.equal(entry.options.name, 'conversation.chat.turnTail')
  assert.equal(entry.options.id, 'continue-after-error')
  assert.equal(entry.options.order, 20)
  assert.equal(entry.options.locale, 'continue-after-error')
  assert.equal(typeof entry.component, 'function')

  const copy = locale.namespaces.get('continue-after-error')
  assert.equal(copy.ru['continue.label'], 'Продолжить')
  assert.equal(copy.en['continue.label'], 'Continue')
  assert.equal(copy.zh['continue.label'], '继续')
})

test('renders «Продолжить» under the latest failed turn and sends a continuation', async () => {
  const definition = await loadClientBundle({ fetchImpl: silentFetch })
  const { React, createRoot } = createFakeReact()
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })

  const promptCalls = []
  const session = {
    prompt(content, mode) {
      promptCalls.push({ content, mode })
      return Promise.resolve({ ok: true, value: { accepted: true } })
    },
    getSnapshot() {
      return { running: false }
    },
  }
  const services = {
    sessions: { binding: () => ({ session }) },
    conversation: undefined,
  }
  const { ctx, registrations } = createFakeContext({ services })
  plugin.apply(ctx)

  const turn = errorTurn(4)
  const root = createRoot(registrations[0].component, {
    turn,
    sessionId: 'session-1',
    useChat: (selector) => selector({ timeline: { turnOrder: [2, 3, 4] } }),
    useSession: (selector) => selector({ running: false }),
  })
  const tree = root.render()
  const button = findButton(tree)
  assert.ok(button !== undefined, 'expected the Continue button to render')
  assert.equal(button.props.disabled, false)
  assert.match(labelOf(tree), /Продолжить/u)

  button.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(promptCalls.length, 1)
  assert.equal(promptCalls[0].mode, 'queue')
  assert.equal(promptCalls[0].content.length, 1)
  assert.equal(promptCalls[0].content[0].type, 'text')
  assert.equal(
    promptCalls[0].content[0].text,
    'Продолжай с того места, где остановился. Не повторяй уже выполненную работу.',
  )
})

test('renders nothing while the session runs, on an older turn, and after sign-out', async () => {
  const definition = await loadClientBundle({ fetchImpl: silentFetch })
  const { React, createRoot } = createFakeReact()
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  const { ctx, registrations } = createFakeContext()

  const renderFor = (turn, { latestTurn, running = false, code } = {}) => {
    const root = createRoot(registrations[0].component, {
      turn,
      sessionId: 'session-1',
      useChat: (selector) => selector({ timeline: { turnOrder: latestTurn === undefined ? [turn.turn] : latestTurn } }),
      useSession: (selector) => selector({ running }),
    })
    return root.render()
  }

  plugin.apply(ctx)
  assert.equal(renderFor(errorTurn(1), { latestTurn: [2], running: false }), null)
  assert.equal(renderFor(errorTurn(2), { latestTurn: [2], running: true }), null)
  assert.equal(renderFor(errorTurn(3, 'ACCOUNT_SIGNED_OUT'), { latestTurn: [3] }), null)
  assert.ok(findButton(renderFor(errorTurn(5), { latestTurn: [5] })) !== undefined)
})

test('offers the entry after a user stop of a hung turn', async () => {
  const definition = await loadClientBundle({ fetchImpl: silentFetch })
  const { React, createRoot } = createFakeReact()
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  const { ctx, registrations } = createFakeContext()
  plugin.apply(ctx)

  const root = createRoot(registrations[0].component, {
    turn: abortTurn(7),
    sessionId: 'session-1',
    useChat: (selector) => selector({ timeline: { turnOrder: [7] } }),
    useSession: (selector) => selector({ running: false }),
  })
  const tree = root.render()
  const button = findButton(tree)
  assert.ok(button !== undefined, 'expected the Continue button after a stop')
  assert.match(labelOf(tree), /Продолжить/u)
})
