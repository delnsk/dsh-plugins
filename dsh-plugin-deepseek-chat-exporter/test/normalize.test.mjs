import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  collectReferences,
  deepseekFailure,
  explainHistory,
  extractJsonText,
  isAuthFailure,
  isReasoningRecord,
  normalizeChatList,
  normalizeHistory
} from '../src/shared/normalize.js'

// Recursively freeze a payload: the normalizers run in module scope (strict
// mode), so any accidental write into the input would throw instead of hide.
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

function findChat(chats, chatId) {
  return chats.find((chat) => chat.chatId === chatId)
}

test('normalizeChatList walks a realistic data.biz_data.chat_sessions payload', () => {
  const payload = deepFreeze({
    code: 0,
    msg: '',
    data: {
      biz_data: {
        chat_sessions: [
          { id: 'chat_a', title: 'Первый диалог', created_at: 1699999000, updated_at: 1699999600 },
          { id: 'chat_b', title: 'Второй диалог', created_at: 1700000000, updated_at: 1700000500 },
          { chat_session_id: 'chat_c', name: 'Legacy name', create_time: 1700000600 }
        ]
      }
    }
  })

  const chats = normalizeChatList(payload)

  assert.equal(chats.length, 3)
  // 1699999600 / 1700000500 / 1700000600 seconds, newest first.
  assert.deepEqual(chats.map((chat) => chat.chatId), ['chat_c', 'chat_b', 'chat_a'])
  assert.equal(findChat(chats, 'chat_b').sourceUrl, 'https://chat.deepseek.com/a/chat/s/chat_b')
  assert.equal(findChat(chats, 'chat_b').updatedAt, 1700000500000)
  assert.equal(findChat(chats, 'chat_b').createdAt, 1700000000000)
  assert.equal(findChat(chats, 'chat_b').title, 'Второй диалог')
  assert.equal(findChat(chats, 'chat_c').title, 'Legacy name')
  assert.equal(findChat(chats, 'chat_c').updatedAt, undefined)
  assert.equal(findChat(chats, 'chat_c').createdAt, 1700000600000)
})

test('normalizeChatList handles a flat variant, de-duplicates and skips id-less entries', () => {
  const chats = normalizeChatList({
    chat_sessions: [
      { id: 'dup', title: 'Older copy', updated_at: 1700000000000 },
      { id: 'only', title: 'Only chat', updated_at: 1700000001000 },
      { title: 'No id at all', updated_at: 1700000002000 },
      { id: 'dup', title: 'Newer copy', updated_at: 1700000003000 },
      { id: 42, title: 'Numeric id', updated_at: 1700000000500 }
    ]
  })

  assert.equal(chats.length, 3)
  assert.deepEqual(chats.map((chat) => chat.chatId), ['only', '42', 'dup'])
  // De-duplication keeps the first position and its title, dropping the later copy.
  assert.equal(findChat(chats, 'dup').title, 'Older copy')
  assert.equal(findChat(chats, '42').chatId, '42')
  assert.equal(findChat(chats, 'only').updatedAt, 1700000001000)
})

test('normalizeChatList accepts a bare array and walks result envelopes', () => {
  const fromArray = normalizeChatList([{ id: 'x', title: 'X', updated_at: 1700000000 }])
  assert.equal(fromArray.length, 1)
  assert.equal(fromArray[0].sourceUrl, 'https://chat.deepseek.com/a/chat/s/x')

  const fromResult = normalizeChatList({
    result: { data: { biz_data: { chat_sessions: [{ id: 'r1', title: 'From result', updated_at: 1700000000 }] } } }
  })
  assert.equal(fromResult.length, 1)
  assert.equal(fromResult[0].chatId, 'r1')
})

