/**
 * schema —— JSON Schema 子集校验（确定性、零网络、零动态执行）。
 *
 * action:
 *   validate   给 verdict + 错误（含 RFC 6901 的 instancePath / schemaPath）
 *   paths      只给失败路径 + 关键字摘要
 *   explain    静态列出约束树
 *   normalize  深拷贝 + 对缺失属性套用显式 default，再校验（绝不改原对象、绝不强转类型）
 *
 * 支持的关键字（子集，draft 2020-12 风格）：
 *   type / enum / const
 *   object: required / properties / additionalProperties / minProperties / maxProperties
 *   array:  items / minItems / maxItems / uniqueItems
 *   string: minLength / maxLength / pattern
 *   number: minimum / maximum / exclusiveMinimum / exclusiveMaximum / multipleOf
 *   allOf / anyOf / oneOf / not
 *   本地 $ref（# 与 #/$defs/...）
 *
 * 铁律：**不支持的关键字绝不被静默忽略** —— 一律进 schemaIssues（code=unsupported-keyword）；
 *   strictSchema=true（默认）时校验判失败，=false 时只校验支持子集并返回 valid=null / complete=false。
 */

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  'type', 'enum', 'const',
  'required', 'properties', 'additionalProperties', 'minProperties', 'maxProperties', 'propertyNames',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'contains',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'allOf', 'anyOf', 'oneOf', 'not',
])

const LIMITS = {
  bytes: 262_144,
  depth: 64,
  schemaNodes: 10_000,
  traversalNodes: 100_000,
  errors: 1_000,
  refChain: 64,
}

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
}

function escapePointer(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1')
}

function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value
}

