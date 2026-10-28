import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULTS,
  appendDiagnostic,
  createRpcHandler,
  diagnosticEntry,
  normalizeConfig,
  resolveWorkspaceRoot,
} from '../lib/rpc.js'

const tempDir = async () => mkdtemp(join(tmpdir(), 'dsh-continue-test-'))

function fakeRequest({ method = 'POST', url = '/dsh-continue/rpc', body = '' } = {}) {
  const stream = Readable.from([Buffer.from(body, 'utf8')])
  stream.method = method
  stream.url = url
  return stream
}

function fakeResponse() {
  const response = {
    statusCode: 0,
    headers: {},
    text: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(text) {
      this.text = text
    },
  }
  return response
}

async function call(handler, request) {
  const response = fakeResponse()
  await handler(request, response)
  return { status: response.statusCode, headers: response.headers, payload: JSON.parse(response.text) }
}

test('normalizeConfig merges over defaults and ignores malformed values', () => {
  const defaults = normalizeConfig(undefined)
  assert.deepEqual(defaults, { ...DEFAULTS, triggerOn: [...DEFAULTS.triggerOn] })

  const custom = normalizeConfig({
    prompt: '  продолжай  ',
    triggerOn: ['error', 'nope', 'error', 'max-tokens'],
    diagnostics: false,
    diagnosticsFileName: '.custom-continue.json',
    workspaceRoot: 'relative/path',
    unknownKey: 1,
  })
  assert.equal(custom.prompt, 'продолжай')
  assert.deepEqual(custom.triggerOn, ['error', 'max-tokens'])
  assert.equal(custom.diagnostics, false)
  assert.equal(custom.diagnosticsFileName, '.custom-continue.json')
  assert.equal(custom.workspaceRoot, '')

  const unsafe = normalizeConfig({ diagnosticsFileName: '..\\escape.json' })
  assert.equal(unsafe.diagnosticsFileName, DEFAULTS.diagnosticsFileName)
})

test('diagnosticEntry validates the event name and bounds the message', () => {
  assert.equal(diagnosticEntry({}), undefined)
  assert.equal(diagnosticEntry({ event: 'NOT VALID' }), undefined)
  const entry = diagnosticEntry({
    event: 'client-render',
    sessionId: 'abc',
    turn: 3,
    kind: 'error',
    message: ' line one\nline two ',
  })
  assert.equal(entry.event, 'client-render')
  assert.equal(entry.sessionId, 'abc')
  assert.equal(entry.turn, 3)
  assert.equal(entry.kind, 'error')
  assert.equal(entry.message, 'line one line two')
  assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/u)
})

test('appendDiagnostic keeps a bounded, atomically rewritten log', async () => {
  const dir = await tempDir()
  const file = join(dir, '.dsh-continue-diagnostics.json')
  for (let index = 0; index < 5; index += 1) {
    await appendDiagnostic(file, { at: new Date().toISOString(), event: `event-${index}` })
  }
  const document = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(document.entries.length, 5)
  assert.equal(document.entries[4].event, 'event-4')
})

test('resolveWorkspaceRoot prefers an existing configured root', async () => {
  const dir = await tempDir()
  const root = await resolveWorkspaceRoot({ get: () => undefined }, { workspaceRoot: dir })
  assert.equal(root.toLowerCase(), dir.toLowerCase())
})

test('route answers config, report and status and rejects unknown methods', async () => {
  const workspace = await tempDir()
  const settings = normalizeConfig({ workspaceRoot: workspace, diagnostics: true })
  const handler = createRpcHandler({ ctx: { get: () => undefined }, settings })

  const config = await call(handler, fakeRequest({ body: JSON.stringify({ method: 'config', params: {} }) }))
  assert.equal(config.status, 200)
  assert.equal(config.payload.ok, true)
  assert.equal(config.payload.value.prompt, null)
  assert.deepEqual(config.payload.value.triggerOn, ['error', 'interrupted', 'aborted'])
  assert.equal(config.payload.value.diagnostics, true)

  const report = await call(
    handler,
    fakeRequest({
      body: JSON.stringify({
        method: 'report',
        params: { event: 'client-mount', sessionId: 's-1', message: 'mounted' },
      }),
    }),
  )
  assert.equal(report.status, 200)
  assert.equal(report.payload.value.accepted, true)
  assert.equal(report.payload.value.path, join(workspace, '.dsh-continue-diagnostics.json'))

  const status = await call(handler, fakeRequest({ body: JSON.stringify({ method: 'status', params: {} }) }))
  assert.equal(status.status, 200)
  assert.equal(status.payload.value.entries, 1)
  assert.equal(status.payload.value.last[0].event, 'client-mount')

  const unknown = await call(handler, fakeRequest({ body: JSON.stringify({ method: 'nope', params: {} }) }))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.payload.error.code, 'E_METHOD')

  const wrongRoute = await call(handler, fakeRequest({ url: '/nope', body: '{}' }))
  assert.equal(wrongRoute.status, 404)
  assert.equal(wrongRoute.payload.error.code, 'E_ROUTE')

  const get = await call(handler, fakeRequest({ method: 'GET' }))
  assert.equal(get.status, 405)
  assert.equal(get.headers.allow, 'POST')

  const invalid = await call(handler, fakeRequest({ body: '{ not json' }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.payload.error.code, 'E_JSON')

  const invalidReport = await call(
    handler,
    fakeRequest({ body: JSON.stringify({ method: 'report', params: { event: 'BAD EVENT' } }) }),
  )
  assert.equal(invalidReport.status, 400)
  assert.equal(invalidReport.payload.error.code, 'E_REPORT')
})

test('route refuses an oversized request body', async () => {
  const settings = normalizeConfig({ workspaceRoot: await tempDir() })
  const handler = createRpcHandler({ ctx: { get: () => undefined }, settings })
  const oversized = await call(handler, fakeRequest({ body: 'x'.repeat(70 * 1024) }))
  assert.equal(oversized.status, 413)
})

test('report is a no-op when diagnostics are disabled', async () => {
  const workspace = await tempDir()
  const settings = normalizeConfig({ workspaceRoot: workspace, diagnostics: false })
  const handler = createRpcHandler({ ctx: { get: () => undefined }, settings })
  const report = await call(
    handler,
    fakeRequest({ body: JSON.stringify({ method: 'report', params: { event: 'client-mount' } }) }),
  )
  assert.equal(report.status, 200)
  assert.equal(report.payload.value.accepted, true)
  assert.equal(report.payload.value.path, null)
})
