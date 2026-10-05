/**
 * regex —— 正则工具（JavaScript 语法），带**静态 ReDoS 体检**。
 *
 * action:
 *   test     是否匹配
 *   find     全部匹配（含下标、编号捕获、命名捕获）
 *   replace  全局安全替换（支持 $1 / $<name> / $$）
 *   explain  静态拆解模式（字面量/字符类/分组/量词/锚点/分支），**从不执行**
 *
 * 守卫（确定性，写在描述里，模型能预判）：
 *   模式 ≤ 16KB、输入 ≤ 64KB、替换串 ≤ 16KB、返回匹配 ≤ limit（默认 50，上限 1000）。
 *   `screenReDoS()` 是**启发式**：命中"可重复体内再嵌套量词/分支"会给出 risk 等级，
 *   high 且输入 > 4KB 时**拒绝执行**（避免拿主进程去赌灾难性回溯）。
 */

const LIMITS = { pattern: 16_384, input: 65_536, replacement: 16_384, matches: 1000, redosInputBytes: 4096 }
const FLAG_WHITELIST = new Set(['g', 'i', 'm', 's', 'u', 'y', 'd', 'v'])

export function assertFlags(flags) {
  const text = flags ?? ''
  const seen = new Set()
  for (const char of text) {
    if (!FLAG_WHITELIST.has(char)) throw new Error(`不支持的 flag "${char}"（可用 g i m s u y d v）`)
    if (seen.has(char)) throw new Error(`flag "${char}" 重复`)
    seen.add(char)
  }
  return text
}

