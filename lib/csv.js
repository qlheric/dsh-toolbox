/**
 * csv —— CSV 解析与查询（RFC 4180 状态机，零依赖）。
 *
 * action:
 *   parse      解析为行数组（header=true 时返回对象数组）
 *   query      按列精确值过滤
 *   stats      行列数、列名、每列样例
 *   summarize  对数值列做描述统计（count/sum/mean/median/min/max/stddev）
 *   to_markdown 转 GFM 表格
 *
 * 口径：RFC 4180；引号内可含逗号/换行/双引号（"""" 转义）；忽略开头 BOM；行尾 \r\n 与 \n 等价。
 */

const DEFAULT_LIMIT = 100
const MAX_BYTES = 2_000_000

export function parseCsv(text, delimiter = ',', header = true) {
  if (typeof text !== 'string') throw new Error('csv 必须是字符串')
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`csv 过大（>${MAX_BYTES} 字节）`)
  if (delimiter === 'tab') delimiter = '\t'
  if (typeof delimiter !== 'string' || delimiter.length !== 1) throw new Error('delimiter 必须是单个字符或 "tab"')
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let index = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (index < source.length) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      index += 1
      continue
    }
    if (char === delimiter) {
      pushField()
      index += 1
      continue
    }
    if (char === '\r') {
      if (source[index + 1] === '\n') index += 1
      pushRow()
      index += 1
      continue
    }
    if (char === '\n') {
      pushRow()
      index += 1
      continue
    }
    field += char
    index += 1
  }
  if (field !== '' || row.length > 0) pushRow()
  if (rows.length === 0) return { header: [], rows: [], objects: [] }
  if (!header) return { header: [], rows, objects: [] }
  const headerRow = rows[0].map((h) => h.trim())
  const objects = rows.slice(1).map((cells) => {
    const record = {}
    headerRow.forEach((key, i) => {
      record[key] = cells[i] ?? ''
    })
    return record
  })
  return { header: headerRow, rows: rows.slice(1), objects }
}

export function columnIndexOf(header, column) {
  if (column === undefined || column === null || column === '') throw new Error('query 需要 column')
  const text = String(column)
  if (/^\d+$/.test(text)) {
    const idx = Number(text) - 1
    if (idx < 0 || (header.length > 0 && idx >= header.length)) throw new Error(`列下标 ${text} 越界`)
    return idx
  }
  const idx = header.indexOf(text)
  if (idx === -1) throw new Error(`没有列 "${text}"（现有列：${header.join(', ') || '无表头'}）`)
  return idx
}

export function describeNumbers(values) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { count: 0 }
  const sorted = [...finite].sort((a, b) => a - b)
  const sum = finite.reduce((acc, v) => acc + v, 0)
  const mean = sum / finite.length
  const variance = finite.length > 1 ? finite.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (finite.length - 1) : 0
  const mid = Math.floor(sorted.length / 2)
  return {
    count: finite.length,
    sum,
    mean,
    median: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    standardDeviation: Math.sqrt(variance),
  }
}

function toMarkdown(header, rows) {
  const escape = (cell) => String(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines = [`| ${header.map(escape).join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const row of rows) lines.push(`| ${header.map((_, i) => escape(row[i] ?? '')).join(' | ')} |`)
  return lines.join('\n')
}

export const spec = {
  name: 'csv',
  description:
    'CSV 处理（RFC 4180）：parse 解析成行/对象数组；query 按列精确值过滤（列可给列名或 1 基下标）；' +
    'stats 给行列数；summarize 对数值列做描述统计；to_markdown 转 GFM 表格。' +
    '支持引号内的逗号/换行/"" 转义、忽略 BOM、自定义分隔符（含 tab）。纯文本处理，不读写文件。',
  parameters: {
    action: {
      type: 'string',
      enum: ['parse', 'query', 'stats', 'summarize', 'to_markdown'],
      required: true,
      description: '要做的操作',
    },
    csv: { type: 'string', required: true, description: 'CSV 文本' },
    delimiter: { type: 'string', default: ',', description: '分隔符，单字符，或 "tab"' },
    header: { type: 'boolean', default: true, description: '首行是否为表头（默认 true）' },
    column: { type: 'string', description: 'query/summarize 的列名或 1 基下标' },
    value: { type: 'string', description: 'query 的精确匹配值' },
    limit: { type: 'integer', description: `返回行数上限，默认 ${DEFAULT_LIMIT}` },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    const delimiter = String(args?.delimiter ?? ',')
    const header = args?.header === undefined ? true : Boolean(args.header)
    const limit = args?.limit === undefined ? DEFAULT_LIMIT : Math.max(1, Math.trunc(Number(args.limit)))
    const parsed = parseCsv(args?.csv ?? '', delimiter, header)
    if (action === 'parse') {
      const items = header ? parsed.objects : parsed.rows
      return {
        ok: true,
        action,
        header: parsed.header,
        rowCount: items.length,
        returned: Math.min(limit, items.length),
        truncated: items.length > limit,
        rows: items.slice(0, limit),
      }
    }
    if (action === 'stats') {
      return { ok: true, action, columns: parsed.header, columnCount: parsed.header.length, rowCount: parsed.rows.length }
    }
    if (action === 'query') {
      const idx = columnIndexOf(parsed.header, args?.column)
      if (!Object.hasOwn(args ?? {}, 'value')) throw new Error('query 需要 value')
      const want = String(args.value)
      const hits = parsed.rows.filter((cells) => (cells[idx] ?? '') === want)
      const items = header ? hits.map((cells) => Object.fromEntries(parsed.header.map((k, i) => [k, cells[i] ?? '']))) : hits
      return { ok: true, action, column: args.column, value: want, matchCount: hits.length, returned: Math.min(limit, items.length), rows: items.slice(0, limit) }
    }
    if (action === 'summarize') {
      const targets = args?.column === undefined ? parsed.header : [String(args.column)]
      const columns = {}
      for (const name of targets) {
        const idx = columnIndexOf(parsed.header, name)
        const raw = parsed.rows.map((cells) => (cells[idx] ?? '').trim())
        const numbers = raw.map((v) => (v === '' ? Number.NaN : Number(v)))
        const numeric = numbers.filter((v) => Number.isFinite(v)).length
        columns[name] = numeric > 0 ? describeNumbers(numbers) : { count: 0, note: '该列没有可解析的数值' }
        columns[name].nonEmpty = raw.filter((v) => v !== '').length
      }
      return { ok: true, action, rowCount: parsed.rows.length, columns }
    }
    if (action === 'to_markdown') {
      if (!header) throw new Error('to_markdown 需要 header=true')
      return { ok: true, action, markdown: toMarkdown(parsed.header, parsed.rows.slice(0, limit)) }
    }
    throw new Error(`不支持的 action "${action}"（可用 parse/query/stats/summarize/to_markdown）`)
  },
  timeoutMs: 3000,
}