export function inspectSchema(schema, path = '#', state = { nodes: 0, depth: 0, issues: [] }) {
  state.nodes += 1
  state.depth += 1
  if (state.nodes > LIMITS.schemaNodes) throw new Error(`schema 节点数超上限 ${LIMITS.schemaNodes}`)
  if (state.depth > LIMITS.depth) throw new Error(`schema 嵌套超上限 ${LIMITS.depth}`)
  if (typeof schema === 'boolean') {
    state.depth -= 1
    return
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${path} 不是 schema 对象`)
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) state.issues.push({ code: 'unsupported-keyword', keyword: key, schemaPath: path })
  }
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((s, i) => inspectSchema(s, `${path}/allOf/${i}`, state))
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((s, i) => inspectSchema(s, `${path}/anyOf/${i}`, state))
  if (Array.isArray(schema.oneOf)) schema.oneOf.forEach((s, i) => inspectSchema(s, `${path}/oneOf/${i}`, state))
  if (schema.not !== undefined) inspectSchema(schema.not, `${path}/not`, state)
  if (schema.properties !== undefined) {
    for (const [key, value] of Object.entries(schema.properties)) inspectSchema(value, `${path}/properties/${escapePointer(key)}`, state)
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') {
    inspectSchema(schema.additionalProperties, `${path}/additionalProperties`, state)
  }
  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) schema.items.forEach((s, i) => inspectSchema(s, `${path}/items/${i}`, state))
    else inspectSchema(schema.items, `${path}/items`, state)
  }
  state.depth -= 1
}

function resolveRef(ref, root, chain) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) throw new Error(`只支持本地 $ref（以 # 开头），收到 "${ref}"`)
  if (chain.length > LIMITS.refChain) throw new Error(`$ref 链过深（>${LIMITS.refChain}）`)
  const pointer = ref === '#' ? '' : ref.slice(2)
  let current = root
  if (pointer !== '') {
    for (const rawToken of pointer.split('/')) {
      const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~')
      if (current === null || typeof current !== 'object' || !Object.hasOwn(current, token)) throw new Error(`$ref "${ref}" 解析失败`)
      current = current[token]
    }
  }
  return current
}

export function validate(data, schema, options = {}) {
  const strictSchema = options.strictSchema === undefined ? true : Boolean(options.strictSchema)
  const maxErrors = Math.max(1, Math.min(LIMITS.errors, Math.trunc(Number(options.maxErrors ?? 100))))
  const body = JSON.stringify(schema ?? null)
  if (Buffer.byteLength(body) > LIMITS.bytes) throw new Error(`schema 过大（>${LIMITS.bytes} 字节）`)
  const dataBody = JSON.stringify(data ?? null)
  if (Buffer.byteLength(dataBody) > LIMITS.bytes) throw new Error(`data 过大（>${LIMITS.bytes} 字节）`)
  const state = { nodes: 0, depth: 0, issues: [] }
  inspectSchema(schema, '#', state)
  const errors = []
  const traversal = { count: 0 }

  const fail = (instancePath, schemaPath, keyword, message, extra = {}) => {
    if (errors.length < maxErrors) errors.push({ instancePath, schemaPath, keyword, message, ...extra })
  }

  const walk = (value, node, instancePath, schemaPath, chain) => {
    if (typeof node === 'boolean') {
      if (!node) fail(instancePath, schemaPath, 'false-schema', '该位置不允许任何值')
      return
    }
    traversal.count += 1
    if (traversal.count > LIMITS.traversalNodes) throw new Error(`校验遍历节点数超上限 ${LIMITS.traversalNodes}`)
    if (node.$ref !== undefined) {
      walk(value, resolveRef(node.$ref, schema, [...chain, node.$ref]), instancePath, `${schemaPath}/$ref`, chain)
      return
    }
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      const actual = typeName(value)
      const ok = types.some((t) => {
        if (t === 'number') return actual === 'number' || actual === 'integer'
        return TYPE_CHECKS[t] !== undefined && (actual === t || TYPE_CHECKS[t](value))
      })
      if (!ok) {
        fail(instancePath, `${schemaPath}/type`, 'type', `期望 ${types.join('|')}，实际 ${actual}`, { expected: types, actual })
        return
      }
    }
    if (node.enum !== undefined) {
      if (!node.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
        fail(instancePath, `${schemaPath}/enum`, 'enum', `不在允许取值内`, { allowed: node.enum })
      }
    }
    if (node.const !== undefined && JSON.stringify(node.const) !== JSON.stringify(value)) {
      fail(instancePath, `${schemaPath}/const`, 'const', `必须等于常量`, { expected: node.const })
    }
    if (typeof value === 'string') {
      if (node.minLength !== undefined && value.length < node.minLength) fail(instancePath, `${schemaPath}/minLength`, 'minLength', `长度 < ${node.minLength}`, { actual: value.length })
      if (node.maxLength !== undefined && value.length > node.maxLength) fail(instancePath, `${schemaPath}/maxLength`, 'maxLength', `长度 > ${node.maxLength}`, { actual: value.length })
      if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) fail(instancePath, `${schemaPath}/pattern`, 'pattern', `不匹配 ${node.pattern}`)
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (node.minimum !== undefined && value < node.minimum) fail(instancePath, `${schemaPath}/minimum`, 'minimum', `< ${node.minimum}`)
      if (node.maximum !== undefined && value > node.maximum) fail(instancePath, `${schemaPath}/maximum`, 'maximum', `> ${node.maximum}`)
      if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) fail(instancePath, `${schemaPath}/exclusiveMinimum`, 'exclusiveMinimum', `<= ${node.exclusiveMinimum}`)
      if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) fail(instancePath, `${schemaPath}/exclusiveMaximum`, 'exclusiveMaximum', `>= ${node.exclusiveMaximum}`)
      if (node.multipleOf !== undefined && node.multipleOf > 0) {
        const ratio = value / node.multipleOf
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9) fail(instancePath, `${schemaPath}/multipleOf`, 'multipleOf', `不是 ${node.multipleOf} 的整数倍`)
      }
    }
    if (Array.isArray(value)) {
      if (node.minItems !== undefined && value.length < node.minItems) fail(instancePath, `${schemaPath}/minItems`, 'minItems', `元素数 < ${node.minItems}`)
      if (node.maxItems !== undefined && value.length > node.maxItems) fail(instancePath, `${schemaPath}/maxItems`, 'maxItems', `元素数 > ${node.maxItems}`)
      if (node.uniqueItems === true) {
        const seen = new Set()
        value.forEach((item, i) => {
          const key = JSON.stringify(item)
          if (seen.has(key)) fail(`${instancePath}/${i}`, `${schemaPath}/uniqueItems`, 'uniqueItems', '元素重复')
          seen.add(key)
        })
      }
      if (node.items !== undefined && !Array.isArray(node.items)) {
        value.forEach((item, i) => walk(item, node.items, `${instancePath}/${i}`, `${schemaPath}/items`, chain))
      }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value)
      if (node.minProperties !== undefined && keys.length < node.minProperties) fail(instancePath, `${schemaPath}/minProperties`, 'minProperties', `属性数 < ${node.minProperties}`)
      if (node.maxProperties !== undefined && keys.length > node.maxProperties) fail(instancePath, `${schemaPath}/maxProperties`, 'maxProperties', `属性数 > ${node.maxProperties}`)
      if (Array.isArray(node.required)) {
        for (const key of node.required) {
          if (!Object.hasOwn(value, key)) fail(instancePath, `${schemaPath}/required`, 'required', `缺少必填属性 "${key}"`, { missing: key })
        }
      }
      const properties = node.properties ?? {}
      for (const [key, child] of Object.entries(properties)) {
        if (Object.hasOwn(value, key)) walk(value[key], child, `${instancePath}/${escapePointer(key)}`, `${schemaPath}/properties/${escapePointer(key)}`, chain)
      }
      if (node.additionalProperties !== undefined) {
        const extra = keys.filter((key) => !Object.hasOwn(properties, key))
        if (node.additionalProperties === false) {
          for (const key of extra) fail(instancePath, `${schemaPath}/additionalProperties`, 'additionalProperties', `不允许额外属性 "${key}"`, { unexpected: key })
        } else if (typeof node.additionalProperties === 'object') {
          for (const key of extra) walk(value[key], node.additionalProperties, `${instancePath}/${escapePointer(key)}`, `${schemaPath}/additionalProperties`, chain)
        }
      }
    }
    if (Array.isArray(node.allOf)) node.allOf.forEach((sub, i) => walk(value, sub, instancePath, `${schemaPath}/allOf/${i}`, chain))
    if (Array.isArray(node.anyOf)) {
      const before = errors.length
      const branchErrors = []
      const matched = node.anyOf.some((sub, i) => {
        const local = []
        const savedLength = errors.length
        walk(value, sub, instancePath, `${schemaPath}/anyOf/${i}`, chain)
        const produced = errors.splice(savedLength)
        if (produced.length === 0) return true
        local.push(...produced)
        branchErrors.push(...local)
        return false
      })
      if (!matched) {
        errors.splice(before)
        fail(instancePath, `${schemaPath}/anyOf`, 'anyOf', '不满足任何 anyOf 分支', { branches: node.anyOf.length })
      }
    }
    if (Array.isArray(node.oneOf)) {
      const before = errors.length
      let matchedCount = 0
      node.oneOf.forEach((sub, i) => {
        const savedLength = errors.length
        walk(value, sub, instancePath, `${schemaPath}/oneOf/${i}`, chain)
        const produced = errors.splice(savedLength)
        if (produced.length === 0) matchedCount += 1
      })
      errors.splice(before)
      if (matchedCount !== 1) fail(instancePath, `${schemaPath}/oneOf`, 'oneOf', `匹配 ${matchedCount} 个分支（必须恰好 1 个）`, { matched: matchedCount })
    }
    if (node.not !== undefined) {
      const savedLength = errors.length
      walk(value, node.not, instancePath, `${schemaPath}/not`, chain)
      const produced = errors.splice(savedLength)
      if (produced.length === 0) fail(instancePath, `${schemaPath}/not`, 'not', '命中了 not 禁止的形态')
    }
  }

  walk(data, schema, '', '#', [])
  const schemaIssues = state.issues
  const complete = schemaIssues.length === 0
  const valid = schemaIssues.length > 0 && strictSchema ? false : complete ? errors.length === 0 : null
  return { valid, complete, errorCount: errors.length, errors, schemaIssues, maxErrors }
}

