/**
 * End-to-end contract test for the Host half.
 *
 * It drives the real route handler and the real `/export-chats` command through a fake
 * Cordis scope, so the wire protocol, the cache, the Markdown layout and the
 * command→panel rendezvous are exercised exactly as the Desktop Host runs them — no
 * Electron, no chat.deepseek.com, no network.
 *
 * Run: node test/host-contract.test.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply, name as pluginName } from '../index.js'

const CHAT_A = 'aaaaaaaa111111112222222233333333'
const CHAT_B = 'bbbbbbbb111111112222222233333333'

const chatPayload = (chatId, title, lastUserText) => ({
  chatId,
  title,
  sourceUrl: `https://chat.deepseek.com/a/chat/s/${chatId}`,
  createdAt: 1761500000000,
  updatedAt: 1761600000000,
  lastMessageId: `m-${chatId.slice(0, 4)}-2`,
  messages: [
    { id: `m-${chatId.slice(0, 4)}-1`, role: 'user', text: 'Первый вопрос', createdAt: 1761500000000 },
    { id: `m-${chatId.slice(0, 4)}-1a`, role: 'user', text: '  ', createdAt: 1761500000001 },
    { id: `m-${chatId.slice(0, 4)}-1b`, role: 'system', text: 'служебное', createdAt: 1761500000002 },
    { id: `m-${chatId.slice(0, 4)}-2`, role: 'assistant', text: lastUserText, createdAt: 1761600000000 },
  ],
})

class FakeResponse {
  constructor() {
    this.statusCode = 0
    this.headers = {}
    this.body = ''
    this.headersSent = false
    this.writableEnded = false
  }

  writeHead(status, headers) {
    this.statusCode = status
    this.headers = headers || {}
    this.headersSent = true
    return this
  }

  setHeader(key, value) {
    this.headers[key] = value
  }

  end(chunk) {
    if (chunk !== undefined) this.body += chunk
    this.writableEnded = true
  }
}

const createHarness = (workspaceRoot) => {
  const routes = []
  const commands = []
  const registrationOrder = []
  const logger = { info: () => {}, warn: () => {}, error: () => {} }
  const services = {
    workspaceRegistry: { list: () => [{ path: workspaceRoot, title: 'test-workspace' }] },
    workingDirectory: { defaultDirectory: join(workspaceRoot, '.not-a-workspace') },
  }
  const scope = {
    effect: (callback) => {
      const dispose = callback()
      registrationOrder.push(dispose)
      return () => {}
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    commands: {
      register: (definition) => {
        commands.push(definition)
        return () => {}
      },
    },
    get: (key) => services[key],
    logger,
  }
  const ctx = {
    get: (key) => services[key],
    logger,
    inject: (names, callback) => {
      assert.deepEqual([...names].sort(), ['commands', 'webServer'], 'both optional services are injected together')
      return callback(scope)
    },
  }
  apply(ctx, {
    outputDir: 'research',
    commandWaitMs: 5000,
    maxChats: 10,
    labelUser: 'Пользователь',
    labelAssistant: 'Ассистент',
  })
  assert.equal(routes.length, 1, 'exactly one route is registered')
  assert.equal(commands.length, 1, 'exactly one command is registered')
  return { route: routes[0], command: commands[0] }
}

const rpc = async (route, payload, options = {}) => {
  const request = Readable.from([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))])
  request.method = options.method || 'POST'
  request.url = options.url || '/dsh-chat-exporter/rpc'
  const response = new FakeResponse()
  await route.handler(request, response)
  return { status: response.statusCode, headers: response.headers, body: response.body ? JSON.parse(response.body) : undefined }
}

const tempWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dsce-host-'))
  return root
}

/**
 * Windows occasionally reports ENOTEMPTY while deleting a directory another process has
 * just finished writing (indexer, antivirus, or the atomic rename of the cache). Retry
 * instead of failing the test for an unrelated reason.
 */
const cleanup = async (root) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
}

void pluginName

test('hello reports a real workspace and never the profile directory', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const reply = await rpc(route, { method: 'hello', params: {} })
    assert.equal(reply.status, 200)
    assert.equal(reply.body.ok, true)
    assert.equal(reply.body.value.workspaceRoot, root)
    assert.equal(reply.body.value.outputDir, 'research')
    assert.ok(Array.isArray(reply.body.value.api.listEndpoints))
    assert.ok(reply.body.value.api.historyEndpoints.length >= 1)
    assert.equal(reply.headers['cache-control'], 'no-store')
  } finally {
    await cleanup(root)
  }
})

