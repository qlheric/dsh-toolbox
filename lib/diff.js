/**
 * diff —— 文本 / JSON / CSV 差异（确定性，零依赖）。
 *
 * mode=text  行级 LCS → unified diff（带 context 行）
 * mode=json  深度比较两个 JSON，输出路径级增删改
 * mode=csv   按首行表头对齐的逐行差异（行按整行文本比较）
 *
 * 规模守卫：文本超过 maxLines 时退化为「共同前后缀 + 整段替换」，不做 O(n*m) 动态规划，
 * 避免大文件把进程拖死。
 */

const DEFAULT_MAX_LINES = 4000

export function splitLines(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lcsOps(a, b, maxLines) {
  if (a.length > maxLines || b.length > maxLines) return null
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'equal', text: a[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: 'remove', text: a[i] })
      i += 1
    } else {
      ops.push({ op: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < n) ops.push({ op: 'remove', text: a[i++] })
  while (j < m) ops.push({ op: 'add', text: b[j++] })
  return ops
}

function fallbackOps(a, b) {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const ops = []
  for (let i = 0; i < prefix; i += 1) ops.push({ op: 'equal', text: a[i] })
  for (let i = prefix; i < a.length - suffix; i += 1) ops.push({ op: 'remove', text: a[i] })
  for (let j = prefix; j < b.length - suffix; j += 1) ops.push({ op: 'add', text: b[j] })
  for (let i = a.length - suffix; i < a.length; i += 1) ops.push({ op: 'equal', text: a[i] })
  return ops
}

export function unifiedDiff(left, right, context = 3, maxLines = DEFAULT_MAX_LINES) {
  const a = splitLines(left)
  const b = splitLines(right)
  const ops = lcsOps(a, b, maxLines) ?? fallbackOps(a, b)
  const added = ops.filter((o) => o.op === 'add').length
  const removed = ops.filter((o) => o.op === 'remove').length
  const hunks = []
  let current = null
  let aLine = 1
  let bLine = 1
  const pending = []
  const flush = () => {
    if (current !== null && current.lines.length > 0) hunks.push(current)
    current = null
  }
  for (const op of ops) {
    if (op.op === 'equal') {
      pending.push({ ...op, aLine, bLine })
      aLine += 1
      bLine += 1
      if (current !== null && pending.length > context * 2) {
        current.lines.push(...pending.slice(0, context).map((p) => ({ op: 'equal', text: p.text, aLine: p.aLine, bLine: p.bLine })))
        flush()
        pending.length = 0
      }
      continue
    }
    if (current === null) {
      const keep = pending.slice(-context)
      current = {
        aStart: keep.length > 0 ? keep[0].aLine : aLine,
        bStart: keep.length > 0 ? keep[0].bLine : bLine,
        lines: keep.map((p) => ({ op: 'equal', text: p.text, aLine: p.aLine, bLine: p.bLine })),
      }
    } else if (pending.length > 0) {
      current.lines.push(...pending.map((p) => ({ op: 'equal', text: p.text, aLine: p.aLine, bLine: p.bLine })))
    }
    pending.length = 0
    if (op.op === 'remove') {
      current.lines.push({ op: 'remove', text: op.text, aLine })
      aLine += 1
    } else {
      current.lines.push({ op: 'add', text: op.text, bLine })
      bLine += 1
    }
  }
  // 收尾：把尾部未消费的相等行按 context 补进当前 hunk（否则最后一段上下文会丢）
  if (current !== null && pending.length > 0) {
    current.lines.push(...pending.slice(0, context).map((p) => ({ op: 'equal', text: p.text, aLine: p.aLine, bLine: p.bLine })))
    pending.length = 0
  }
  flush()
  const rendered = hunks
    .map((hunk) => {
      const aCount = hunk.lines.filter((l) => l.op !== 'add').length
      const bCount = hunk.lines.filter((l) => l.op !== 'remove').length
      const header = `@@ -${hunk.aStart},${aCount} +${hunk.bStart},${bCount} @@`
      const body = hunk.lines.map((l) => `${l.op === 'add' ? '+' : l.op === 'remove' ? '-' : ' '}${l.text}`)
      return [header, ...body].join('\n')
    })
    .join('\n')
  return { added, removed, hunks: hunks.length, unified: rendered, truncated: ops.length !== (lcsOps(a, b, maxLines)?.length ?? -1) }
}

export function jsonDiff(left, right, path = '$', out = []) {
  if (left === right) return out
  const leftType = Array.isArray(left) ? 'array' : left === null ? 'null' : typeof left
  const rightType = Array.isArray(right) ? 'array' : right === null ? 'null' : typeof right
  if (leftType !== rightType) {
    out.push({ path, op: 'change', from: left, to: right, kind: `${leftType}→${rightType}` })
    return out
  }
  if (leftType === 'object') {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const childPath = `${path}.${key}`
      if (!Object.hasOwn(left, key)) out.push({ path: childPath, op: 'add', to: right[key] })
      else if (!Object.hasOwn(right, key)) out.push({ path: childPath, op: 'remove', from: left[key] })
      else jsonDiff(left[key], right[key], childPath, out)
    }
    return out
  }
  if (leftType === 'array') {
    const max = Math.max(left.length, right.length)
    for (let i = 0; i < max; i += 1) {
      const childPath = `${path}[${i}]`
      if (i >= left.length) out.push({ path: childPath, op: 'add', to: right[i] })
      else if (i >= right.length) out.push({ path: childPath, op: 'remove', from: left[i] })
      else jsonDiff(left[i], right[i], childPath, out)
    }
    return out
  }
  out.push({ path, op: 'change', from: left, to: right })
  return out
}

