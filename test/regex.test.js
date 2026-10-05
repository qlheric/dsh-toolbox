import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assertFlags, explainPattern, screenReDoS, spec } from '../lib/regex.js'

test('flag 白名单与去重', () => {
  assert.equal(assertFlags('gi'), 'gi')
  assert.throws(() => assertFlags('gz'), /不支持的 flag/)
  assert.throws(() => assertFlags('gg'), /重复/)
})

test('静态 ReDoS 体检分级', () => {
  assert.equal(screenReDoS('^abc$').level, 'none')
  assert.equal(screenReDoS('(a+)+').level, 'high')
  assert.equal(screenReDoS('(\\w*)*').level, 'high')
  assert.equal(screenReDoS('(a|ab)+').level, 'medium')
  assert.equal(screenReDoS('.*.*').level, 'low')
  const report = screenReDoS('(a+)+')
  assert.equal(report.findings.length > 0, true)
  assert.match(report.note, /启发式/)
})

test('high 风险 + 大输入 ⇒ 拒绝执行（不是硬跑）', () => {
  const big = 'a'.repeat(5000)
  const result = spec.execute({ action: 'test', pattern: '(a+)+', input: big })
  assert.equal(result.ok, false)
  assert.equal(result.refused, true)
  assert.match(result.reason, /拒绝执行/)
  // 小输入允许执行，但仍带风险标记
  const small = spec.execute({ action: 'test', pattern: '(a+)+', input: 'aaa' })
  assert.equal(small.ok, true)
  assert.equal(small.matched, true)
  assert.equal(small.redos.level, 'high')
})

test('find 带编号/命名捕获与下标', () => {
  const result = spec.execute({ action: 'find', pattern: '(?<y>\\d{4})-(\\d{2})', input: '2026-10 2027-11', limit: 5 })
  assert.equal(result.matchCount, 2)
  assert.equal(result.matches[0].text, '2026-10')
  assert.deepEqual(result.matches[0].groups, ['2026', '10']) // 含命名组在内的全部捕获组
  assert.equal(result.matches[0].named.y, '2026')
  assert.equal(result.matches[1].index, 8)
})

test('replace 支持 $1 与 $<name>', () => {
  const numbered = spec.execute({ action: 'replace', pattern: '(\\w+)@(\\w+)', input: 'a@b c@d', replacement: '$2:$1' })
  assert.equal(numbered.value, 'b:a d:c')
  assert.equal(numbered.replaced, true)
  const named = spec.execute({ action: 'replace', pattern: '(?<k>\\w+)=(\\d+)', input: 'x=1', replacement: '$<k>→$2' })
  assert.equal(named.value, 'x→1')
})

test('explain 静态拆解不执行', () => {
  const nodes = explainPattern('^(?<id>\\d+)-(\\w{2,3})$')
  const kinds = nodes.map((n) => n.kind)
  assert.ok(kinds.includes('anchor'))
  assert.ok(kinds.includes('group'))
  assert.ok(kinds.includes('quantifier'))
  assert.ok(kinds.includes('escape'))
  const named = nodes.find((n) => n.note === '命名捕获组')
  assert.equal(named.text, '(?<id>…')
  const result = spec.execute({ action: 'explain', pattern: 'a|b' })
  assert.equal(result.nodes.some((n) => n.kind === 'alternation'), true)
  assert.throws(() => spec.execute({ action: 'explain', pattern: '' }), /需要 pattern/)
})

test('输入与模式上限', () => {
  assert.throws(() => spec.execute({ action: 'test', pattern: 'x'.repeat(20_000), input: 'x' }), /过长/)
  assert.throws(() => spec.execute({ action: 'test', pattern: 'x', input: 'y'.repeat(70_000) }), /input 过大/)
  assert.throws(() => spec.execute({ action: 'test', pattern: 'x' }), /需要 input/)
})