test('export writes one Markdown file per chat with frontmatter and no reasoning', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const reply = await rpc(route, {
      method: 'export',
      params: { chats: [chatPayload(CHAT_A, 'Первый диалог', 'Ответ ассистента'), chatPayload(CHAT_B, 'Второй: диалог?', 'Другой ответ')] },
    })
    assert.equal(reply.body.ok, true)
    const value = reply.body.value
    assert.equal(value.found, 2)
    assert.equal(value.exported, 2)
    assert.equal(value.skipped, 0)
    assert.equal(value.failed, 0)

    const first = value.results.find((entry) => entry.chatId === CHAT_A)
    assert.equal(first.status, 'exported')
    assert.match(first.file, /research[\\/]2025-10-26_[^\\/]+_aaaaaaaa\.md$/u)

    const markdown = await readFile(join(root, first.file), 'utf8')
    assert.ok(markdown.startsWith('---\n'), 'frontmatter opens the file')
    assert.match(markdown, /^title: "Первый диалог"$/mu)
    assert.match(markdown, new RegExp(`^chat_id: "${CHAT_A}"$`, 'mu'))
    assert.match(markdown, /^source_url: "https:\/\/chat\.deepseek\.com\/a\/chat\/s\//mu)
    assert.match(markdown, /^message_count: 2$/mu, 'only the user/assistant pair survives the drop rules')
    assert.match(markdown, /^last_message_hash: "[a-f0-9]{64}"$/mu)
    assert.match(markdown, /\*\*Пользователь:\*\*\n\nПервый вопрос/u)
    assert.match(markdown, /\*\*Ассистент:\*\*\n\nОтвет ассистента/u)
    assert.ok(!markdown.includes('служебное'), 'system messages are dropped')
    assert.ok(markdown.endsWith('\n') && !markdown.endsWith('\n\n'), 'exactly one trailing newline')

    const second = value.results.find((entry) => entry.chatId === CHAT_B)
    assert.match(second.file, /research[\\/]2025-10-26_[^\\/]+_bbbbbbbb\.md$/u, 'hostile characters are stripped')
  } finally {
    await cleanup(root)
  }
})

test('an unchanged chat is skipped without touching the file, a changed one rewrites the same path', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const first = await rpc(route, {
      method: 'export',
      params: { chats: [chatPayload(CHAT_A, 'Диалог', 'Первый ответ')] },
    })
    const file = first.body.value.results[0].file
    const absolute = join(root, file)
    const before = await stat(absolute)
    const firstText = await readFile(absolute, 'utf8')
    assert.match(firstText, /^last_message_id: "m-aaaa-2"$/mu)

    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await rpc(route, {
      method: 'export',
      params: { chats: [chatPayload(CHAT_A, 'Диалог', 'Первый ответ')] },
    })
    assert.equal(second.body.value.exported, 0)
    assert.equal(second.body.value.skipped, 1)
    const afterSkip = await stat(absolute)
    assert.equal(afterSkip.mtimeMs, before.mtimeMs, 'a skipped chat must not rewrite the file')
    assert.equal(await readFile(absolute, 'utf8'), firstText)

    await new Promise((resolve) => setTimeout(resolve, 20))
    const changed = chatPayload(CHAT_A, 'Диалог', 'Второй ответ')
    changed.lastMessageId = 'm-aaaa-3'
    const third = await rpc(route, { method: 'export', params: { chats: [changed] } })
    assert.equal(third.body.value.exported, 1)
    assert.equal(third.body.value.skipped, 0)
    assert.equal(third.body.value.results[0].file, file, 'the changed chat keeps its file')
    const rewritten = await readFile(absolute, 'utf8')
    assert.ok(rewritten.includes('Второй ответ'))
    assert.ok(!rewritten.includes('Первый ответ'))
    const exportedAt = (text) => text.match(/^exported_at: "(.+)"$/mu)[1]
    const updatedAt = (text) => text.match(/^updated_at: "(.+)"$/mu)[1]
    assert.equal(exportedAt(rewritten), exportedAt(firstText), 'exported_at records the first export')
    assert.notEqual(updatedAt(rewritten), updatedAt(firstText), 'updated_at moves with the content')
  } finally {
    await cleanup(root)
  }
})

test('a chat whose id is not a safe identifier fails alone', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const reply = await rpc(route, {
      method: 'export',
      params: {
        chats: [
          { ...chatPayload(CHAT_A, 'Хороший', 'ответ'), chatId: '../../etc/passwd' },
          chatPayload(CHAT_B, 'Тоже хороший', 'ответ'),
        ],
      },
    })
    assert.equal(reply.body.value.failed, 1)
    assert.equal(reply.body.value.exported, 1)
    assert.match(reply.body.value.errors.join(' '), /E_CHAT_ID/u)
  } finally {
    await cleanup(root)
  }
})

test('status and clearCache reflect the same cache the export wrote', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    await rpc(route, { method: 'export', params: { chats: [chatPayload(CHAT_A, 'Диалог', 'ответ'), chatPayload(CHAT_B, 'Диалог 2', 'ответ')] } })
    const status = await rpc(route, { method: 'status', params: {} })
    assert.equal(status.body.value.entries, 2)
    assert.ok(status.body.value.lastExportAt !== null)
    assert.equal(status.body.value.researchDir, join(root, 'research'))
    const cleared = await rpc(route, { method: 'clearCache', params: {} })
    assert.equal(cleared.body.value.removed, 2)
    const after = await rpc(route, { method: 'status', params: {} })
    assert.equal(after.body.value.entries, 0)
  } finally {
    await cleanup(root)
  }
})

