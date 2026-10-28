/**
 * Behaviour test for the credential discovery that runs inside the guest document.
 *
 * The function under test is the real `GUEST_REQUEST` body taken from the built
 * `client.js`; it is executed in this process with fake `window`/`fetch`/`indexedDB`, so the
 * token unwrapping order, the retry ladder (Bearer → raw → cookie-only) and the
 * accept-and-cache rule are verified without Electron or the live site.
 *
 * Run: node test/guest-token.test.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const artifact = await readFile(join(here, '..', 'client.js'), 'utf8')

/** Pull the executable body out of the generated `const GUEST_REQUEST = \`…\`` literal. */
const extractGuestRequest = () => {
  const match = /const GUEST_REQUEST = `([\s\S]*?)`\n/u.exec(artifact)
  assert.ok(match !== null, 'client.js must still declare GUEST_REQUEST')
  const source = match[1]
  assert.ok(!source.includes('${'), 'the guest body must not interpolate anything at build time')
  return new Function(`return (${source})`)()
}

const AUTH_ENVELOPE = '{"code":40003,"msg":"INVALID_TOKEN","data":null}'
const MISSING_ENVELOPE = '{"code":40002,"msg":"Missing Token","data":null}'
const OK_BODY = '{"code":0,"msg":"","data":{"biz_data":{"chat_sessions":[]}}}'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl'
const OTHER_TOKEN = 'c2V0dGluZ3Mtand0LXZhbHVlLXRoYXQtaXMtbG9uZy1lbm91Z2g'

/** Minimal Storage implementation matching the subset the guest uses. */
const createStorage = (entries) => {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
  }
}

const installEnvironment = ({ accept, storage, calls, sessionStorage = {} }) => {
  const previous = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    indexedDB: globalThis.indexedDB,
  }
  globalThis.window = { localStorage: createStorage(storage), sessionStorage: createStorage(sessionStorage) }
  globalThis.indexedDB = undefined
  globalThis.fetch = async (url, init) => {
    const headers = init?.headers ?? {}
    const authorization = headers.authorization
    calls.push({ url, method: init?.method, authorization })
    const verdict = accept(authorization)
    return {
      status: 200,
      ok: true,
      url,
      headers: new Map(),
      text: async () => verdict,
    }
  }
  return () => {
    globalThis.window = previous.window
    globalThis.fetch = previous.fetch
    globalThis.indexedDB = previous.indexedDB
  }
}

const request = { url: 'https://chat.deepseek.com/api/v0/chat_session/fetch_page?count=100', method: 'POST', body: '{}' }

test('a doubly JSON-wrapped userToken is unwrapped and sent as a bearer token', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: {
      userToken: JSON.stringify({ value: JSON.stringify({ value: TOKEN, __version: '0' }), __version: '0' }),
    },
    calls,
    accept: (authorization) => (authorization === `Bearer ${TOKEN}` ? OK_BODY : AUTH_ENVELOPE),
  })
  try {
    const guestRequest = extractGuestRequest()
    const result = await guestRequest(request)
    assert.equal(result.tokenUsed, true)
    assert.equal(result.tokenSource, 'userToken')
    assert.equal(result.scheme, 'bearer')
    assert.equal(result.text, OK_BODY)
    assert.equal(calls.length, 1, 'the first accepted credential must end the ladder')
  } finally {
    restore()
  }
})

test('the raw scheme is tried when the server rejects the bearer form', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: { userToken: JSON.stringify({ value: TOKEN, __version: '0' }) },
    calls,
    accept: (authorization) => (authorization === TOKEN ? OK_BODY : AUTH_ENVELOPE),
  })
  try {
    const result = await extractGuestRequest()(request)
    assert.equal(result.scheme, 'raw')
    assert.equal(result.tokenSource, 'userToken')
    assert.equal(calls.length, 2, 'bearer then raw')
  } finally {
    restore()
  }
})

test('userToken wins over settingsJwt, which is demoted instead of preferred', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: {
      userToken: JSON.stringify({ value: TOKEN, __version: '0' }),
      settingsJwt: JSON.stringify({ value: OTHER_TOKEN, __version: '0' }),
    },
    calls,
    accept: (authorization) => (authorization === `Bearer ${TOKEN}` ? OK_BODY : AUTH_ENVELOPE),
  })
  try {
    const result = await extractGuestRequest()(request)
    assert.equal(result.tokenSource, 'userToken')
    assert.equal(calls.length, 1)
  } finally {
    restore()
  }
})