export function applyDefaults(data, schema, root = schema) {
  if (schema === null || typeof schema !== 'object') return data
  if (schema.$ref !== undefined) return applyDefaults(data, resolveRef(schema.$ref, root, []), root)
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && schema.properties !== undefined) {
    const output = Array.isArray(data) ? [...data] : { ...data }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(output, key)) {
        if (child !== null && typeof child === 'object' && Object.hasOwn(child, 'default')) output[key] = structuredClone(child.default)
        continue
      }
      output[key] = applyDefaults(output[key], child, root)
    }
    return output
  }
  if (Array.isArray(data) && schema.items !== undefined && !Array.isArray(schema.items)) {
    return data.map((item) => applyDefaults(item, schema.items, root))
  }
  return data
}

export function explainSchema(schema, path = '#', out = [], depth = 0) {
  if (depth > LIMITS.depth) throw new Error('schema 嵌套过深')
  if (schema === null || typeof schema !== 'object') return out
  if (schema.$ref !== undefined) {
    out.push({ path, keyword: '$ref', value: schema.$ref })
    return out
  }
  for (const key of ['type', 'enum', 'const', 'required', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'multipleOf', 'additionalProperties', 'minProperties', 'maxProperties', 'uniqueItems']) {
    if (schema[key] !== undefined) out.push({ path, keyword: key, value: schema[key] })
  }
  for (const key of ['properties']) {
    if (schema[key] !== undefined) for (const [name, child] of Object.entries(schema[key])) explainSchema(child, `${path}/${key}/${escapePointer(name)}`, out, depth + 1)
  }
  if (schema.items !== undefined && typeof schema.items === 'object' && !Array.isArray(schema.items)) explainSchema(schema.items, `${path}/items`, out, depth + 1)
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) schema[key].forEach((child, i) => explainSchema(child, `${path}/${key}/${i}`, out, depth + 1))
  }
  if (schema.not !== undefined) explainSchema(schema.not, `${path}/not`, out, depth + 1)
  return out
}

