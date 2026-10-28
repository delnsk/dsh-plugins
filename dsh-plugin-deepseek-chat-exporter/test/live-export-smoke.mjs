/**
 * Live smoke test against a running DSH Desktop Host.
 *
 * It talks to the installed plugin's own HTTP route, so it proves the whole Host path
 * end to end without a browser: workspace resolution, Markdown layout, the cache and the
 * "unchanged chat is not rewritten / changed chat updates in place" rules.
 *
 * Prerequisite: DSH Desktop is running and the bundle is installed.
 *   node test/live-export-smoke.mjs [--endpoint http://127.0.0.1:63689] [--workspace <dir>] [--clean]
 *
 * Exit code 0 means every assertion held.
 */

import assert from 'node:assert/strict'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const option = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const endpoint = option('--endpoint', process.env.DSH_WEB_URL || 'http://127.0.0.1:63689')
const workspaceOverride = option('--workspace', '')
const clean = argv.includes('--clean')
const rpcUrl = `${endpoint.replace(/\/+$/u, '')}/dsh-chat-exporter/rpc`

const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const payload = await response.json()
  if (payload.ok !== true) throw new Error(`${method}: ${payload?.error?.code} ${payload?.error?.message}`)
  return payload.value
}

const chatId = (prefix) => `${prefix}${'0'.repeat(32 - prefix.length)}`
const CHAT_A = chatId('livea')
const CHAT_B = chatId('liveb')

const chat = (id, title, lastText) => ({
  chatId: id,
  title,
  sourceUrl: `https://chat.deepseek.com/a/chat/s/${id}`,
  createdAt: Date.parse('2026-10-20T09:00:00.000Z'),
  updatedAt: Date.parse('2026-10-21T10:00:00.000Z'),
  lastMessageId: `live-${id.slice(0, 5)}-2`,
  messages: [
    { id: `live-${id.slice(0, 5)}-1`, role: 'user', text: 'Проверочный вопрос smoke-теста' },
    { id: `live-${id.slice(0, 5)}-2`, role: 'assistant', text: lastText },
  ],
})

const hello = await rpc('hello')
const workspaceRoot = workspaceOverride === '' ? hello.workspaceRoot : workspaceOverride
const researchDir = join(workspaceRoot, hello.outputDir)
console.log(`hello: reported workspaceRoot=${hello.workspaceRoot} outputDir=${hello.outputDir}`)
console.log(`effective workspace for this run=${workspaceRoot}`)

const first = await rpc('export', {
  chats: [chat(CHAT_A, 'Smoke: первый диалог', 'Первый ответ ассистента'), chat(CHAT_B, 'Smoke: второй диалог', 'Второй ответ')],
  workspacePath: workspaceRoot,
})
console.log(`export #1: found=${first.found} exported=${first.exported} skipped=${first.skipped} failed=${first.failed}`)
assert.equal(first.found, 2)
assert.equal(first.exported, 2)
assert.equal(first.failed, 0)

const fileA = first.results.find((entry) => entry.chatId === CHAT_A).file
const fileB = first.results.find((entry) => entry.chatId === CHAT_B).file
console.log(`files: ${fileA} | ${fileB}`)
const absoluteA = join(workspaceRoot, fileA)
const markdown = await readFile(absoluteA, 'utf8')
assert.ok(markdown.startsWith('---\n'))
assert.match(markdown, /^\*\*Пользователь:\*\*$/mu)
assert.match(markdown, /^\*\*Ассистент:\*\*$/mu)
assert.match(markdown, /^message_count: 2$/mu)
assert.match(markdown, /^last_message_hash: "[a-f0-9]{64}"$/mu)
assert.ok(markdown.trimEnd().endsWith('Первый ответ ассистента'))
const statBefore = await stat(absoluteA)

await new Promise((resolve) => setTimeout(resolve, 60))
const second = await rpc('export', {
  chats: [chat(CHAT_A, 'Smoke: первый диалог', 'Первый ответ ассистента'), chat(CHAT_B, 'Smoke: второй диалог', 'Второй ответ')],
  workspacePath: workspaceRoot,
})
console.log(`export #2 (unchanged): exported=${second.exported} skipped=${second.skipped}`)
assert.equal(second.exported, 0, 'unchanged chats must not be rewritten')
assert.equal(second.skipped, 2)
assert.equal((await stat(absoluteA)).mtimeMs, statBefore.mtimeMs, 'mtime must not move for skipped chats')

await new Promise((resolve) => setTimeout(resolve, 60))
const changed = chat(CHAT_A, 'Smoke: первый диалог', 'Обновлённый ответ ассистента')
changed.lastMessageId = 'live-livea-3'
const third = await rpc('export', { chats: [changed], workspacePath: workspaceRoot })
console.log(`export #3 (changed): exported=${third.exported} skipped=${third.skipped} file=${third.results[0].file}`)
assert.equal(third.exported, 1)
assert.equal(third.results[0].file, fileA, 'the changed chat must keep its file name')
const rewritten = await readFile(absoluteA, 'utf8')
assert.ok(rewritten.includes('Обновлённый ответ ассистента'))
assert.ok(!rewritten.includes('Первый ответ ассистента'))

const status = await rpc('status')
console.log(`status: entries=${status.entries} researchDir=${status.researchDir}`)
assert.ok(status.entries >= 2)

const listing = await readdir(researchDir)
console.log(`research/: ${listing.length} entries`)

if (clean) {
  await rm(absoluteA, { force: true })
  await rm(join(workspaceRoot, fileB), { force: true })
  await rpc('clearCache')
  console.log('cleaned up the smoke-test files and the cache')
}

console.log('live smoke test: OK')