test('chat timestamps normalize seconds, milliseconds, microseconds, numeric strings and ISO', () => {
  const chats = normalizeChatList({
    data: {
      biz_data: {
        chat_sessions: [
          { id: 'seconds', updated_at: 1700000000 },
          { id: 'millis', updated_at: 1700000000123 },
          { id: 'micros', updated_at: 1700000000123456 },
          { id: 'iso', updated_at: '2024-01-02T03:04:05.678Z' },
          { id: 'numeric_string', updated_at: '1700000000' },
          { id: 'garbage', updated_at: 'not a date' }
        ]
      }
    }
  })

  assert.equal(findChat(chats, 'seconds').updatedAt, 1700000000000)
  assert.equal(findChat(chats, 'millis').updatedAt, 1700000000123)
  assert.equal(findChat(chats, 'micros').updatedAt, 1700000000123)
  assert.equal(findChat(chats, 'iso').updatedAt, Date.parse('2024-01-02T03:04:05.678Z'))
  assert.equal(findChat(chats, 'numeric_string').updatedAt, 1700000000000)
  assert.equal(findChat(chats, 'garbage').updatedAt, undefined)
})

test('chat titles survive Cyrillic, CJK and emoji untouched', () => {
  const chats = normalizeChatList({
    data: {
      biz_data: {
        chat_sessions: [
          { id: 'unicode', title: 'Привет 世界 🚀', updated_at: 1700000000 },
          { id: 'padded', title: '  空格保留  ', updated_at: 1700000001 }
        ]
      }
    }
  })

  assert.equal(findChat(chats, 'unicode').title, 'Привет 世界 🚀')
  assert.equal(findChat(chats, 'padded').title, '空格保留')
})

test('normalizeChatList never throws on unusable payloads', () => {
  assert.deepEqual(normalizeChatList([]), [])
  assert.deepEqual(normalizeChatList(null), [])
  assert.deepEqual(normalizeChatList(undefined), [])
  assert.deepEqual(normalizeChatList({ code: 0, msg: 'no data' }), [])
  assert.deepEqual(normalizeChatList({ data: { biz_data: { chat_sessions: [] } } }), [])
  assert.deepEqual(normalizeChatList('not json'), [])
})

test('normalizeHistory reads biz_data.chat_messages with roles, ids and timestamps', () => {
  const payload = deepFreeze({
    code: 0,
    msg: '',
    data: {
      biz_data: {
        chat_messages: [
          { message_id: 11, role: 'USER', content: '  Привет, мир  ', created_at: 1699999000 },
          { message_id: 12, role: 'ASSISTANT', content: 'Здравствуйте!', created_at: 1699999060 }
        ]
      }
    }
  })

  const messages = normalizeHistory(payload)

  assert.equal(messages.length, 2)
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant'])
  assert.deepEqual(messages.map((message) => message.text), ['Привет, мир', 'Здравствуйте!'])
  assert.deepEqual(messages.map((message) => message.id), ['11', '12'])
  assert.equal(messages[0].createdAt, 1699999000000)
  assert.equal(messages[1].createdAt, 1699999060000)
  // No createdAt when the source has no timestamp.
  assert.deepEqual(normalizeHistory({ data: { messages: [{ role: 'user', content: 'q' }] } })[0], {
    id: '',
    role: 'user',
    text: 'q'
  })
})

test('normalizeHistory derives roles from fragments when content is missing', () => {
  const messages = normalizeHistory({
    data: {
      biz_data: {
        chat_messages: [
          { message_id: 'm1', fragments: [{ type: 'REQUEST', content: 'How are you?' }] },
          { message_id: 'm2', fragments: [{ type: 'RESPONSE', content: 'Fine, thanks' }] },
          {
            message_id: 'm3',
            fragments: [
              { type: 'REQUEST', content: 'one' },
              { type: 'RESPONSE', content: 'two' }
            ]
          },
          { message_id: 'm4', fragments: [{ type: 'RESPONSE', text: 'legacy text field' }] }
        ]
      }
    }
  })

  assert.equal(messages.length, 4)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].text, 'How are you?')
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].text, 'Fine, thanks')
  // One record holding both directions keeps the first fragment's role and joins
  // its parts in array order.
  assert.equal(messages[2].role, 'user')
  assert.equal(messages[2].text, 'one\n\ntwo')
  assert.equal(messages[3].role, 'assistant')
  assert.equal(messages[3].text, 'legacy text field')
})

