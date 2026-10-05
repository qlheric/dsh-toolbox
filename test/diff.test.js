import { test } from 'node:test'
import assert from 'node:assert/strict'

import { jsonDiff, splitLines, spec, unifiedDiff } from '../lib/diff.js'

test('splitLines 归一化 CRLF 与尾换行', () => {
  assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b'])
  assert.deepEqual(splitLines(''), []) // 空文档 = 零行（不是一行空行）
  assert.deepEqual(splitLines('a'), ['a'])
  assert.deepEqual(splitLines('a\n\n'), ['a', '']) // 中间的空行保留
})

test('unified diff 统计与内容', () => {
  const result = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n')
  assert.equal(result.added, 1)
  assert.equal(result.removed, 1)
  assert.equal(result.hunks, 1)
  assert.match(result.unified, /@@ -1,3 \+1,3 @@/)
  assert.match(result.unified, /-b/)
  assert.match(result.unified, /\+B/)
  assert.equal(spec.execute({ left: 'x', right: 'x', mode: 'text' }).identical, true)
})

test('超过 maxLines 走兜底路径而不是卡死', () => {
  const left = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
  const right = Array.from({ length: 50 }, (_, i) => `line${i === 25 ? 'X' : i}`).join('\n')
  const result = unifiedDiff(left, right, 1, 10)
  assert.equal(result.added, 1)
  assert.equal(result.removed, 1)
  assert.match(result.unified, /lineX/)
})

test('jsonDiff 给出路径级增减改', () => {
  const changes = jsonDiff({ a: 1, b: { c: 2 }, gone: true }, { a: 1, b: { c: 3 }, added: [1] })
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c.op]))
  assert.equal(byPath['$.b.c'], 'change')
  assert.equal(byPath['$.gone'], 'remove')
  assert.equal(byPath['$.added'], 'add')
  assert.equal(jsonDiff([1, 2, 3], [1, 9, 3, 4]).length, 2)
  assert.equal(jsonDiff(1, '1')[0].kind, 'number→string')
})

test('csv 模式按行比较并报告表头是否一致', () => {
  const left = 'id,name\n1,a\n2,b\n'
  const right = 'id,name\n1,a\n2,B\n3,c\n'
  const result = spec.execute({ left, right, mode: 'csv' })
  assert.equal(result.headerMatches, true)
  assert.equal(result.rowsLeft, 2)
  assert.equal(result.rowsRight, 3)
  assert.equal(result.addedRows, 2) // 2,B 与 3,c
  assert.equal(result.removedRows, 1) // 2,b
  const headerMismatch = spec.execute({ left: 'a\n1\n', right: 'b\n1\n', mode: 'csv' })
  assert.equal(headerMismatch.headerMatches, false)
})

test('json 模式接受 JSON 字符串并守住非法输入', () => {
  const result = spec.execute({ left: '{"a":1}', right: '{"a":2}', mode: 'json' })
  assert.equal(result.changeCount, 1)
  assert.equal(result.changes[0].from, 1)
  assert.equal(result.changes[0].to, 2)
  assert.throws(() => spec.execute({ left: '{oops', right: '{}', mode: 'json' }), /不是合法 JSON/)
  assert.throws(() => spec.execute({ left: 'a', right: 'b', mode: 'yaml' }), /不支持的 mode/)
})
