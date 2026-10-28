import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BLOCKING_FAILURE_CODES,
  DEFAULT_TRIGGER_ON,
  MAX_ERROR_CHARS,
  MAX_PROMPT_CHARS,
  buildContinueMessage,
  describeSendError,
  endReasonOf,
  failureCodeOf,
  isSignedOutAbort,
  normalizeTriggerOn,
  offerForTurn,
  reasonFailure,
  reasonKindOf,
  turnNumberOf,
} from '../src/shared/continue.js'

/**
 * Build a Chat `TurnLocation`-shaped fixture.
 * @param {number} number - turn number.
 * @param {object | undefined} reason - `turn/end` reason (`undefined` = no end).
 * @param {object} [options] - fixture overrides.
 * @returns {object} turn location.
 */
function turnLocation(number, reason, options = {}) {
  const end = reason === undefined ? undefined : { seq: 100 + number, time: 1000 + number, data: { turn: number, reason } }
  return {
    turn: number,
    status: 'closed',
    start: { seq: 10 + number, time: 500 + number, data: { turn: number } },
    ...(end === undefined ? {} : { end }),
    steps: [],
    data: new Map(options.data ?? []),
  }
}

const errorReason = (code, message = 'provider exploded') => ({
  kind: 'error',
  error: { message, ...(code === undefined ? {} : { code }) },
})

test('default trigger list is the documented set', () => {
  assert.deepEqual([...DEFAULT_TRIGGER_ON], ['error', 'interrupted', 'aborted'])
})

test('reads reason, failure and code out of a turn/end reason', () => {
  const turn = turnLocation(4, errorReason('AUTH', 'API key is invalid'))
  assert.equal(reasonKindOf(turn), 'error')
  assert.deepEqual(reasonFailure(turn), { message: 'API key is invalid', code: 'AUTH' })
  assert.equal(failureCodeOf(turn), 'AUTH')
  assert.deepEqual(endReasonOf(turn), errorReason('AUTH', 'API key is invalid'))
})

test('tolerates turns without a turn/end or with foreign reasons', () => {
  assert.equal(reasonKindOf(turnLocation(1)), undefined)
  assert.equal(reasonKindOf(null), undefined)
  assert.equal(reasonKindOf({}), undefined)
  assert.equal(reasonFailure(turnLocation(1, { kind: 'aborted', reason: { kind: 'user' } })), undefined)
  assert.equal(failureCodeOf(turnLocation(2, { kind: 'error' })), undefined)
})

test('offers Continue on the latest idle turn that ended with a provider error', () => {
  const turn = turnLocation(3, errorReason('PROVIDER_ERROR'))
  assert.deepEqual(offerForTurn({ turn, latestTurn: 3 }), { kind: 'error', code: 'PROVIDER_ERROR' })
  assert.deepEqual(offerForTurn({ turn, latestTurn: 3, running: false }), { kind: 'error', code: 'PROVIDER_ERROR' })
})

test('offers Continue for an interrupted (crash-recovered) turn', () => {
  const turn = turnLocation(2, { kind: 'interrupted' })
  assert.deepEqual(offerForTurn({ turn, latestTurn: 2 }), { kind: 'interrupted' })
})

test('offers Continue after the user stopped a hung turn', () => {
  const turn = turnLocation(5, { kind: 'aborted', reason: { kind: 'user', reason: 'stop' } })
  assert.deepEqual(offerForTurn({ turn, latestTurn: 5 }), { kind: 'aborted' })
})

test('hides the entry while the Session is running', () => {
  const turn = turnLocation(3, errorReason())
  assert.equal(offerForTurn({ turn, latestTurn: 3, running: true }), null)
})

test('hides the entry on a historical turn', () => {
  const turn = turnLocation(3, errorReason())
  assert.equal(offerForTurn({ turn, latestTurn: 7 }), null)
})

test('hides the entry for sign-out, sign-in and quota codes', () => {
  for (const code of BLOCKING_FAILURE_CODES) {
    const turn = turnLocation(1, errorReason(code))
    assert.equal(offerForTurn({ turn, latestTurn: 1 }), null, `expected ${code} to be hidden`)
  }
})

