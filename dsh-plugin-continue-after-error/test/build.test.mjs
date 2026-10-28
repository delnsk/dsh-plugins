import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildClientSource } from '../scripts/build-client.mjs'

test('client.js is the generated artifact of src/client/main.js + src/shared/continue.js', async () => {
  const expected = await buildClientSource()
  const actual = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(actual, expected, 'run: node scripts/build-client.mjs')
})

test('the generated bundle keeps the inline marker out and the loader handshake in', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('/* __INLINE_CONTINUE__ */'), false)
  assert.match(source, /window\.__ModuleLoader__\.load\(/u)
  assert.match(source, /id: '@local\/dsh-plugin-continue-after-error'/u)
})
