import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildFileName,
  hashLastMessage,
  normalizeHostChat,
  readCache,
  renderMarkdown,
  runExport,
  slugifyTitle,
  writeCache,
  yamlScalar,
} from '../lib/export.js'

const LABELS = { labelUser: 'Пользователь', labelAssistant: 'Ассистент' }
const CACHE_FILE = '.dsh-chat-exporter-cache.json'

function makeChat(overrides = {}) {
  return {
    chatId: 'abcdef123456',
    title: 'Разговор о Node',
    sourceUrl: 'https://chat.deepseek.com/a/chat/s/abcdef123456',
    createdAt: Date.UTC(2026, 9, 27, 6, 0, 0),
    updatedAt: Date.UTC(2026, 9, 27, 6, 5, 0),
    // The host recomputes this from `messages`; the client value must be ignored.
    lastMessageId: 'from-client-ignored',
    messages: [
      { id: 'm1', role: 'user', text: 'Привет! Что такое ESM?' },
      { id: 'm2', role: 'assistant', text: 'ESM — это модули ECMAScript.' },
    ],
    ...overrides,
  }
}

async function makeRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsc-'))
  // Windows occasionally reports ENOTEMPTY while deleting a directory another process has
  // just finished writing (indexer, antivirus, or the atomic cache rename). Retry instead
  // of failing an unrelated assertion through the teardown hook.
  t.after(async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fsp.rm(root, { recursive: true, force: true })
        return
      } catch (error) {
        if (attempt === 5) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
      }
    }
  })
  return root
}