test('a JSON blob is never sent verbatim as a credential', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: {
      // The inner value is itself JSON with a real token three levels down.
      userToken: JSON.stringify({ value: JSON.stringify({ payload: { access_token: TOKEN } }), __version: '0' }),
      settingsJwt: JSON.stringify({ value: OTHER_TOKEN, __version: '0' }),
    },
    calls,
    accept: (authorization) => (authorization === `Bearer ${TOKEN}` ? OK_BODY : AUTH_ENVELOPE),
  })
  try {
    const result = await extractGuestRequest()(request)
    assert.equal(result.tokenUsed, true)
    assert.equal(result.tokenSource, 'userToken')
    for (const call of calls) {
      assert.ok(
        call.authorization === undefined || !call.authorization.includes('{'),
        `no JSON punctuation may reach the wire: ${call.authorization}`,
      )
    }
  } finally {
    restore()
  }
})

test('the ladder ends with a cookie-only attempt and reports the server verdict', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: { userToken: JSON.stringify({ value: TOKEN, __version: '0' }) },
    calls,
    accept: () => MISSING_ENVELOPE,
  })
  try {
    const result = await extractGuestRequest()(request)
    assert.equal(result.tokenUsed, false)
    assert.equal(result.scheme, 'none')
    assert.equal(result.tokenSource, 'cookie')
    assert.equal(result.text, MISSING_ENVELOPE)
    assert.equal(calls.at(-1)?.authorization, undefined, 'the final attempt carries no credential')
  } finally {
    restore()
  }
})

test('a validated credential is cached and reused on the next request', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: { userToken: JSON.stringify({ value: TOKEN, __version: '0' }) },
    calls,
    accept: (authorization) => (authorization === `Bearer ${TOKEN}` ? OK_BODY : AUTH_ENVELOPE),
  })
  try {
    const guestRequest = extractGuestRequest()
    await guestRequest(request)
    assert.equal(calls.length, 1)
    const second = await guestRequest({ ...request, url: 'https://chat.deepseek.com/api/v0/users/current', method: 'GET', body: undefined })
    assert.equal(second.tokenUsed, true)
    assert.equal(second.tokenSource, 'userToken')
    assert.equal(calls.length, 2, 'the cached credential must not be re-harvested')
  } finally {
    restore()
  }
})

test('a credential observed from the site traffic is replayed verbatim, header name included', async () => {
  const calls = []
  const restore = installEnvironment({
    storage: { userToken: JSON.stringify({ value: TOKEN, __version: '0' }) },
    calls,
    accept: () => AUTH_ENVELOPE,
  })
  try {
    const guestRequest = extractGuestRequest()
    // The interceptor stores the site's own header; an accepted answer needs that exact pair.
    globalThis.window.__dshDeepseekAuthHeader = { name: 'x-ds-token', value: OTHER_TOKEN, at: Date.now() }
    globalThis.fetch = async (url, init) => {
      const headers = init?.headers ?? {}
      calls.push({ url, method: init?.method, authorization: headers['x-ds-token'] })
      const accepted = headers['x-ds-token'] === OTHER_TOKEN
      return { status: 200, ok: true, url, headers: new Map(), text: async () => (accepted ? OK_BODY : AUTH_ENVELOPE) }
    }
    const result = await guestRequest(request)
    assert.equal(result.scheme, 'exact')
    assert.equal(result.tokenSource, 'live:x-ds-token')
    assert.equal(result.tokenUsed, true)
    assert.equal(result.text, OK_BODY)
    assert.equal(calls.length, 1, 'the observed credential must be tried first')
  } finally {
    restore()
  }
})

test('without a credential only the cookie request is made', async () => {
  const calls = []
  const restore = installEnvironment({ storage: {}, calls, accept: () => AUTH_ENVELOPE })
  try {
    const result = await extractGuestRequest()(request)
    assert.equal(calls.length, 1)
    assert.equal(result.scheme, 'none')
    assert.equal(result.text, AUTH_ENVELOPE)
  } finally {
    restore()
  }
})