export const spec = {
  name: 'schema',
  description:
    'JSON Schema 子集校验（draft 2020-12 风格，零网络零动态执行）：validate 给 verdict 与 RFC 6901 错误路径；' +
    'paths 只列失败路径；explain 静态列约束树；normalize 深拷贝并套用显式 default 后再校验（不改原对象、不强制类型转换）。' +
    '支持 type/enum/const、object(required/properties/additionalProperties/min/maxProperties)、array(items/min/maxItems/uniqueItems)、' +
    'string(min/maxLength/pattern)、number(minimum/maximum/exclusive*/multipleOf)、allOf/anyOf/oneOf/not、本地 $ref。' +
    '铁律：**不支持的关键字绝不静默忽略** —— 一律进 schemaIssues；strictSchema=true（默认）判失败，false 则只验支持子集并给 valid=null。',
  parameters: {
    action: { type: 'string', enum: ['validate', 'paths', 'explain', 'normalize'], required: true, description: '要做的操作' },
    schema: { type: 'json', required: true, description: 'JSON Schema（布尔或对象，支持本地 $ref）' },
    data: { type: 'json', description: '要校验/规范化的实例（validate/paths/normalize 必填；null 是合法数据）' },
    strictSchema: { type: 'boolean', default: true, description: '遇到不支持的关键字是否判失败（默认 true）' },
    maxErrors: { type: 'integer', description: '最多返回多少条错误，默认 100，上限 1000' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    const schema = args?.schema
    if (action === 'explain') {
      const nodes = explainSchema(schema)
      const state = { nodes: 0, depth: 0, issues: [] }
      inspectSchema(schema, '#', state)
      return { ok: true, action, nodeCount: nodes.length, nodes, schemaIssues: state.issues }
    }
    const data = args?.data
    if (action === 'validate' || action === 'paths') {
      const result = validate(data, schema, { strictSchema: args?.strictSchema, maxErrors: args?.maxErrors })
      if (action === 'validate') return { ok: true, action, ...result }
      const paths = [...new Set(result.errors.map((e) => e.instancePath === '' ? '(root)' : e.instancePath))]
      const byKeyword = {}
      for (const error of result.errors) byKeyword[error.keyword] = (byKeyword[error.keyword] ?? 0) + 1
      return { ok: true, action, valid: result.valid, complete: result.complete, errorCount: result.errorCount, paths, byKeyword, schemaIssues: result.schemaIssues }
    }
    if (action === 'normalize') {
      const normalized = applyDefaults(data, schema)
      const result = validate(normalized, schema, { strictSchema: args?.strictSchema, maxErrors: args?.maxErrors })
      return { ok: true, action, normalized, changed: JSON.stringify(normalized) !== JSON.stringify(data), ...result }
    }
    throw new Error(`不支持的 action "${action}"（可用 validate/paths/explain/normalize）`)
  },
  timeoutMs: 5000,
}
