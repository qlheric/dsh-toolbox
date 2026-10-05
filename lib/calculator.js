/**
 * calculator —— 安全算式求值（递归下降，不用 eval / new Function）。
 *
 * 支持：+ - * / % ^、括号、一元正负、常量 pi/e/tau、
 * 函数 abs ceil floor round sqrt cbrt sign trunc min max pow log log10 ln exp sin cos tan。
 * 拒绝一切非算式字符（标识符必须命中函数名或常量名），故不存在代码执行面。
 */

const CONSTS = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
})

const FUNCS = Object.freeze({
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sign: Math.sign,
  trunc: Math.trunc,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
})

const MAX_EXPRESSION_LENGTH = 4000
const MAX_DEPTH = 64

export function tokenize(source) {
  const tokens = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }
    if (char >= '0' && char <= '9') {
      let start = index
      while (index < source.length && /[0-9]/.test(source[index])) index += 1
      if (source[index] === '.') {
        index += 1
        while (index < source.length && /[0-9]/.test(source[index])) index += 1
      }
      if (source[index] === 'e' || source[index] === 'E') {
        const save = index
        index += 1
        if (source[index] === '+' || source[index] === '-') index += 1
        if (/[0-9]/.test(source[index] ?? '')) {
          while (index < source.length && /[0-9]/.test(source[index])) index += 1
        } else {
          index = save
        }
      }
      tokens.push({ kind: 'number', value: Number(source.slice(start, index)) })
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let start = index
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1
      tokens.push({ kind: 'name', value: source.slice(start, index) })
      continue
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ kind: 'op', value: char })
      index += 1
      continue
    }
    throw new Error(`不支持的字符 "${char}"（位置 ${index}）`)
  }
  return tokens
}

export function evaluate(source) {
  if (typeof source !== 'string' || source.trim() === '') throw new Error('expression 必须是非空字符串')
  if (source.length > MAX_EXPRESSION_LENGTH) throw new Error(`expression 过长（>${MAX_EXPRESSION_LENGTH} 字符）`)
  const tokens = tokenize(source)
  let pos = 0
  let depth = 0

  const peek = () => tokens[pos]
  const eat = (value) => {
    const token = peek()
    if (token === undefined || token.kind !== 'op' || token.value !== value) throw new Error(`期望 "${value}"`)
    pos += 1
  }

  function parseExpression() {
    let left = parseTerm()
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.value === '+' || token.value === '-')) {
        pos += 1
        const right = parseTerm()
        left = token.value === '+' ? left + right : left - right
        continue
      }
      return left
    }
  }

  function parseTerm() {
    let left = parseUnary()
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.value === '*' || token.value === '/' || token.value === '%')) {
        pos += 1
        const right = parseUnary()
        if (token.value === '*') left = left * right
        else if (token.value === '/') left = left / right
        else left = left % right
        continue
      }
      return left
    }
  }

  function parseUnary() {
    const token = peek()
    if (token?.kind === 'op' && (token.value === '-' || token.value === '+')) {
      pos += 1
      const value = parseUnary()
      return token.value === '-' ? -value : value
    }
    return parsePower()
  }

  function parsePower() {
    const base = parseAtom()
    const token = peek()
    if (token?.kind === 'op' && token.value === '^') {
      pos += 1
      const exponent = parseUnary() // 右结合
      return base ** exponent
    }
    return base
  }

  function parseAtom() {
    depth += 1
    if (depth > MAX_DEPTH) throw new Error('表达式嵌套过深')
    try {
      const token = peek()
      if (token === undefined) throw new Error('表达式意外结束')
      if (token.kind === 'number') {
        pos += 1
        return token.value
      }
      if (token.kind === 'name') {
        pos += 1
        const lower = token.value.toLowerCase()
        if (Object.hasOwn(CONSTS, lower)) return CONSTS[lower]
        if (!Object.hasOwn(FUNCS, lower)) throw new Error(`未知函数或常量 "${token.value}"`)
        eat('(')
        const args = []
        if (peek()?.value !== ')') {
          for (;;) {
            args.push(parseExpression())
            if (peek()?.value === ',') {
              pos += 1
              continue
            }
            break
          }
        }
        eat(')')
        return FUNCS[lower](...args)
      }
      if (token.value === '(') {
        pos += 1
        const value = parseExpression()
        eat(')')
        return value
      }
      throw new Error(`意外的记号 "${token.value}"`)
    } finally {
      depth -= 1
    }
  }

  const value = parseExpression()
  if (pos !== tokens.length) throw new Error(`表达式尾部有多余记号 "${tokens[pos].value}"`)
  if (!Number.isFinite(value)) throw new Error(`结果不是有限数（${value}）`)
  return value
}

export const spec = {
  name: 'calculator',
  description:
    '安全求值一个数学算式，返回精确数值。支持 + - * / % ^、括号、一元正负，常量 pi/e/tau，' +
    '函数 abs ceil floor round sqrt cbrt sign trunc exp ln log10 log log(x,base) sin cos tan min max pow。' +
    '不使用 eval，标识符必须命中已支持的函数/常量，因此不会执行任意代码。适合代替心算与检查数值口径。',
  parameters: {
    expression: { type: 'string', required: true, description: '算式，例如 "(1+2)*3^2 / sqrt(16)"' },
    precision: { type: 'integer', description: '结果保留的小数位（0-15，省略则返回原始精度）' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  execute: (args) => {
    const expression = String(args?.expression ?? '')
    const value = evaluate(expression)
    const precision = args?.precision
    if (precision === undefined || precision === null) return { ok: true, expression, value }
    const digits = Math.max(0, Math.min(15, Math.trunc(Number(precision))))
    return { ok: true, expression, value, rounded: Number(value.toFixed(digits)), precision: digits }
  },
  timeoutMs: 1000,
}
