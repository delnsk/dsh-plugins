/**
 * Wiring test for the generated browser artifact.
 *
 * It cannot render React (the Host has no React installation and the browser module
 * table lives in the page), but it can prove the three things a silent client failure
 * would break: the artifact still parses, the loader handshake returns the documented
 * exports, and `apply` registers the `main` panel key plus its matching
 * `sidebar.panellist` entry. It also fails when `client.js` is stale against its sources.
 *
 * Run: node test/client-wiring.test.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { buildClientSource } from '../scripts/build-client.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const readArtifact = () => readFile(join(root, 'client.js'), 'utf8')

const fakeReact = {
  createElement: () => ({ type: 'element' }),
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (callback) => callback,
  useMemo: (factory) => factory(),
}

const loadFactory = async () => {
  const source = await readArtifact()
  let captured
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          captured = entry
        },
      },
    },
    console: { log() {}, error() {}, warn() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: () => Promise.reject(new Error('offline test')),
    URL,
    globalThis: undefined,
  })
  context.globalThis = context
  vm.runInContext(source, context)
  assert.ok(captured !== undefined, 'client.js must call window.__ModuleLoader__.load')
  assert.equal(captured.id, '@local/dsh-deepseek-chat-exporter', 'module id must equal the package name')
  assert.equal(typeof captured.factory, 'function', 'entry must expose a factory')
  return captured.factory((specifier) => {
    assert.equal(specifier, 'react', `unexpected module request: ${specifier}`)
    return fakeReact
  })
}

const createContext = () => {
  const slots = []
  const disposers = []
  const localeRegistrations = []
  const ctx = {
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    locale: {
      bind: () => (key) => key,
      register: (...args) => {
        localeRegistrations.push(args)
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register: (options) => {
        slots.push(options)
        return () => {}
      },
    },
  }
  return { ctx, slots, disposers, localeRegistrations }
}

test('client.js is up to date with its sources', async () => {
  const expected = await buildClientSource()
  const actual = await readArtifact()
  assert.equal(actual, expected, 'client.js is stale: run node scripts/build-client.mjs')
})

test('factory exports the plugin shape the Client loader expects', async () => {
  const module = await loadFactory()
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual([...module.inject], ['slots', 'locale'])
})

test('apply registers the main panel key and its sidebar entry', async () => {
  const module = await loadFactory()
  const { ctx, slots, disposers } = createContext()
  module.apply(ctx)
  const main = slots.find((entry) => entry.name === 'main')
  const panellist = slots.find((entry) => entry.name === 'sidebar.panellist')
  assert.ok(main !== undefined, 'main panel must be registered')
  assert.equal(main.key, 'deepseek-chat-exporter')
  assert.ok(panellist !== undefined, 'sidebar.panellist entry must be registered')
  assert.equal(panellist.id, main.key, 'sidebar id must address the main panel key')
  assert.equal(typeof panellist.label, 'function', 'sidebar label must be a thunk for live locale')
  for (const dispose of disposers) dispose()
})

test('apply registers the copy namespace in every shipped locale', async () => {
  const module = await loadFactory()
  const { ctx, disposers, localeRegistrations } = createContext()
  module.apply(ctx)
  const namespaces = localeRegistrations.map((args) => args[0])
  assert.ok(namespaces.every((value) => value === 'deepseek-chat-exporter'), 'copy must use one namespace')
  const locales = localeRegistrations.flatMap((args) => (args.length === 3 ? [args[1]] : Object.keys(args[1])))
  for (const expected of ['en', 'zh', 'ru']) assert.ok(locales.includes(expected), `missing locale: ${expected}`)
  for (const dispose of disposers) dispose()
})
