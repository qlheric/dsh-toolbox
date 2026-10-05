import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectHeadings, normalizeTable, slugify, spec, summarize, toPlainText } from '../lib/markdown.js'

const DOC = [
  '# 标题一',
  '',
  '正文 **加粗** 与 `代码`，链接 [x](https://e.com)。',
  '',
  '```js',
  '# 这不是标题',
  '```',
  '',
  '## 子标题 A（含标点！）',
  '',
  '### 深层 B',
  '',
  '## 子标题 A（含标点！）',
  '',
].join('\n')

test('锚点规则与中文保留', () => {
  assert.equal(slugify('子标题 A（含标点！）'), '子标题-a含标点')
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('  a   b  '), 'a-b')
})

test('标题收集跳过代码块', () => {
  const headings = collectHeadings(DOC)
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 3, 2])
  assert.equal(headings[0].text, '标题一')
  assert.equal(headings[0].line, 1)
  assert.equal(headings.some((h) => h.text.includes('这不是标题')), false)
})

test('目录按层级缩进且含重复标题', () => {
  const toc = spec.execute({ action: 'toc', markdown: DOC }).toc
  const lines = toc.split('\n')
  assert.match(lines[0], /^- \[标题一\]\(#标题一\)$/)
  assert.match(lines[1], /^ {2}- \[子标题 A（含标点！）\]\(#子标题-a含标点\)$/)
  assert.match(lines[2], /^ {4}- \[深层 B\]\(#深层-b\)$/)
  assert.equal(lines.length, 4)
  const limited = spec.execute({ action: 'toc', markdown: DOC, minLevel: 2, maxLevel: 2 }).toc
  assert.equal(limited.split('\n').length, 2)
})

test('表格规范化：管道与 HTML', () => {
  const piped = normalizeTable('a | b\n1 | 2\n3 | 4')
  assert.equal(piped.split('\n')[0], '| a | b |')
  assert.equal(piped.split('\n')[1], '| --- | --- |')
  const html = normalizeTable('<table><tr><th>名</th><th>值</th></tr><tr><td>甲</td><td>1 &amp; 2</td></tr></table>')
  assert.equal(html.split('\n')[0], '| 名 | 值 |')
  assert.match(html, /\| 甲 \| 1 & 2 \|/)
  const ragged = normalizeTable('a|b|c\n1|2')
  assert.equal(ragged.split('\n')[2], '| 1 | 2 |  |')
  assert.throws(() => spec.execute({ action: 'table', text: '' }), /需要 text/)
})

test('to_text 去标记', () => {
  const text = toPlainText('# H\n\n> 引用\n\n- 项 **粗**\n\n[链接](http://x) 与 ![图](http://y)\n')
  assert.equal(text.includes('#'), false)
  assert.equal(text.includes('**'), false)
  assert.match(text, /引用/)
  assert.match(text, /链接 与 图/)
})

test('stats 计数口径', () => {
  const stats = summarize(DOC)
  assert.equal(stats.headings, 4)
  assert.equal(stats.headingDepth, 3)
  assert.equal(stats.codeBlocks, 1)
  assert.equal(stats.links, 1)
  assert.ok(stats.cjkCharacters > 10)
  assert.equal(stats.bytes > stats.characters, true) // 中文 UTF-8 字节数 > 字符数
})

test('spec.execute 守卫', () => {
  assert.throws(() => spec.execute({ action: 'headings', markdown: 123 }), /必须是字符串/)
  assert.throws(() => spec.execute({ action: 'nope', markdown: '' }), /不支持的 action/)
})