test('message text skips search_results, tool and file fragments', () => {
  const messages = normalizeHistory({
    data: {
      chat_messages: [
        {
          message_id: 'f1',
          role: 'assistant',
          fragments: [
            { type: 'RESPONSE', content: 'answer' },
            { type: 'SEARCH_RESULTS', content: '{"hits":[]}' },
            { type: 'TOOL', content: 'tool output' },
            { type: 'FILE', content: 'file body' },
            { type: 'RESPONSE', content: '   ' }
          ]
        }
      ]
    }
  })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].text, 'answer')
})

test('normalizeHistory drops reasoning, system, empty and unknown-role records', () => {
  const messages = normalizeHistory({
    data: {
      chat_messages: [
        { role: 'USER', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'assistant', content: '', reasoning_content: 'step by step' },
        { role: 'assistant', fragments: [{ type: 'THINK', content: 'hidden thought' }] },
        { role: 'assistant', content: 'hidden', reasoning: true },
        { type: 'SYSTEM', content: 'system prompt' },
        { role: 'service', content: 'service record' },
        { role: 'USER', content: '   \n\t ' },
        { role: 'USER', content: 'third' }
      ]
    }
  })

  assert.equal(messages.length, 3)
  assert.deepEqual(messages.map((message) => message.text), ['first', 'second', 'third'])
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user'])
  assert.equal(messages[0].id, '')
})

test('normalizeHistory finds messages/history/items keys and normalizes message timestamps', () => {
  const fromMessages = normalizeHistory({
    data: {
      messages: [
        { id: 'a', role: 'user', content: 'q', created_at: '2024-01-02T03:04:05.678Z' },
        { id: 'b', role: 'assistant', content: 'a', timestamp: 1700000000 }
      ]
    }
  })
  assert.equal(fromMessages.length, 2)
  assert.equal(fromMessages[0].createdAt, Date.parse('2024-01-02T03:04:05.678Z'))
  assert.equal(fromMessages[1].createdAt, 1700000000000)
  assert.equal(fromMessages[0].id, 'a')

  const fromHistory = normalizeHistory({ result: { data: { history: [{ role: 'user', content: 'h' }] } } })
  assert.equal(fromHistory.length, 1)

  const fromItems = normalizeHistory({ data: { biz_data: { items: [{ role: 'user', content: 'i' }] } } })
  assert.equal(fromItems.length, 1)
})

test('normalizeHistory never throws on unusable payloads', () => {
  assert.deepEqual(normalizeHistory({}), [])
  assert.deepEqual(normalizeHistory(null), [])
  assert.deepEqual(normalizeHistory([]), [])
  assert.deepEqual(normalizeHistory({ code: 0, msg: 'bad' }), [])
  assert.deepEqual(normalizeHistory({ data: { biz_data: { chat_messages: [] } } }), [])
})

test('isReasoningRecord recognises flags, types, fragments and reasoning-only content', () => {
  assert.equal(isReasoningRecord({ reasoning: true }), true)
  assert.equal(isReasoningRecord({ is_reasoning: true }), true)
  assert.equal(isReasoningRecord({ thinking: '...' }), true)
  assert.equal(isReasoningRecord({ is_thinking: 1 }), true)
  assert.equal(isReasoningRecord({ cot: true }), true)
  assert.equal(isReasoningRecord({ thought: 'hmm' }), true)
  assert.equal(isReasoningRecord({ type: 'THINK' }), true)
  assert.equal(isReasoningRecord({ type: 'chain_of_thought' }), true)
  assert.equal(isReasoningRecord({ type: 'Summary-Of-Thinking' }), true)
  assert.equal(isReasoningRecord({ fragment: { type: 'reasoning' } }), true)
  assert.equal(isReasoningRecord({ fragments: [{ type: 'REQUEST' }, { type: 'ANALYSIS' }] }), true)
  assert.equal(isReasoningRecord({ role: 'assistant', content: '', reasoning_content: 'only reasoning' }), true)

  assert.equal(isReasoningRecord({ role: 'assistant', content: 'real answer', reasoning_content: 'some reasoning' }), false)
  assert.equal(isReasoningRecord({ role: 'user', content: 'hi' }), false)
  assert.equal(isReasoningRecord({ reasoning: false }), false)
  assert.equal(isReasoningRecord({ type: 'REQUEST' }), false)
  assert.equal(isReasoningRecord(null), false)
  assert.equal(isReasoningRecord('text'), false)
})

