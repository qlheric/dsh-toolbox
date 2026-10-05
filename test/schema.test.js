import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyDefaults, explainSchema, spec, validate } from '../lib/schema.js'

const SCHEMA = {
  type: 'object',
  required: ['id', 'name'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 10 },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 3 },
    mode: { type: 'string', enum: ['a', 'b'] },
    score: { type: 'number', multipleOf: 0.5 },
    nested: { $ref: '#/$defs/leaf' },
  },
  $defs: { leaf: { type: 'object', required: ['v'], properties: { v: { const: 42 } } } },
}

test('合法数据判过', () => {
  const result = validate({ id: 1, name: 'ok', tags: ['x', 'y'], mode: 'a', score: 1.5, nested: { v: 42 } }, SCHEMA)
  assert.equal(result.valid, true)
  assert.equal(result.complete, true)
  assert.equal(result.errorCount, 0)
})

test('错误带 RFC 6901 路径与关键字', () => {
  const result = validate({ id: 0, name: '', tags: ['x', 'x', 'y', 'z'], mode: 'c', score: 0.3, nested: { v: 1 }, extra: 1 }, SCHEMA)
  assert.equal(result.valid, false)
  const keys = result.errors.map((e) => `${e.instancePath}:${e.keyword}`)
  assert.ok(keys.includes(':required') === false) // id/name 都在，缺的是别的
  assert.ok(keys.includes('/id:minimum'))
  assert.ok(keys.includes('/name:minLength'))
  assert.ok(keys.includes('/tags/1:uniqueItems'))
  assert.ok(keys.includes('/tags:maxItems'))
  assert.ok(keys.includes('/mode:enum'))
  assert.ok(keys.includes('/score:multipleOf'))
  assert.ok(keys.includes('/nested/v:const'))
  assert.ok(keys.includes(':additionalProperties'))
})

test('缺必填与 $ref 解析', () => {
  const missing = validate({ name: 'x' }, SCHEMA)
  const required = missing.errors.find((e) => e.keyword === 'required')
  assert.equal(required.missing, 'id')
  const badRef = validate({ id: 1, name: 'x', nested: {} }, SCHEMA)
  assert.ok(badRef.errors.some((e) => e.instancePath === '/nested' && e.keyword === 'required'))
  assert.throws(() => validate({}, { $ref: '#/$defs/nope', $defs: {} }), /解析失败/)
  assert.throws(() => validate({}, { $ref: 'https://x/y' }), /只支持本地 \$ref/)
})

test('anyOf / oneOf / not / allOf', () => {
  assert.equal(validate(3, { anyOf: [{ type: 'string' }, { type: 'integer' }] }).valid, true)
  assert.equal(validate(true, { anyOf: [{ type: 'string' }, { type: 'integer' }] }).valid, false)
  const oneOf = validate(3, { oneOf: [{ type: 'integer' }, { type: 'number' }] })
  assert.equal(oneOf.valid, false)
  assert.equal(oneOf.errors[0].keyword, 'oneOf')
  assert.equal(oneOf.errors[0].matched, 2)
  assert.equal(validate('x', { not: { type: 'string' } }).valid, false)
  assert.equal(validate({ a: 1, b: 2 }, { allOf: [{ required: ['a'] }, { required: ['b'] }] }).valid, true)
})

test('不支持的关键字绝不静默忽略', () => {
  const strict = validate(1, { type: 'number', multipleOf: 1, unevaluatedProperties: false })
  assert.equal(strict.valid, false)
  assert.equal(strict.complete, false)
  assert.equal(strict.schemaIssues[0].code, 'unsupported-keyword')
  assert.equal(strict.schemaIssues[0].keyword, 'unevaluatedProperties')
  const lax = validate(1, { type: 'number', unevaluatedProperties: false }, { strictSchema: false })
  assert.equal(lax.valid, null)
  assert.equal(lax.complete, false)
})

test('normalize 套用 default 且不改原对象', () => {
  const schema = { type: 'object', properties: { a: { type: 'integer', default: 7 }, b: { type: 'object', properties: { c: { type: 'string', default: 'z' } } } } }
  const original = { b: {} }
  const result = spec.execute({ action: 'normalize', schema, data: original })
  assert.deepEqual(result.normalized, { a: 7, b: { c: 'z' } })
  assert.deepEqual(original, { b: {} }) // 原对象未被改
  assert.equal(result.changed, true)
  assert.equal(result.valid, true)
})

test('paths 汇总与 explain 静态树', () => {
  const paths = spec.execute({ action: 'paths', schema: SCHEMA, data: { id: 0, name: '', mode: 'c' } })
  assert.equal(paths.valid, false)
  assert.ok(paths.paths.includes('/id'))
  assert.equal(paths.byKeyword.enum, 1)
  const explained = spec.execute({ action: 'explain', schema: SCHEMA })
  const keywords = explained.nodes.map((n) => n.keyword)
  assert.ok(keywords.includes('type'))
  assert.ok(keywords.includes('required'))
  assert.ok(keywords.includes('$ref'))
  assert.ok(explained.nodes.some((n) => n.path === '#/properties/id' && n.keyword === 'minimum'))
})

test('规模守卫与布尔 schema', () => {
  assert.equal(validate(1, true).valid, true)
  assert.equal(validate(1, false).valid, false)
  const big = { type: 'string', pattern: 'x'.repeat(300_000) }
  assert.throws(() => validate('x', big), /schema 过大/)
  assert.deepEqual(applyDefaults(1, { type: 'integer', default: 5 }), 1)
})
