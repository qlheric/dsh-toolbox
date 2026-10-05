import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluate } from '../lib/calculator.js'
import { spec } from '../lib/calculator.js'

test('算符优先级与结合性', () => {
  assert.equal(evaluate('1+2*3'), 7)
  assert.equal(evaluate('(1+2)*3'), 9)
  assert.equal(evaluate('2^3^2'), 512) // 右结合
  assert.equal(evaluate('-2^2'), -4) // 一元负号弱于 ^
  assert.equal(evaluate('10 % 3'), 1)
  assert.equal(evaluate('7 / 2'), 3.5)
})

test('常量与函数', () => {
  assert.equal(evaluate('sqrt(16)'), 4)
  assert.equal(evaluate('max(1, 5, 3)'), 5)
  assert.equal(evaluate('pow(2, 10)'), 1024)
  assert.equal(evaluate('log(8, 2)'), 3)
  assert.ok(Math.abs(evaluate('sin(pi/2)') - 1) < 1e-12)
  assert.ok(Math.abs(evaluate('e') - Math.E) < 1e-12)
})

test('拒绝非算式内容（无 eval 面）', () => {
  assert.throws(() => evaluate('process.exit(1)'), /未知函数或常量|不支持的字符/)
  assert.throws(() => evaluate('1;2'), /不支持的字符/)
  assert.throws(() => evaluate('globalThis'), /未知函数或常量/)
  assert.throws(() => evaluate(''), /非空字符串/)
  assert.throws(() => evaluate('1/0'), /不是有限数/)
})

test('spec.execute 形状与 precision', () => {
  const plain = spec.execute({ expression: '1/3' })
  assert.equal(plain.ok, true)
  assert.equal(plain.expression, '1/3')
  const rounded = spec.execute({ expression: '1/3', precision: 4 })
  assert.equal(rounded.rounded, 0.3333)
  assert.equal(rounded.precision, 4)
})

test('spec 只用 rc.2 允许的 schema 词汇', () => {
  const allowed = new Set(['type', 'required', 'description', 'default', 'enum', 'items', 'properties', 'additionalProperties', 'title', 'examples', 'const', 'oneOf'])
  for (const [key, schema] of Object.entries(spec.parameters)) {
    for (const field of Object.keys(schema)) {
      assert.ok(allowed.has(field), `参数 ${key} 用了不支持的字段 ${field}`)
    }
    if ('required' in schema) assert.equal(schema.required, true, `参数 ${key} 的 required 只能是 true`)
  }
})