function parseJsonish(value, field) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      throw new Error(`${field} 不是合法 JSON：${error.message}`)
    }
  }
  if (value === undefined) throw new Error(`${field} 必填`)
  return value
}

export const spec = {
  name: 'diff',
  description:
    '比较两段内容的差异。mode=text 给标准 unified diff（含 +/- 行与 @@ 头，可用 context 控制上下文行）；' +
    'mode=json 深度比较两个 JSON 并输出到具体路径的 add/remove/change；mode=csv 按行比较 CSV。' +
    '适合改前改后对照、配置漂移检查、审阅时快速定位变化。',
  parameters: {
    left: { type: 'string', required: true, description: '原始内容（mode=json 时是 JSON 文本或值）' },
    right: { type: 'string', required: true, description: '新内容' },
    mode: { type: 'string', enum: ['text', 'json', 'csv'], default: 'text', description: '比较模式，默认 text' },
    context: { type: 'integer', description: 'unified diff 的上下文行数（0-20，默认 3）' },
    maxLines: { type: 'integer', description: 'text 模式下走动态规划的每侧行数上限（默认 4000，超过退化为前后缀+整段替换）' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const mode = String(args?.mode ?? 'text')
    if (mode === 'text') {
      const context = args?.context === undefined ? 3 : Math.max(0, Math.min(20, Math.trunc(Number(args.context))))
      const maxLines = args?.maxLines === undefined ? DEFAULT_MAX_LINES : Math.max(10, Math.trunc(Number(args.maxLines)))
      const result = unifiedDiff(args?.left ?? '', args?.right ?? '', context, maxLines)
      return { ok: true, mode, identical: result.added === 0 && result.removed === 0, ...result }
    }
    if (mode === 'json') {
      const changes = jsonDiff(parseJsonish(args?.left, 'left'), parseJsonish(args?.right, 'right'))
      return {
        ok: true,
        mode,
        identical: changes.length === 0,
        changeCount: changes.length,
        changes: changes.slice(0, 500),
        truncatedChanges: changes.length > 500,
      }
    }
    if (mode === 'csv') {
      const a = splitLines(args?.left ?? '')
      const b = splitLines(args?.right ?? '')
      const header = a[0] === b[0] ? a[0] : undefined
      const bodyA = header === undefined ? a : a.slice(1)
      const bodyB = header === undefined ? b : b.slice(1)
      const result = unifiedDiff(bodyA.join('\n'), bodyB.join('\n'), 1)
      return {
        ok: true,
        mode,
        headerMatches: header !== undefined,
        header: header ?? null,
        rowsLeft: bodyA.length,
        rowsRight: bodyB.length,
        addedRows: result.added,
        removedRows: result.removed,
        unified: result.unified,
      }
    }
    throw new Error(`不支持的 mode "${mode}"（可用 text/json/csv）`)
  },
  timeoutMs: 5000,
}