test('extractJsonText parses plain JSON and tolerates surrounding whitespace', () => {
  assert.deepEqual(extractJsonText('{"code":0,"msg":"","data":{"ok":true}}'), { code: 0, msg: '', data: { ok: true } })
  assert.deepEqual(extractJsonText('  {"y":3}\n'), { y: 3 })
  assert.deepEqual(extractJsonText('{"list":[1,2,3]}'), { list: [1, 2, 3] })
  assert.deepEqual(extractJsonText('[{"id":"a"}]'), [{ id: 'a' }])
})

test('extractJsonText unwraps SSE data lines', () => {
  assert.deepEqual(extractJsonText('data: {"code":0}'), { code: 0 })
  const multi = 'data: {}\n\ndata: {"code":0,"msg":"","data":{"biz_data":{"chat_messages":[]}}}'
  assert.deepEqual(extractJsonText(multi), { code: 0, msg: '', data: { biz_data: { chat_messages: [] } } })
  assert.equal(extractJsonText('data: [DONE]'), undefined)
})

test('extractJsonText strips anti-hijack prefixes', () => {
  assert.deepEqual(extractJsonText(")]}'\n{\"x\":1}"), { x: 1 })
  assert.deepEqual(extractJsonText('for(;;);{"x":2}'), { x: 2 })
  assert.deepEqual(extractJsonText('for(;;);jsonp({"x":3})'), { x: 3 })
})

test('extractJsonText never throws and returns undefined for garbage', () => {
  assert.equal(extractJsonText('<html><body>502 Bad Gateway</body></html>'), undefined)
  assert.equal(extractJsonText(''), undefined)
  assert.equal(extractJsonText('   '), undefined)
  assert.equal(extractJsonText(null), undefined)
  assert.equal(extractJsonText(undefined), undefined)
  assert.equal(extractJsonText(42), undefined)
  assert.equal(extractJsonText('{"broken": '), undefined)
})

// Bodies captured from the live origin on 2026-10-27 (HTTP 200 for every one of them).
test('deepseekFailure reads the live error envelopes', () => {
  assert.deepEqual(deepseekFailure({ code: 40002, msg: 'Missing Token', data: null }), {
    code: 40002,
    message: 'Missing Token'
  })
  assert.deepEqual(deepseekFailure({ code: 40003, msg: 'INVALID_TOKEN', data: null }), {
    code: 40003,
    message: 'INVALID_TOKEN'
  })
  // A string code and a different message field are both accepted.
  assert.deepEqual(deepseekFailure({ code: '40003', message: 'nope', data: undefined }), {
    code: 40003,
    message: 'nope'
  })
  // No envelope error when the call succeeded.
  assert.equal(deepseekFailure({ code: 0, msg: '', data: { biz_data: { chat_sessions: [] } } }), undefined)
  // A zero code with no data is an empty success, not an error.
  assert.equal(deepseekFailure({ code: 0, msg: 'no data' }), undefined)
  // A non-zero code that still carries data is not an auth/envelope failure.
  assert.equal(deepseekFailure({ code: 7, msg: 'partial', data: { items: [] } }), undefined)
  // No code at all.
  assert.equal(deepseekFailure({ data: { biz_data: { chat_sessions: [] } } }), undefined)
  assert.equal(deepseekFailure([]), undefined)
  assert.equal(deepseekFailure(null), undefined)
  assert.equal(deepseekFailure('text'), undefined)
  // The raw body from the wire round-trips through the parser into the same failure.
  assert.equal(deepseekFailure(extractJsonText('{"code":40002,"msg":"Missing Token","data":null}')).message, 'Missing Token')
})

