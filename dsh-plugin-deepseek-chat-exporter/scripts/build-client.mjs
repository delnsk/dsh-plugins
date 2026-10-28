/**
 * Build the browser artifact `client.js` from `src/client/main.js` plus the shared
 * normalizer. The DSH Client module loader consumes one classic script per package
 * (`window.__ModuleLoader__.load({ id, factory })`), so shared code has to be inlined
 * instead of imported. Keeping one source of truth here means the Host half and the
 * Client half always normalize DeepSeek payloads identically.
 *
 * CLI: node scripts/build-client.mjs [--check]
 *   --check  exit 1 when the committed client.js is stale (used by the wiring test)
 * Module: import { buildClientSource } from './build-client.mjs'
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const MARKER = '/* __INLINE_NORMALIZE__ */'

const BANNER = [
  '// GENERATED FILE — do not edit.',
  '// Source: src/client/main.js + src/shared/normalize.js',
  '// Rebuild: node scripts/build-client.mjs',
  '',
].join('\n')

const stripExports = (source) => source.replace(/^export /gm, '')

/**
 * Render the complete `client.js` text.
 * @returns {Promise<string>} artifact contents, deterministic for identical inputs
 */
export async function buildClientSource() {
  const main = await readFile(join(ROOT, 'src/client/main.js'), 'utf8')
  const shared = await readFile(join(ROOT, 'src/shared/normalize.js'), 'utf8')
  if (!main.includes(MARKER)) throw new Error(`build-client: marker ${MARKER} not found in src/client/main.js`)
  if (/^export (default|\{)/m.test(shared)) {
    throw new Error('build-client: src/shared/normalize.js may only declare "export function/const" declarations')
  }
  if (/^\s*import\s/m.test(shared)) throw new Error('build-client: src/shared/normalize.js must not import anything')
  const inlined = [
    '// ---- begin inlined src/shared/normalize.js ----',
    stripExports(shared).trimEnd(),
    '// ---- end inlined src/shared/normalize.js ----',
  ].join('\n')
  return `${BANNER}${main.replace(MARKER, () => inlined)}`
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = join(ROOT, 'client.js')
  const output = await buildClientSource()
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '')
    if (current !== output) {
      console.error('build-client: client.js is stale, run: node scripts/build-client.mjs')
      process.exit(1)
    }
    console.log('build-client: client.js is up to date')
  } else {
    await writeFile(target, output, 'utf8')
    console.log(`build-client: wrote client.js (${output.length} bytes)`)
  }
}
