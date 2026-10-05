/**
 * stat —— 描述统计（确定性、零依赖，纯函数）。
 *
 * action:
 *   describe      count/sum/min/max/mean/median/variance/stddev/q1/q3/iqr（可切样本方差）
 *   percentile    任意分位（线性插值 h=(n-1)p，保持请求顺序）
 *   frequency     频数分布（严格相等分组，比值以原始条数为分母）
 *   correlation   Pearson / Spearman（中位秩）
 *
 * 口径：拒绝 NaN/Infinity；-0 归一为 0；求和用 Neumaier 补偿，方差用 Welford；
 * 限 1..100000 个观测；结果再做一次有限性复核（溢出宁可报错也不吐非有限 JSON）。
 */

const MAX_OBSERVATIONS = 100_000
const MAX_PERCENTILES = 100
const MAX_DISTINCT = 10_000

export function normalizeValues(input, field = 'values') {
  if (!Array.isArray(input)) throw new Error(`${field} 必须是数字数组`)
  if (input.length === 0) throw new Error(`${field} 不能为空`)
  if (input.length > MAX_OBSERVATIONS) throw new Error(`${field} 超出上限 ${MAX_OBSERVATIONS}`)
  return input.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field}[${index}] 不是有限数字：${String(value)}`)
    return Object.is(value, -0) ? 0 : value
  })
}

function neumaierSum(values) {
  let sum = 0
  let compensation = 0
  for (const value of values) {
    const t = sum + value
    if (Math.abs(sum) >= Math.abs(value)) compensation += sum - t + value
    else compensation += value - t + sum
    sum = t
  }
  return sum + compensation
}

export function describeNumbers(values, sample = false) {
  const n = values.length
  const sorted = [...values].sort((a, b) => a - b)
  const sum = neumaierSum(values)
  const mean = sum / n
  let m2 = 0
  let mean2 = 0
  for (let i = 0; i < n; i += 1) {
    const delta = values[i] - mean2
    mean2 += delta / (i + 1)
    m2 += delta * (values[i] - mean2)
  }
  const denominator = sample ? Math.max(1, n - 1) : n
  const variance = n > 1 ? m2 / denominator : 0
  const quantile = (p) => {
    if (n === 1) return sorted[0]
    const h = (n - 1) * p
    const lo = Math.floor(h)
    const hi = Math.ceil(h)
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
  }
  const q1 = quantile(0.25)
  const q3 = quantile(0.75)
  return {
    count: n,
    sum,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantile(0.5),
    variance,
    standardDeviation: Math.sqrt(variance),
    q1,
    q3,
    iqr: q3 - q1,
    sample,
  }
}

export function percentile(values, percentiles) {
  if (!Array.isArray(percentiles) || percentiles.length === 0) throw new Error('percentiles 必须是非空数组')
  if (percentiles.length > MAX_PERCENTILES) throw new Error(`percentiles 超出上限 ${MAX_PERCENTILES}`)
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  return percentiles.map((p, index) => {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) throw new Error(`percentiles[${index}] 必须在 0..100`)
    if (n === 1) return { percentile: p, value: sorted[0] }
    const h = (n - 1) * (p / 100)
    const lo = Math.floor(h)
    const hi = Math.ceil(h)
    return { percentile: p, value: sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]) }
  })
}

export function frequency(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (counts.size > MAX_DISTINCT) throw new Error(`不同取值超出上限 ${MAX_DISTINCT}`)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ value, count, ratio: count / values.length }))
}

function rank(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const ranks = new Array(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1
    const average = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = average
    i = j + 1
  }
  return ranks
}

export function correlation(left, right, method = 'pearson') {
  if (left.length !== right.length) throw new Error('两组观测长度必须一致')
  if (left.length < 2) throw new Error('至少需要 2 组观测')
  const a = method === 'spearman' ? rank(left) : left
  const b = method === 'spearman' ? rank(right) : right
  const meanA = neumaierSum(a) / a.length
  const meanB = neumaierSum(b) / b.length
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return { method, defined: false, reason: 'zero-variance' }
  const value = cov / Math.sqrt(varA * varB)
  if (!Number.isFinite(value)) return { method, defined: false, reason: 'numeric-overflow' }
  return { method, defined: true, value: Math.max(-1, Math.min(1, value)) }
}

export const spec = {
  name: 'stat',
  description:
    '描述统计：describe 给 count/sum/min/max/mean/median/variance/stddev/q1/q3/iqr（sample=true 用样本方差）；' +
    'percentile 给任意分位（线性插值，保持请求顺序，可一次问多个）；frequency 给频数分布（严格相等分组）；' +
    'correlation 给 Pearson 或 Spearman（中位秩）相关。拒绝 NaN/Infinity、归一 -0、限 1..100000 个观测。',
  parameters: {
    action: { type: 'string', enum: ['describe', 'percentile', 'frequency', 'correlation'], required: true, description: '要做的统计' },
    values: { type: 'array', items: { type: 'number' }, required: true, description: '有限数字数组（1..100000）' },
    other: { type: 'array', items: { type: 'number' }, description: 'correlation 的第二组观测，长度需与 values 一致' },
    percentiles: { type: 'array', items: { type: 'number' }, description: 'percentile 要算的分位（0..100，最多 100 个）' },
    method: { type: 'string', enum: ['pearson', 'spearman'], default: 'pearson', description: 'correlation 的方法' },
    sample: { type: 'boolean', description: 'describe 是否用样本（n-1）方差，默认 false' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    const values = normalizeValues(args?.values)
    if (action === 'describe') {
      return { ok: true, action, ...describeNumbers(values, Boolean(args?.sample)) }
    }
    if (action === 'percentile') {
      const requested = args?.percentiles ?? [50]
      return { ok: true, action, count: values.length, percentiles: percentile(values, normalizeValues(requested, 'percentiles')) }
    }
    if (action === 'frequency') {
      return { ok: true, action, count: values.length, distinct: new Set(values).size, frequency: frequency(values) }
    }
    if (action === 'correlation') {
      const other = normalizeValues(args?.other, 'other')
      return { ok: true, action, count: values.length, ...correlation(values, other, String(args?.method ?? 'pearson')) }
    }
    throw new Error(`不支持的 action "${action}"（可用 describe/percentile/frequency/correlation）`)
  },
  timeoutMs: 5000,
}