test('isAuthFailure separates a signed-out session from a retryable error', () => {
  assert.equal(isAuthFailure({ code: 40002, message: 'Missing Token' }), true)
  assert.equal(isAuthFailure({ code: 40003, message: 'INVALID_TOKEN' }), true)
  assert.equal(isAuthFailure({ code: '40001', message: '' }), true)
  // Message-only detection covers unknown codes.
  assert.equal(isAuthFailure({ code: 99999, message: 'please log in' }), true)
  assert.equal(isAuthFailure({ code: 50000, message: 'internal error' }), false)
  assert.equal(isAuthFailure(undefined), false)
})

// Regression: a real assistant turn is `fragments: [RESPONSE, THINK]`, so a THINK fragment
// next to the answer used to disqualify the whole message and the archive held only the
// user's prompts. Live symptom reported by the user on 2026-10-28.
test('an answer that also carries a THINK fragment is kept, only its reasoning is dropped', () => {
  const answer = {
    role: 'ASSISTANT',
    content: 'Это ответ ассистента',
    fragments: [
      { type: 'RESPONSE', content: 'Это ответ ассистента' },
      { type: 'THINK', content: 'длинная цепочка рассуждений' }
    ]
  }

  assert.equal(isReasoningRecord(answer), false)

  const messages = normalizeHistory({
    data: {
      biz_data: {
        chat_messages: [{ role: 'USER', content: 'Вопрос' }, answer]
      }
    }
  })
  assert.equal(messages.length, 2)
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(messages[1].text, 'Это ответ ассистента')
  assert.ok(!messages[1].text.includes('рассуждений'))
})

test('a record whose whole payload is reasoning is still dropped', () => {
  assert.equal(isReasoningRecord({ role: 'ASSISTANT', fragments: [{ type: 'THINK', content: 'only' }] }), true)
  assert.equal(isReasoningRecord({ role: 'ASSISTANT', content: '', reasoning_content: 'only' }), true)
  assert.equal(isReasoningRecord({ role: 'ASSISTANT', content: '', thinking_content: 'only' }), true)
  assert.equal(isReasoningRecord({ role: 'ASSISTANT', content: 'answer', fragments: [{ type: 'THINK' }] }), false)
})

// Live symptom (2026-10-28): the archive kept the answer text with raw `[reference:N]`
// markers and no URLs, and search-status copy leaked in as if it were the answer.
const searchAnswerPayload = () => ({
  code: 0,
  msg: '',
  data: {
    biz_code: 0,
    biz_data: {
      chat_messages: [
        {
          message_id: 1,
          role: 'USER',
          content: 'Найди лучшие обратные прокси',
          fragments: [{ id: 1, type: 'REQUEST', content: 'Найди лучшие обратные прокси' }]
        },
        {
          message_id: 2,
          role: 'ASSISTANT',
          content: 'NPM — лучший выбор[reference:0][reference:1].',
          fragments: [
            {
              id: 2,
              type: 'SEARCH',
              content: 'Found 28 web pages',
              results: [
                { url: 'https://nginxproxymanager.com/', title: 'Nginx Proxy Manager' },
                { url: 'https://caddyserver.com/', title: 'Caddy' },
                { url: 'https://nginxproxymanager.com/', title: 'duplicate row' }
              ]
            },
            { id: 3, type: 'RESPONSE', content: 'NPM — лучший выбор[reference:0][reference:1].' },
            { id: 4, type: 'THINK', content: 'внутренние рассуждения' }
          ]
        }
      ]
    }
  }
})