test('hides the entry for a signed-out abort', () => {
  const turn = turnLocation(1, {
    kind: 'aborted',
    reason: { kind: 'hook', reason: 'deepseek-account/signed-out' },
  })
  assert.equal(isSignedOutAbort(turn), true)
  assert.equal(offerForTurn({ turn, latestTurn: 1 }), null)
})

test('does not mistake an ordinary abort for a sign-out', () => {
  const turn = turnLocation(1, { kind: 'aborted', reason: { kind: 'hook', reason: 'user/cancelled' } })
  assert.equal(isSignedOutAbort(turn), false)
})

test('offers the entry for a max-tokens stop only when configured', () => {
  const turn = turnLocation(2, { kind: 'max-tokens' })
  assert.equal(offerForTurn({ turn, latestTurn: 2 }), null)
  assert.deepEqual(offerForTurn({ turn, latestTurn: 2, triggerOn: ['error', 'max-tokens'] }), { kind: 'max-tokens' })
})

test('renders nothing for a completed or unknown stop reason', () => {
  assert.equal(offerForTurn({ turn: turnLocation(2, { kind: 'completed' }), latestTurn: 2 }), null)
  assert.equal(offerForTurn({ turn: turnLocation(2, { kind: 'something-new' }), latestTurn: 2 }), null)
  assert.equal(offerForTurn({ turn: null, latestTurn: 2 }), null)
})

test('resolves the turn number from every tolerant location shape', () => {
  assert.equal(turnNumberOf(turnLocation(9, errorReason())), 9)
  assert.equal(turnNumberOf({ end: { data: { turn: 11 } } }), 11)
  assert.equal(turnNumberOf({ data: new Map([['turn-tail', { turn: 12 }]]) }), 12)
  assert.equal(turnNumberOf({ turn: Number.NaN }), undefined)
  assert.equal(turnNumberOf(undefined), undefined)
})

test('normalizes configured trigger lists', () => {
  assert.deepEqual(normalizeTriggerOn(['error', 'error', ' aborted ', '', 7]), ['error', 'aborted'])
  assert.deepEqual(normalizeTriggerOn(undefined), ['error', 'interrupted', 'aborted'])
  assert.deepEqual(normalizeTriggerOn([]), ['error', 'interrupted', 'aborted'])
  assert.deepEqual(normalizeTriggerOn('error'), ['error', 'interrupted', 'aborted'])
})

test('builds the continuation message from the override, then the locale copy', () => {
  assert.equal(buildContinueMessage({ prompt: ' go on ', fallback: 'default' }), 'go on')
  assert.equal(buildContinueMessage({ prompt: '   ', fallback: 'default' }), 'default')
  assert.equal(buildContinueMessage({ prompt: '', fallback: 'default' }), 'default')
  assert.equal(buildContinueMessage({ prompt: 42, fallback: 'default' }), 'default')
  assert.equal(buildContinueMessage({}), '')
  assert.equal(buildContinueMessage({ prompt: 'x'.repeat(10), limit: 4 }), 'xxxx')
  assert.equal(buildContinueMessage({ prompt: 'y'.repeat(MAX_PROMPT_CHARS + 50) }).length, MAX_PROMPT_CHARS)
})

test('describes a send failure as one bounded line', () => {
  assert.equal(describeSendError(new Error('RPC failed')), 'RPC failed')
  assert.equal(describeSendError('plain text'), 'plain text')
  assert.equal(describeSendError({ error: { message: 'prompt rejected' } }), 'prompt rejected')
  assert.equal(describeSendError({ message: 'line one\nline two' }), 'line one line two')
  assert.equal(describeSendError(undefined), '')
  const long = describeSendError('z'.repeat(MAX_ERROR_CHARS + 100))
  assert.equal(long.length, MAX_ERROR_CHARS)
  assert.ok(long.endsWith('…'))
})
