import { test } from 'node:test'
import assert from 'node:assert/strict'

import { columnIndexOf, describeNumbers, parseCsv, spec } from '../lib/csv.js'

test('RFC 4180：引号内逗号/换行/双引号转义', () => {
  const text = 'id,name,note\n1,"a,b","he said ""hi""\nsecond line"\n2,c,\n'
  const parsed = parseCsv(text)
  assert.deepEqual(parsed.header, ['id', 'name', 'note'])
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.objects[0].name, 'a,b')
  assert.equal(parsed.objects[0].note, 'he said "hi"\nsecond line')
  assert.equal(parsed.objects[1].note, '')
})

test('BOM 与 CRLF 与无表头', () => {
  const withBom = '\ufeffa,b\r\n1,2\r\n'
  assert.deepEqual(parseCsv(withBom).header, ['a', 'b'])
  assert.deepEqual(parseCsv(withBom).rows, [['1', '2']])
  const noHeader = parseCsv('1,2\n3,4', ',', false)
  assert.deepEqual(noHeader.rows, [['1', '2'], ['3', '4']])
})

test('分隔符与列定位', () => {
  const tsv = 'a\tb\n1\t2'
  assert.deepEqual(parseCsv(tsv, 'tab').header, ['a', 'b'])
  assert.equal(columnIndexOf(['a', 'b'], 'b'), 1)
  assert.equal(columnIndexOf(['a', 'b'], '2'), 1)
  assert.throws(() => columnIndexOf(['a'], 'zz'), /没有列/)
})

test('描述统计（样本标准差）', () => {
  const d = describeNumbers([1, 2, 3, 4])
  assert.equal(d.count, 4)
  assert.equal(d.sum, 10)
  assert.equal(d.mean, 2.5)
  assert.equal(d.median, 2.5)
  assert.equal(d.min, 1)
  assert.equal(d.max, 4)
  assert.equal(Number(d.standardDeviation.toFixed(6)), 1.290994)
  assert.equal(describeNumbers([Number.NaN]).count, 0)
})

test('spec.execute 全 action', () => {
  const csv = 'id,name,score\n1,a,10\n2,b,20\n3,a,30\n'
  assert.equal(spec.execute({ action: 'stats', csv }).rowCount, 3)
  const q = spec.execute({ action: 'query', csv, column: 'name', value: 'a' })
  assert.equal(q.matchCount, 2)
  assert.equal(q.rows[0].id, '1')
  const s = spec.execute({ action: 'summarize', csv, column: 'score' })
  assert.equal(s.columns.score.mean, 20)
  assert.equal(s.columns.score.nonEmpty, 3)
  const md = spec.execute({ action: 'to_markdown', csv, limit: 1 })
  assert.match(md.markdown, /^\| id \| name \| score \|\n\| --- \| --- \| --- \|/)
  const parsed = spec.execute({ action: 'parse', csv })
  assert.equal(parsed.rowCount, 3)
  assert.throws(() => spec.execute({ action: 'query', csv, column: 'name' }), /需要 value/)
  assert.throws(() => spec.execute({ action: 'nope', csv }), /不支持的 action/)
})
