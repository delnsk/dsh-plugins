/**
 * Regression test for the endpoint fallback inside one logical request.
 *
 * Live evidence (2026-10-28, real account): the very same credential is accepted by
 * `GET /api/v0/chat_session/fetch_page?count=100` (200, 100 chats) and refused by
 * `POST /api/v0/chat_session/fetch_page?count=100` (200, `{"code":40003,"msg":"INVALID_TOKEN"}`).
 * The client used to treat that in-body refusal as "the session is dead" and aborted the
 * request before trying the next endpoint, so a valid session produced
 * "chat.deepseek.com rejected the session".
 *
 * Run: node test/endpoint-ladder.test.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const fakeReact = {
  createElement: () => ({ type: 'element' }),
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (callback) => callback,
  useMemo: (factory) => factory(),
}

/** Load the built artifact and return its module exports, including the test seam. */
const loadModule = async () => {
  const source = await readFile(join(root, 'client.js'), 'utf8')
  let captured
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: (entry) => { captured = entry } } },
    console: { log() {}, error() {}, warn() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: () => Promise.reject(new Error('offline test')),
    URL,
  })
  context.globalThis = context
  vm.runInContext(source, context)
  assert.ok(captured !== undefined, 'client.js must call window.__ModuleLoader__.load')
  return captured.factory((specifier) => {
    assert.equal(specifier, 'react', `unexpected module request: ${specifier}`)
    return fakeReact
  })
}

/** A guest whose `executeJavaScript` answers from the supplied queue, in call order. */
const createGuest = (answers) => {
  const calls = []
  return {
    calls,
    element: {
      executeJavaScript: async (code) => {
        calls.push(code)
        const next = answers.shift()
        if (next === undefined) throw new Error('no canned answer left')
        return next
      },
    },
  }
}

const envelope = (code, message) => ({ status: 200, ok: true, text: JSON.stringify({ code, msg: message, data: null }) })
const listed = (count) => ({
  status: 200,
  ok: true,
  text: JSON.stringify({ code: 0, msg: '', data: { biz_data: { chat_sessions: Array.from({ length: count }, (_, index) => ({ id: `chat-${index}`, title: `Chat ${index}` })) } } }),
})

const api = { base: 'https://chat.deepseek.com' }
const listEndpoints = [
  { method: 'POST', path: '/api/v0/chat_session/fetch_page?count=100', body: '{}' },
  { method: 'GET', path: '/api/v0/chat_session/fetch_page?count=100' },
]

test('a refused endpoint does not abort the request while another one can answer', async () => {
  const module = await loadModule()
  const guest = createGuest([envelope(40003, 'INVALID_TOKEN'), listed(100)])
  const result = await module.__test.requestWithCandidates(guest.element, api, listEndpoints, undefined, undefined)
  assert.equal(guest.calls.length, 2, 'the GET endpoint must be attempted after the POST refusal')
  assert.match(result.request.label, /^GET /u)
  assert.equal(result.parsed.data.biz_data.chat_sessions.length, 100)
})

test('every endpoint refusing the credential still reports an auth failure', async () => {
  const module = await loadModule()
  const guest = createGuest([envelope(40003, 'INVALID_TOKEN'), envelope(40003, 'INVALID_TOKEN')])
  await assert.rejects(
    () => module.__test.requestWithCandidates(guest.element, api, listEndpoints, undefined, undefined),
    (error) => {
      assert.equal(error.authFailure, true)
      assert.equal(error.endpointFailures.length, 2)
      assert.match(error.message, /INVALID_TOKEN/u)
      return true
    },
  )
})

test('a mixed failure is not reported as an auth failure', async () => {
  const module = await loadModule()
  const guest = createGuest([{ status: 500, ok: false, text: 'boom' }, envelope(40003, 'INVALID_TOKEN')])
  await assert.rejects(
    () => module.__test.requestWithCandidates(guest.element, api, listEndpoints, undefined, undefined),
    (error) => {
      assert.equal(error.authFailure, false, 'only a full sweep of auth refusals is an auth failure')
      assert.match(error.message, /HTTP 500/u)
      return true
    },
  )
})

test('a non-JSON answer falls through to the next endpoint', async () => {
  const module = await loadModule()
  const guest = createGuest([{ status: 200, ok: true, text: '<html>challenge</html>' }, listed(2)])
  const result = await module.__test.requestWithCandidates(guest.element, api, listEndpoints, undefined, undefined)
  assert.match(result.request.label, /^GET /u)
  assert.equal(result.parsed.data.biz_data.chat_sessions.length, 2)
})

test('an empty endpoint list fails loudly instead of pretending success', async () => {
  const module = await loadModule()
  const guest = createGuest([])
  await assert.rejects(
    () => module.__test.requestWithCandidates(guest.element, api, [], undefined, undefined),
    (error) => {
      assert.match(error.message, /no usable endpoint/u)
      assert.equal(error.authFailure, false)
      return true
    },
  )
})
