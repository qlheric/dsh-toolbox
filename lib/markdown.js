/**
 * markdown —— Markdown 文本工具（零依赖，纯函数）。
 *
 * action:
 *   headings  列标题（层级/文本/行号/锚点）
 *   toc       生成嵌套目录（GFM 锚点规则）
 *   table     把管道表格或 HTML <table> 规范成 GFM 表格
 *   to_text   去掉 Markdown 标记的纯文本（供摘要/检索）
 *   stats     字数/行数/标题数/代码块数/链接数
 *
 * 口径：GFM 锚点 = 小写、去标点、空格转 -、连续 - 合并、去首尾 -；非 ASCII 字符保留。
 */

const MAX_BYTES = 1_000_000

function assertText(text, field = 'markdown') {
  if (typeof text !== 'string') throw new Error(`${field} 必须是字符串`)
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${field} 过大（>${MAX_BYTES} 字节）`)
  return text
}

export function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()#>!]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function collectHeadings(markdown) {
  const headings = []
  let inFence = false
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (match === null) continue
    const text = match[2].replace(/[`*_]/g, '')
    headings.push({ level: match[1].length, text, line: i + 1, anchor: slugify(text) })
  }
  return headings
}

export function renderToc(headings, { minLevel = 1, maxLevel = 6, indent = '  ' } = {}) {
  const kept = headings.filter((h) => h.level >= minLevel && h.level <= maxLevel)
  if (kept.length === 0) return ''
  const base = Math.min(...kept.map((h) => h.level))
  return kept.map((h) => `${indent.repeat(Math.max(0, h.level - base))}- [${h.text}](#${h.anchor})`).join('\n')
}

export function normalizeTable(input) {
  const text = input.trim()
  if (text.startsWith('<')) return htmlTableToMarkdown(text)
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const trimmed = line.replace(/^\|/, '').replace(/\|$/, '')
      return trimmed.split('|').map((cell) => cell.trim())
    })
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)))
  if (rows.length === 0) throw new Error('table 输入里没有可识别的数据行')
  const width = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')])
  const escape = (cell) => cell.replace(/\|/g, '\\|')
  return [padded[0], Array(width).fill('---'), ...padded.slice(1)]
    .map((r) => `| ${r.map(escape).join(' | ')} |`)
    .join('\n')
}

function htmlTableToMarkdown(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  )
  if (rows.length === 0) throw new Error('HTML 里没有 <tr> 行')
  const width = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')])
  return [padded[0], Array(width).fill('---'), ...padded.slice(1)]
    .map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`)
    .join('\n')
}

export function toPlainText(markdown) {
  let text = markdown
  text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
  text = text.replace(/^\s{0,3}([-*_])\s*\1\s*\1[\s\S]*?$/gm, '')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/~~(.*?)~~/g, '$1')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function summarize(markdown) {
  const headings = collectHeadings(markdown)
  const plain = toPlainText(markdown)
  const codeBlocks = (markdown.match(/^\s{0,3}(```|~~~)/gm) ?? []).length
  return {
    lines: markdown.split('\n').length,
    bytes: Buffer.byteLength(markdown),
    characters: markdown.length,
    words: plain === '' ? 0 : plain.split(/\s+/).filter(Boolean).length,
    cjkCharacters: (plain.match(/[\u4e00-\u9fff]/g) ?? []).length,
    headings: headings.length,
    headingDepth: headings.reduce((max, h) => Math.max(max, h.level), 0),
    codeFenceMarkers: codeBlocks,
    codeBlocks: Math.floor(codeBlocks / 2),
    links: (markdown.match(/\[[^\]]*\]\([^)]*\)/g) ?? []).length,
    images: (markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length,
    tables: (markdown.match(/^\s*\|.*\|\s*$/gm) ?? []).length,
  }
}

export const spec = {
  name: 'markdown',
  description:
    'Markdown 工具：headings 列标题（层级/行号/锚点，自动跳过代码块）；toc 生成嵌套目录（GFM 锚点）；' +
    'table 把管道表格或 HTML <table> 规范成 GFM 表格；to_text 去掉标记得纯文本；stats 给字数/标题/代码块/链接/表格计数。' +
    '口径：锚点 = 小写、去标点、空格转连字符、合并连续连字符；中文字符保留。纯文本处理，不读写文件。',
  parameters: {
    action: { type: 'string', enum: ['headings', 'toc', 'table', 'to_text', 'stats'], required: true, description: '要做的操作' },
    markdown: { type: 'string', description: 'Markdown 文本（headings/toc/to_text/stats 用）' },
    text: { type: 'string', description: 'table 的输入（管道表格或 HTML <table>）' },
    minLevel: { type: 'integer', default: 1, description: 'toc 收录的最小标题层级' },
    maxLevel: { type: 'integer', default: 6, description: 'toc 收录的最大标题层级' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    if (args?.markdown !== undefined && typeof args.markdown !== 'string') throw new Error('markdown 必须是字符串')
    if (args?.text !== undefined && typeof args.text !== 'string') throw new Error('text 必须是字符串')
    if (action === 'table') {
      const input = assertText(String(args?.text ?? ''), 'text')
      if (input.trim() === '') throw new Error('table 需要 text')
      return { ok: true, action, markdown: normalizeTable(input) }
    }
    const markdown = assertText(String(args?.markdown ?? ''))
    if (action === 'headings') {
      const headings = collectHeadings(markdown)
      return { ok: true, action, count: headings.length, headings }
    }
    if (action === 'toc') {
      const minLevel = Math.max(1, Math.min(6, Math.trunc(Number(args?.minLevel ?? 1))))
      const maxLevel = Math.max(minLevel, Math.min(6, Math.trunc(Number(args?.maxLevel ?? 6))))
      const headings = collectHeadings(markdown)
      return { ok: true, action, minLevel, maxLevel, headingCount: headings.length, toc: renderToc(headings, { minLevel, maxLevel }) }
    }
    if (action === 'to_text') {
      return { ok: true, action, text: toPlainText(markdown) }
    }
    if (action === 'stats') {
      return { ok: true, action, ...summarize(markdown) }
    }
    throw new Error(`不支持的 action "${action}"（可用 headings/toc/table/to_text/stats）`)
  },
  timeoutMs: 3000,
}