test('protocol edges keep a JSON envelope', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const unknown = await rpc(route, { method: 'nope', params: {} })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.body.error.code, 'E_METHOD')
    const wrongPath = await rpc(route, { method: 'hello' }, { url: '/dsh-chat-exporter/other' })
    assert.equal(wrongPath.status, 404)
    assert.equal(wrongPath.body.error.code, 'E_ROUTE')
    const wrongMethod = await rpc(route, { method: 'hello' }, { method: 'GET' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.body.error.code, 'E_HTTP_METHOD')
    const badJson = await rpc(route, '{not json')
    assert.equal(badJson.status, 400)
    assert.equal(badJson.body.error.code, 'E_BAD_JSON')
  } finally {
    await cleanup(root)
  }
})

test('poll with a cold webview does not claim the queued command job', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const cold = await rpc(route, { method: 'poll', params: { clientId: 'c1', ready: false } })
    assert.equal(cold.body.value.job, null)
    const late = await rpc(route, { method: 'jobResult', params: { jobId: 'unknown', ok: true, summary: 'x' } })
    assert.equal(late.body.value.accepted, false)
  } finally {
    await cleanup(root)
  }
})

test('/export-chats hands a job to a ready panel and reports its summary', async () => {
  const root = await tempWorkspace()
  try {
    const { route, command } = createHarness(root)
    let resolved
    const pending = command.handler({ signal: new AbortController().signal, rawInput: '', commandId: 'c', agent: {} }).then((value) => {
      resolved = value
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(resolved, undefined, 'the command waits for a panel')

    const polled = await rpc(route, { method: 'poll', params: { clientId: 'panel-1', ready: true } })
    assert.ok(polled.body.value.job !== null, 'a ready panel receives the job')
    const summary = 'Найдено 2, экспортировано 2, пропущено 0, ошибок 0.'
    const settled = await rpc(route, {
      method: 'jobResult',
      params: { jobId: polled.body.value.job.id, ok: true, summary },
    })
    assert.equal(settled.body.value.accepted, true)
    const outcome = await pending
    assert.equal(outcome.kind, 'success')
    assert.equal(outcome.text, summary)
  } finally {
    await cleanup(root)
  }
})

test('status exposes panel liveness counters so a silent client is visible from outside', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const before = await rpc(route, { method: 'status', params: {} })
    assert.equal(before.body.value.client.polls, 0, 'no panel has polled yet')
    assert.equal(before.body.value.client.lastPollAt, null)

    await rpc(route, { method: 'poll', params: { clientId: 'panel-1', ready: false } })
    await rpc(route, { method: 'poll', params: { clientId: 'panel-1', ready: true } })
    const after = await rpc(route, { method: 'status', params: {} })
    assert.equal(after.body.value.client.polls, 2)
    assert.equal(after.body.value.client.readyPolls, 1)
    assert.ok(typeof after.body.value.client.lastPollAt === 'string')
    assert.equal(after.body.value.client.lastPollReady, true)
  } finally {
    await cleanup(root)
  }
})

test('a client report is written to the workspace with secrets redacted', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const first = await rpc(route, {
      method: 'report',
      params: {
        kind: 'export-empty',
        payload: {
          probe: { status: 200, tokenUsed: false, code: 40002, message: 'Missing Token' },
          note: 'cookie=secret token=abc',
        },
      },
    })
    assert.equal(first.body.ok, true)
    assert.equal(first.body.value.stored, true)
    const second = await rpc(route, { method: 'report', params: { kind: 'panel-ready', payload: { url: 'https://chat.deepseek.com/' } } })
    assert.equal(second.body.value.entries, 2)

    const document = JSON.parse(await readFile(join(root, '.dsh-chat-exporter-diagnostics.json'), 'utf8'))
    assert.equal(document.entries.length, 2)
    assert.equal(document.entries[0].kind, 'export-empty')
    assert.equal(document.entries[0].payload.probe.code, 40002)
    assert.equal(document.entries[0].payload.probe.message, 'Missing Token', 'diagnostic wording survives redaction')
    assert.equal(document.entries[0].payload.note, 'cookie=[redacted] token=[redacted]')
    assert.ok(!JSON.stringify(document).includes('cookie=secret'), 'the token-ish value must be redacted')
    assert.ok(!JSON.stringify(document).includes('token=abc'))
    assert.equal(document.entries[1].kind, 'panel-ready')
  } finally {
    await cleanup(root)
  }
})

test('a cache file that no longer matches disk is rebuilt, not trusted', async () => {
  const root = await tempWorkspace()
  try {
    const { route } = createHarness(root)
    const first = await rpc(route, { method: 'export', params: { chats: [chatPayload(CHAT_A, 'Диалог', 'ответ')] } })
    const file = first.body.value.results[0].file
    await rm(join(root, file))
    const second = await rpc(route, { method: 'export', params: { chats: [chatPayload(CHAT_A, 'Диалог', 'ответ')] } })
    assert.equal(second.body.value.exported, 1, 'a vanished file is recreated')
    assert.equal(second.body.value.results[0].file, file, 'and reuses the recorded name')
    await writeFile(join(root, '.keep'), '')
  } finally {
    await cleanup(root)
  }
})
