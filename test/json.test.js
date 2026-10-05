import { test } from 'node:test'
import assert from 'node:assert/strict'

import { query, parsePath, spec, typeName } from '../lib/json.js'

const SAMPLE = {
  ok: true,
  data: {
    items: [
      { name: 'a', score: 1, tags: ['x'] },
      { name: 'b', score: 2, tags: ['y', 'z'] },
    ],
    'weird key': { nested: [10, 20] },
  },
}

test('路径解析', () => {
  assert.deepEqual(parsePath('$'), [])
  assert.deepEqual(parsePath('$.a.b'), [{ kind: 'key', key: 'a' }, { kind: 'key', key: 'b' }])
  assert.deepEqual(parsePath("data['weird key'].nested[1]"), [
    { kind: 'key', key: 'data' },
    { kind: 'key', key: 'weird key' },
    { kind: 'key', key: 'nested' },
    { kind: 'index', index: 1 },
  ])
  assert.throws(() => parsePath('$.a[unquoted]'), /不合法/)
})

test('取值：点号 / 下标 / 负数下标 / 通配', () => {
  assert.equal(query(SAMPLE, '$.data.items[0].name').value, 'a')
  assert.equal(query(SAMPLE, '$.data.items[-1].name').value, 'b')
  assert.deepEqual(query(SAMPLE, '$.data.items[*].name').value, ['a', 'b'])
  assert.deepEqual(query(SAMPLE, '$.data.items[*].tags[*]').value, [['x'], ['y', 'z']])
  assert.equal(query(SAMPLE, "$.data['weird key'].nested[0]").value, 10)
})

test('取值失败给原因而不是抛异常', () => {
  const missing = query(SAMPLE, '$.data.nope')
  assert.equal(missing.found, false)
  assert.match(missing.reason, /不存在键/)
  const wrongType = query(SAMPLE, '$.ok[0]')
  assert.equal(wrongType.found, false)
  assert.match(wrongType.reason, /只能用在数组/)
  const outOfRange = query(SAMPLE, '$.data.items[9]')
  assert.equal(outOfRange.found, false)
  assert.match(outOfRange.reason, /越界/)
})

test('action: keys / type / validate / format', () => {
  assert.deepEqual(spec.execute({ input: SAMPLE, action: 'keys', path: '$.data.items[0]' }).keys, ['name', 'score', 'tags'])
  assert.equal(spec.execute({ input: SAMPLE, action: 'type', path: '$.data.items' }).type, 'array')
  const invalid = spec.execute({ input: '{"a": 1,}', action: 'validate' })
  assert.equal(invalid.valid, false)
  assert.equal(typeof invalid.message, 'string')
  const formatted = spec.execute({ input: { a: 1, b: [2] }, action: 'format', indent: 2 })
  assert.equal(formatted.text, '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
  const minified = spec.execute({ input: { a: 1 }, action: 'format', indent: 0 })
  assert.equal(minified.text, '{"a":1}')
})

test('input 允许传 JSON 字符串', () => {
  assert.equal(spec.execute({ input: '{"a":{"b":7}}', action: 'get', path: '$.a.b' }).value, 7)
  assert.throws(() => spec.execute({ input: '{bad', action: 'get' }), /不是合法 JSON/)
})

test('typeName 口径', () => {
  assert.equal(typeName(null), 'null')
  assert.equal(typeName([]), 'array')
  assert.equal(typeName(1), 'number')
})