test('collectReferences gathers unique http(s) sources and ignores other protocols', () => {
  const references = collectReferences(searchAnswerPayload())
  assert.deepEqual(references.map((reference) => reference.url), [
    'https://nginxproxymanager.com/',
    'https://caddyserver.com/'
  ])
  assert.equal(references[0].title, 'Nginx Proxy Manager')

  const filtered = collectReferences({
    data: {
      chat_messages: [
        {
          role: 'ASSISTANT',
          content: 'answer',
          fragments: [
            {
              type: 'SEARCH',
              results: [
                { url: 'javascript:alert(1)' },
                { link: 'ftp://example.com/x' },
                { href: 'https://ok.example/a' }
              ]
            }
          ]
        }
      ]
    }
  })
  assert.deepEqual(filtered.map((reference) => reference.url), ['https://ok.example/a'])
})

test('answer sources are preserved as numbered links plus a sources list', () => {
  const messages = normalizeHistory(searchAnswerPayload())
  assert.equal(messages.length, 2)
  const answer = messages[1].text

  assert.ok(answer.includes('[1](https://nginxproxymanager.com/)[2](https://caddyserver.com/)'), 'markers became links')
  assert.ok(answer.includes('**Источники:**'), 'a sources list is appended')
  assert.ok(answer.includes('1. [Nginx Proxy Manager](https://nginxproxymanager.com/)'))
  assert.ok(answer.includes('2. [Caddy](https://caddyserver.com/)'))
  assert.ok(!answer.includes('[reference:0]'), 'no raw markers are left when they resolve')
  assert.ok(!answer.includes('Found 28 web pages'), 'search-status copy is not part of the answer')
  assert.ok(!answer.includes('внутренние рассуждения'), 'reasoning text stays out')
  assert.ok(!messages[0].text.includes('**Источники:**'), 'sources belong to the answer, not the prompt')

  // The same payload through the accounting helper: sources are counted, and the fragment
  // census shows which types the payload carries (diagnostics rely on both).
  const explained = explainHistory(searchAnswerPayload())
  assert.equal(explained.sources, 2)
  assert.deepEqual(explained.fragmentTypes, { request: 1, search: 1, response: 1, think: 1 })
})

test('a chat without sources keeps its text untouched', () => {
  const messages = normalizeHistory({ data: { chat_messages: [{ role: 'USER', content: 'привет' }, { role: 'ASSISTANT', content: 'ответ' }] } })
  assert.deepEqual(messages.map((message) => message.text), ['привет', 'ответ'])
  assert.ok(!messages[1].text.includes('**Источники:**'))
})

test('explainHistory accounts for every raw record without exposing text', () => {
  const explained = explainHistory({
    data: {
      biz_data: {
        chat_messages: [
          { role: 'USER', content: 'вопрос' },
          { role: 'ASSISTANT', content: 'ответ', fragments: [{ type: 'RESPONSE', content: 'ответ' }, { type: 'THINK', content: 'x' }] },
          { role: 'ASSISTANT', fragments: [{ type: 'THINK', content: 'only thinking' }] },
          { role: 'SYSTEM', content: 'служебное' },
          { role: 'USER', content: '   ' },
          'not a record'
        ]
      }
    }
  })
  assert.equal(explained.found, true)
  assert.equal(explained.records, 6)
  assert.equal(explained.kept, 2)
  assert.equal(explained.users, 1)
  assert.equal(explained.assistants, 1)
  assert.deepEqual(explained.dropped, { reasoning: 1, role: 1, empty: 1, notRecord: 1 })

  assert.deepEqual(explainHistory({}), {
    found: false,
    records: 0,
    kept: 0,
    users: 0,
    assistants: 0,
    dropped: { reasoning: 0, role: 0, empty: 0, notRecord: 0 },
    fragmentTypes: {},
    sources: 0
  })
})
