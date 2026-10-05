/**
 * json —— JSON 查询与整理（确定性、零依赖）。
 *
 * action:
 *   get     按路径取值（支持点号、['键']、[下标]、[*] 通配）
 *   keys    列出该路径下的键（对象键或数组长度）
 *   type    该路径值的类型
 *   validate 校验字符串是不是合法 JSON（给出行列）
 *   format  重新序列化（pretty / minify）
 */

const MAX_INPUT_BYTES = 2_000_000

function parseInput(input) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch (error) {
      throw new Error(`input 不是合法 JSON：${error.message}`)
    }
  }
  if (input === undefined) throw new Error('input 必填')
  return input
}

export function parsePath(path) {
  const raw = (path ?? '$').trim()
  if (raw === '' || raw === '$') return []
  const text = raw.startsWith('$') ? raw.slice(1) : raw
  const segments = []
  let index = 0
  // 允许省略开头的 $ 与点号：`data.x` 等价 `$.data.x`
  if (text.length > 0 && text[0] !== '.' && text[0] !== '[') {
    let start = 0
    while (index < text.length && !'.['.includes(text[index])) index += 1
    const key = text.slice(start, index)
    if (key === '') throw new Error(`路径 "${raw}" 开头缺少键名`)
    segments.push({ kind: 'key', key })
  }
  while (index < text.length) {
    const char = text[index]
    if (char === '.') {
      index += 1
      let start = index
      while (index < text.length && !'.['.includes(text[index])) index += 1
      const key = text.slice(start, index)
      if (key === '') throw new Error(`路径 "${raw}" 中点号后缺少键名`)
      segments.push({ kind: 'key', key })
      continue
    }
    if (char === '[') {
      const close = text.indexOf(']', index)
      if (close === -1) throw new Error(`路径 "${raw}" 中括号未闭合`)
      const inner = text.slice(index + 1, close).trim()
      if (inner === '*') segments.push({ kind: 'wildcard' })
      else if (/^-?\d+$/.test(inner)) segments.push({ kind: 'index', index: Number(inner) })
      else if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        segments.push({ kind: 'key', key: inner.slice(1, -1) })
      } else throw new Error(`路径 "${raw}" 中的下标 "${inner}" 不合法（用数字、'键' 或 *）`)
      index = close + 1
      continue
    }
    throw new Error(`路径 "${raw}" 中位置 ${index} 的字符 "${char}" 不合法`)
  }
  return segments
}

export function query(value, path) {
  const segments = parsePath(path)
  let current = value
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (segment.kind === 'wildcard') {
      if (!Array.isArray(current)) return { found: false, reason: `[*] 只能用在数组上，当前是 ${typeName(current)}` }
      const rest = segments.slice(i + 1)
      const collected = []
      let anyMissing = false
      for (const item of current) {
        const sub = queryFrom(item, rest)
        if (sub.found) collected.push(sub.value)
        else anyMissing = true
      }
      return { found: true, value: collected, wildcard: true, missingInSomeItems: anyMissing }
    }
    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return { found: false, reason: `[${segment.index}] 只能用在数组上，当前是 ${typeName(current)}` }
      const idx = segment.index < 0 ? current.length + segment.index : segment.index
      if (idx < 0 || idx >= current.length) return { found: false, reason: `下标 ${segment.index} 越界（数组长度 ${current.length}）` }
      current = current[idx]
      continue
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { found: false, reason: `在 ${typeName(current)} 上取键 "${segment.key}" 不成立` }
    }
    if (!Object.hasOwn(current, segment.key)) return { found: false, reason: `不存在键 "${segment.key}"` }
    current = current[segment.key]
  }
  return { found: true, value: current }
}

function queryFrom(value, segments) {
  if (segments.length === 0) return { found: true, value }
  const [head, ...rest] = segments
  if (head.kind === 'key') {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, head.key)) {
      return { found: false }
    }
    return queryFrom(value[head.key], rest)
  }
  if (head.kind === 'index') {
    if (!Array.isArray(value)) return { found: false }
    const idx = head.index < 0 ? value.length + head.index : head.index
    if (idx < 0 || idx >= value.length) return { found: false }
    return queryFrom(value[idx], rest)
  }
  if (!Array.isArray(value)) return { found: false }
  return { found: true, value: value.map((item) => queryFrom(item, rest)).filter((r) => r.found).map((r) => r.value) }
}

export function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function validate(text) {
  if (typeof text !== 'string') throw new Error('validate 需要字符串 input')
  try {
    JSON.parse(text)
    return { valid: true }
  } catch (error) {
    const message = String(error.message)
    const position = /position (\d+)/.exec(message)
    let line = null
    let column = null
    if (position) {
      const offset = Number(position[1])
      const before = text.slice(0, offset)
      line = before.split('\n').length
      column = offset - before.lastIndexOf('\n')
    }
    return { valid: false, message, line, column }
  }
}

export const spec = {
  name: 'json',
  description:
    'JSON 取值与整理：按路径查询（$、点号 .a.b、[\'键\']、[下标]（支持负数）、[*] 通配）、列键、判类型、' +
    '校验字符串是否为合法 JSON（含行列定位）、重新格式化（pretty/minify）。' +
    '适合在长 JSON 里精准取一小段，避免把整份内容读进上下文。',
  parameters: {
    input: { type: 'json', required: true, description: '要处理的 JSON 值；也可以是 JSON 字符串' },
    action: {
      type: 'string',
      enum: ['get', 'keys', 'type', 'validate', 'format'],
      default: 'get',
      description: 'get=按路径取值；keys=列出键；type=判类型；validate=校验字符串；format=重新序列化',
    },
    path: { type: 'string', default: '$', description: '路径表达式，默认 $（根）。例：$.data.items[0].name' },
    indent: { type: 'integer', description: 'format 时的缩进空格数（0 = 压缩成一行），默认 2' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? 'get')
    if (action === 'validate') return validate(args?.input)
    const value = parseInput(args?.input)
    const size = Buffer.byteLength(JSON.stringify(value) ?? '')
    if (size > MAX_INPUT_BYTES) throw new Error(`input 过大（${size} 字节 > ${MAX_INPUT_BYTES}）`)
    if (action === 'get') {
      const result = query(value, args?.path)
      return result.found
        ? { ok: true, path: args?.path ?? '$', value: result.value, ...(result.wildcard ? { wildcard: true } : {}) }
        : { ok: false, path: args?.path ?? '$', error: result.reason }
    }
    if (action === 'type') {
      const result = query(value, args?.path)
      return result.found
        ? { ok: true, path: args?.path ?? '$', type: typeName(result.value) }
        : { ok: false, path: args?.path ?? '$', error: result.reason }
    }
    if (action === 'keys') {
      const result = query(value, args?.path)
      if (!result.found) return { ok: false, path: args?.path ?? '$', error: result.reason }
      const target = result.value
      if (Array.isArray(target)) return { ok: true, kind: 'array', length: target.length }
      if (target !== null && typeof target === 'object') {
        return { ok: true, kind: 'object', keys: Object.keys(target), count: Object.keys(target).length }
      }
      return { ok: true, kind: typeName(target), value: target }
    }
    if (action === 'format') {
      const indent = args?.indent === undefined ? 2 : Math.max(0, Math.trunc(Number(args.indent)))
      return { ok: true, text: indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, indent) }
    }
    throw new Error(`不支持的 action "${action}"（可用 get/keys/type/validate/format）`)
  },
  timeoutMs: 2000,
}