function options(root, chats, extra = {}) {
  return {
    chats,
    workspaceRoot: root,
    outputDir: 'research',
    cacheFileName: CACHE_FILE,
    labels: LABELS,
    fileNameMaxTitle: 60,
    ...extra,
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function frontmatterValue(text, key) {
  const end = text.indexOf('\n---\n')
  assert.notEqual(end, -1, 'frontmatter terminator is missing')
  const line = text.slice(0, end).split('\n').find((item) => item.startsWith(`${key}: `))
  assert.ok(line, `frontmatter has no ${key} line`)
  return line.slice(key.length + 2).replace(/^"|"$/g, '')
}

async function readResearchFile(root, relativeFile) {
  return fsp.readFile(path.join(root, relativeFile), 'utf8')
}

async function researchEntries(root) {
  return fsp.readdir(path.join(root, 'research'))
}

test('first export writes frontmatter, both roles and no reasoning', async (t) => {
  const root = await makeRoot(t)
  const summary = await runExport(options(root, [makeChat()]))

  assert.equal(summary.found, 1)
  assert.equal(summary.exported, 1)
  assert.equal(summary.skipped, 0)
  assert.equal(summary.failed, 0)
  assert.equal(summary.researchDir, path.join(root, 'research'))
  assert.deepEqual(summary.errors, [])

  const [result] = summary.results
  assert.equal(result.status, 'exported')
  assert.equal(result.chatId, 'abcdef123456')
  assert.match(result.file, /^research\/\d{4}-\d{2}-\d{2}_Разговор-о-Node_abcdef12\.md$/)

  const text = await readResearchFile(root, result.file)
  const lines = text.split('\n')
  assert.equal(lines[0], '---')
  assert.equal(lines[1], 'title: "Разговор о Node"')
  assert.equal(lines[2], 'chat_id: "abcdef123456"')
  assert.equal(lines[3], 'source_url: "https://chat.deepseek.com/a/chat/s/abcdef123456"')
  assert.match(lines[4], /^exported_at: "\d{4}-\d{2}-\d{2}T[\d:.]+Z"$/)
  assert.match(lines[5], /^updated_at: "\d{4}-\d{2}-\d{2}T[\d:.]+Z"$/)
  assert.equal(lines[6], 'message_count: 2')
  assert.equal(lines[7], 'last_message_id: "m2"')
  assert.equal(
    lines[8],
    `last_message_hash: "${hashLastMessage({ id: 'm2', text: 'ESM — это модули ECMAScript.' })}"`,
  )
  assert.equal(lines[9], '---')
  assert.equal(lines[10], '')

  assert.ok(text.includes('**Пользователь:**\n\nПривет! Что такое ESM?'))
  assert.ok(text.includes('**Ассистент:**\n\nESM — это модули ECMAScript.'))
  assert.ok(text.endsWith('\n'))
  assert.ok(!text.endsWith('\n\n'))
  assert.ok(!text.includes('рассужд'))
})

test('unchanged chat is skipped and its file keeps bytes and mtime', async (t) => {
  const root = await makeRoot(t)
  const first = await runExport(options(root, [makeChat()]))
  const filePath = path.join(root, first.results[0].file)
  const before = await fsp.stat(filePath)
  const beforeBytes = await fsp.readFile(filePath)

  const second = await runExport(options(root, [makeChat()]))

  assert.equal(second.skipped, 1)
  assert.equal(second.exported, 0)
  assert.equal(second.failed, 0)
  assert.equal(second.results[0].status, 'skipped')
  assert.equal(second.results[0].file, first.results[0].file)

  const after = await fsp.stat(filePath)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.deepEqual(await fsp.readFile(filePath), beforeBytes)
  assert.equal((await researchEntries(root)).length, 1)
})

test('changed chat rewrites the same file, keeps exported_at, refreshes hash', async (t) => {
  const root = await makeRoot(t)
  const first = await runExport(options(root, [makeChat()]))
  const firstText = await readResearchFile(root, first.results[0].file)
  const exportedAt = frontmatterValue(firstText, 'exported_at')
  await delay(10)

  const changed = makeChat({
    messages: [...makeChat().messages, { id: 'm3', role: 'assistant', text: 'И ещё: модули кешируются.' }],
  })
  const second = await runExport(options(root, [changed]))

  assert.equal(second.exported, 1)
  assert.equal(second.skipped, 0)
  assert.equal(second.results[0].file, first.results[0].file)
  assert.equal((await researchEntries(root)).length, 1, 'update must not create a second file')

  const updatedText = await readResearchFile(root, second.results[0].file)
  assert.equal(frontmatterValue(updatedText, 'exported_at'), exportedAt)
  assert.notEqual(
    frontmatterValue(updatedText, 'last_message_hash'),
    frontmatterValue(firstText, 'last_message_hash'),
  )
  assert.notEqual(frontmatterValue(updatedText, 'updated_at'), frontmatterValue(firstText, 'updated_at'))
  assert.equal(frontmatterValue(updatedText, 'message_count'), '3')
  assert.equal(frontmatterValue(updatedText, 'last_message_id'), 'm3')
})

test('file names are sanitized for every hostile title', () => {
  assert.equal(slugifyTitle('a<>:"/\\|?*b', 60), 'a-b')
  assert.equal(slugifyTitle('Name.  ', 60), 'Name')
  assert.equal(slugifyTitle('Привет, мир!', 60), 'Привет-мир')
  assert.equal(slugifyTitle('', 60), '')
  assert.equal(slugifyTitle('x'.repeat(200), 60).length, 60)

  const hostile = buildFileName(
    { chatId: 'abcdef123456', title: 'a<>:"/\\|?*b' },
    undefined,
    { fileNameMaxTitle: 60 },
  )
  assert.match(hostile.fileName, /^\d{4}-\d{2}-\d{2}_a-b_abcdef12\.md$/)
  assert.ok(!/["<>?*|:\\/]/.test(hostile.fileName))

  const trailing = buildFileName({ chatId: 'abcdef123456', title: 'Name. ' }, undefined, { fileNameMaxTitle: 60 })
  assert.match(trailing.fileName, /^\d{4}-\d{2}-\d{2}_Name_abcdef12\.md$/)

  const long = buildFileName({ chatId: 'abcdef123456', title: 'y'.repeat(200) }, undefined, { fileNameMaxTitle: 60 })
  assert.match(long.fileName, /^\d{4}-\d{2}-\d{2}_y{60}_abcdef12\.md$/)

  const empty = buildFileName({ chatId: 'abcdef123456', title: '' }, undefined, { fileNameMaxTitle: 60 })
  assert.match(empty.fileName, /^\d{4}-\d{2}-\d{2}_chat_abcdef12\.md$/)

  const cyrillic = buildFileName({ chatId: 'abcdef123456', title: 'Привет мир' }, undefined, { fileNameMaxTitle: 60 })
  assert.match(cyrillic.fileName, /^\d{4}-\d{2}-\d{2}_Привет-мир_abcdef12\.md$/)

  // An existing cache entry pins the file name even for a now-hostile title.
  const pinned = buildFileName(
    { chatId: 'abcdef123456', title: '???' },
    { file: 'research/2026-10-27_Old_Name_abcdef12.md' },
    { fileNameMaxTitle: 60 },
  )
  assert.equal(pinned.fileName, '2026-10-27_Old_Name_abcdef12.md')
})

test('invalid chatId fails alone and does not stop the run', async (t) => {
  const root = await makeRoot(t)
  const broken = makeChat({ chatId: 'bad id/../x', title: 'Broken' })
  const summary = await runExport(options(root, [broken, makeChat()]))

  assert.equal(summary.found, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.exported, 1)
  assert.equal(summary.results[0].status, 'failed')
  assert.equal(summary.results[0].reason, 'E_CHAT_ID')
  assert.equal(summary.results[1].status, 'exported')
  assert.ok(summary.errors.some((message) => message.includes('E_CHAT_ID')))
  assert.equal((await researchEntries(root)).length, 1)
})

test('reasoning and unknown-role messages are dropped and counted out', async (t) => {
  const root = await makeRoot(t)
  const chat = makeChat({
    messages: [
      { id: 'u1', role: 'user', text: 'Вопрос' },
      { id: 'r1', role: 'assistant', text: 'скрытые рассуждения', reasoning: true },
      { id: 'r2', role: 'assistant', text: 'мысли второго типа', type: 'thinking' },
      { id: 's1', role: 'system', text: 'системная инструкция' },
      { id: 'a1', role: 'ASSISTANT', text: 'Ответ' },
    ],
  })
  const summary = await runExport(options(root, [chat]))

  assert.equal(summary.exported, 1)
  const text = await readResearchFile(root, summary.results[0].file)
  assert.equal(frontmatterValue(text, 'message_count'), '2')
  assert.equal(frontmatterValue(text, 'last_message_id'), 'a1')
  assert.ok(!text.includes('скрытые рассуждения'))
  assert.ok(!text.includes('мысли второго типа'))
  assert.ok(!text.includes('системная инструкция'))
  assert.ok(text.includes('**Пользователь:**\n\nВопрос'))
  assert.ok(text.includes('**Ассистент:**\n\nОтвет'))
})

test('corrupt cache is tolerated and rebuilt', async (t) => {
  const root = await makeRoot(t)
  const cachePath = path.join(root, CACHE_FILE)
  await fsp.writeFile(cachePath, '{ this is not json at all', 'utf8')

  const summary = await runExport(options(root, [makeChat()]))

  assert.equal(summary.exported, 1)
  assert.equal(summary.failed, 0)
  const cache = JSON.parse(await fsp.readFile(cachePath, 'utf8'))
  assert.equal(cache.version, 1)
  assert.ok(cache.chats.abcdef123456)
  assert.equal(typeof cache.chats.abcdef123456.lastMessageHash, 'string')

  assert.deepEqual(await readCache(path.join(root, 'missing-cache.json')), {
    version: 1,
    updatedAt: null,
    chats: {},
  })
})

test('a cached chat whose file disappeared is rewritten in place', async (t) => {
  const root = await makeRoot(t)
  const first = await runExport(options(root, [makeChat()]))
  await fsp.rm(path.join(root, first.results[0].file))

  const second = await runExport(options(root, [makeChat()]))

  assert.equal(second.exported, 1)
  assert.equal(second.skipped, 0)
  assert.equal(second.results[0].file, first.results[0].file)
  assert.equal((await researchEntries(root)).length, 1)
})

test('yaml scalars are quoted and escaped', () => {
  assert.equal(yamlScalar('a"b\\c'), '"a\\"b\\\\c"')
  assert.equal(yamlScalar(null), '""')
  assert.equal(yamlScalar('a\nb'), '"a\\nb"')
  assert.equal(yamlScalar('Пользователь'), '"Пользователь"')
})

test('renderMarkdown inserts text verbatim and ends with exactly one newline', () => {
  const chat = normalizeHostChat(makeChat({
    messages: [
      { id: 'm1', role: 'user', text: '**bold** and `code`\n\n- item' },
      { id: 'm2', role: 'assistant', text: 'Ответ\n\n' },
    ],
  }))
  const text = renderMarkdown(
    chat,
    { exportedAt: 'A', updatedAt: 'B', lastMessageId: 'm2', lastMessageHash: 'C' },
    LABELS,
  )

  assert.ok(text.includes('**bold** and `code`\n\n- item'))
  assert.ok(text.includes('**Ассистент:**\n\nОтвет'))
  assert.ok(text.endsWith('Ответ\n'))
  assert.ok(!text.endsWith('\n\n'))
  assert.equal(text.slice(0, text.indexOf('\n')), '---')
})

test('writeCache round-trips through readCache', async (t) => {
  const root = await makeRoot(t)
  const cachePath = path.join(root, CACHE_FILE)
  await writeCache(cachePath, {
    updatedAt: '2026-10-27T06:00:00.000Z',
    chats: {
      abcdef123456: {
        title: 'T',
        file: 'research/2026-10-27_T_abcdef12.md',
        lastMessageId: 'm2',
        lastMessageHash: 'h',
        messageCount: 2,
        exportedAt: '2026-10-27T06:00:00.000Z',
        updatedAt: '2026-10-27T06:00:00.000Z',
        lastExportAt: '2026-10-27T06:00:00.000Z',
      },
    },
  })

  const cache = await readCache(cachePath)
  assert.equal(cache.updatedAt, '2026-10-27T06:00:00.000Z')
  assert.equal(cache.chats.abcdef123456.file, 'research/2026-10-27_T_abcdef12.md')
})