/** 启发式 ReDoS 体检：返回 { level, findings[] }。level ∈ none|low|medium|high。 */
export function screenReDoS(pattern) {
  const findings = []
  let level = 'none'
  const bump = (next, reason) => {
    const order = ['none', 'low', 'medium', 'high']
    if (order.indexOf(next) > order.indexOf(level)) level = next
    findings.push({ level: next, reason })
  }

  // 1) 分组被量词重复，且组内自带量词 ⇒ 嵌套量词（经典 (a+)+ 形态）
  const groupQuant = /\((?:[^()\\]|\\.)*\)\s*([+*]|\{\d+,\d*\}|\{\d+,\})/g
  for (const match of pattern.matchAll(groupQuant)) {
    const body = match[0].slice(1, match[0].lastIndexOf(')'))
    if (/[+*]|\{\d+,/.test(body)) bump('high', `分组 "${match[0].trim()}" 内含量词又被外层量词重复（嵌套量词）`)
    else if (body.includes('|')) bump('medium', `分组 "${match[0].trim()}" 内含分支又被外层量词重复（分支重叠风险）`)
  }

  // 2) 相邻的重叠量词（.*.* / .+.+ 形态）⇒ 平方级
  if (/(\.\*|\.\+)\s*(\.\*|\.\+)/.test(pattern)) bump('low', '相邻通配量词（.++.* 形态）会退化为平方级扫描')

  // 3) 分支两侧以同一字符开头（a|ab）⇒ 回溯分支
  const alternation = /\(([^()|]+)\|([^()|]+)\)/.exec(pattern)
  if (alternation !== null) {
    const left = alternation[1]
    const right = alternation[2]
    if (left !== '' && right !== '' && left[0] === right[0]) {
      bump('low', `分支 "${left}" 与 "${right}" 首字符相同，可能产生分支回溯`)
    }
  }

  return { level, findings, note: '启发式体检，不等于证明；high 且输入 > 4KB 时本工具拒绝执行' }
}

export function explainPattern(pattern) {
  const nodes = []
  let index = 0
  const push = (kind, text, note) => nodes.push({ kind, text, note })
  while (index < pattern.length) {
    const char = pattern[index]
    if (char === '\\') {
      const next = pattern[index + 1] ?? ''
      push('escape', `\\${next}`, escapeNote(next))
      index += 2
      continue
    }
    if (char === '[') {
      const close = pattern.indexOf(']', index + 1)
      const body = close === -1 ? pattern.slice(index + 1) : pattern.slice(index + 1, close)
      push('class', `[${body}]`, body.startsWith('^') ? '取反字符类' : '字符类')
      index = close === -1 ? pattern.length : close + 1
      continue
    }
    if (char === '(') {
      const header = /^\(\?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(pattern.slice(index))
      const lookaround = /^\(\?([=!]|<=|<!)/.exec(pattern.slice(index))
      if (header !== null) push('group', `(?<${header[1]}>…`, '命名捕获组')
      else if (lookaround !== null) push('group', `(?${lookaround[1]}…`, lookaround[1].endsWith('=') ? '前瞻' : '后顾/负向断言')
      else if (pattern.startsWith('(?:', index)) push('group', '(?:…', '非捕获组')
      else push('group', '(…', '捕获组')
      index += 1
      continue
    }
    if ('*+?'.includes(char)) {
      const lazy = pattern[index + 1] === '?'
      push('quantifier', `${char}${lazy ? '?' : ''}`, lazy ? '懒惰量词' : '贪婪量词')
      index += lazy ? 2 : 1
      continue
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index)
      const body = close === -1 ? '' : pattern.slice(index + 1, close)
      push('quantifier', `{${body}}`, /^\d+,$/.test(body) ? '至少 n 次' : /^\d+,\d+$/.test(body) ? 'n~m 次' : '重复次数')
      index = close === -1 ? index + 1 : close + 1
      continue
    }
    if ('^$'.includes(char)) {
      push('anchor', char, char === '^' ? '行/串首' : '行/串尾')
      index += 1
      continue
    }
    if (char === '|') {
      push('alternation', '|', '分支')
      index += 1
      continue
    }
    if (char === '.') {
      push('wildcard', '.', '任意字符（默认不含换行）')
      index += 1
      continue
    }
    push('literal', char, '字面量')
    index += 1
  }
  return nodes
}

function escapeNote(char) {
  const table = { d: '数字 0-9', D: '非数字', w: '单词字符', W: '非单词字符', s: '空白', S: '非空白', b: '单词边界', B: '非单词边界', n: '换行', t: '制表符' }
  return table[char] ?? '转义字符'
}

function compile(pattern, flags) {
  if (typeof pattern !== 'string' || pattern === '') throw new Error('pattern 必须是非空字符串')
  if (pattern.length > LIMITS.pattern) throw new Error(`pattern 过长（>${LIMITS.pattern}）`)
  const safeFlags = assertFlags(flags)
  const risk = screenReDoS(pattern)
  return { regex: new RegExp(pattern, safeFlags.includes('g') ? safeFlags : safeFlags + 'g'), safeFlags, risk }
}

export const spec = {
  name: 'regex',
  description:
    '正则工具（JavaScript 语法，pattern 不带两侧斜杠）：test 是否匹配；find 全部匹配（编号/命名捕获 + 下标）；' +
    'replace 全局替换（$1 / $<name> / $$）；explain 静态拆解模式（字面量/字符类/分组/量词/锚点/分支，从不执行）。' +
    '内置**静态 ReDoS 体检**：嵌套量词/分支重叠会给出 low~high 风险，high 且输入 > 4KB 时拒绝执行。' +
    '上限：pattern 16KB、输入 64KB、替换串 16KB、返回匹配 ≤1000。',
  parameters: {
    action: { type: 'string', enum: ['test', 'find', 'replace', 'explain'], required: true, description: '要做的操作' },
    pattern: { type: 'string', required: true, description: '正则模式（JavaScript 语法，不带 / 与 flags）' },
    input: { type: 'string', description: 'test/find/replace 的输入文本' },
    flags: { type: 'string', description: '标志位，如 "gi"（可用 g i m s u y d v，必须唯一）' },
    replacement: { type: 'string', description: 'replace 的替换文本，支持 $1 / $<name> / $$' },
    limit: { type: 'integer', description: 'find 返回的匹配上限，默认 50，最大 1000' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    const pattern = String(args?.pattern ?? '')
    const risk = screenReDoS(pattern)
    if (action === 'explain') {
      if (pattern === '') throw new Error('explain 需要 pattern')
      return { ok: true, action, pattern, nodes: explainPattern(pattern), redos: risk }
    }
    const input = args?.input
    if (typeof input !== 'string') throw new Error(`${action} 需要 input 字符串`)
    if (Buffer.byteLength(input) > LIMITS.input) throw new Error(`input 过大（>${LIMITS.input} 字节）`)
    if (risk.level === 'high' && Buffer.byteLength(input) > LIMITS.redosInputBytes) {
      return {
        ok: false,
        action,
        refused: true,
        reason: `静态体检判定 high ReDoS 风险，且输入 ${Buffer.byteLength(input)} 字节 > ${LIMITS.redosInputBytes}，拒绝执行`,
        redos: risk,
        suggestion: '改写模式（去掉嵌套量词/收敛分支），或先缩小输入',
      }
    }
    if (action === 'replace') {
      const replacement = String(args?.replacement ?? '')
      if (Buffer.byteLength(replacement) > LIMITS.replacement) throw new Error(`replacement 过大（>${LIMITS.replacement} 字节）`)
      const { regex, safeFlags } = compile(pattern, args?.flags)
      const result = input.replace(regex, replacement)
      return { ok: true, action, flags: safeFlags, replaced: input !== result, beforeBytes: Buffer.byteLength(input), afterBytes: Buffer.byteLength(result), value: result, redos: risk }
    }
    const { regex, safeFlags } = compile(pattern, args?.flags)
    if (action === 'test') {
      return { ok: true, action, flags: safeFlags, matched: regex.test(input), redos: risk }
    }
    if (action === 'find') {
      const limit = args?.limit === undefined ? 50 : Math.max(1, Math.min(LIMITS.matches, Math.trunc(Number(args.limit))))
      const matches = []
      let match
      let guard = 0
      while ((match = regex.exec(input)) !== null) {
        matches.push({
          index: match.index,
          text: match[0],
          groups: match.slice(1),
          named: match.groups ?? null,
        })
        if (match[0] === '') regex.lastIndex += 1
        if (++guard >= limit) break
      }
      return { ok: true, action, flags: safeFlags, matchCount: matches.length, truncated: guard >= limit, matches, redos: risk }
    }
    throw new Error(`不支持的 action "${action}"（可用 test/find/replace/explain）`)
  },
  timeoutMs: 3000,
}
