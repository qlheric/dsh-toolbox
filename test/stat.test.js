import { test } from 'node:test'
import assert from 'node:assert/strict'

import { correlation, describeNumbers, frequency, normalizeValues, percentile, spec } from '../lib/stat.js'

test('描述统计与已知值', () => {
  const d = describeNumbers([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(d.count, 8)
  assert.equal(d.sum, 40)
  assert.equal(d.mean, 5)
  assert.equal(d.median, 4.5)
  assert.equal(d.min, 2)
  assert.equal(d.max, 9)
  assert.equal(Number(d.standardDeviation.toFixed(6)), 2) // 总体标准差（32/8=4 ⇒ sd=2）
  assert.equal(d.q1, 4)
  assert.equal(d.q3, 5.5)
  assert.equal(Number(d.iqr.toFixed(2)), 1.5)
  assert.equal(Number(describeNumbers([2, 4, 4, 4, 5, 5, 7, 9], true).standardDeviation.toFixed(5)), 2.13809) // 样本标准差
})

test('样本 vs 总体方差', () => {
  const population = describeNumbers([1, 2, 3, 4], false)
  const sample = describeNumbers([1, 2, 3, 4], true)
  assert.equal(population.variance, 1.25)
  assert.equal(Number(sample.variance.toFixed(6)), 1.666667)
})

test('分位线性插值与顺序保持', () => {
  const values = [1, 2, 3, 4]
  const result = percentile(values, [0, 25, 50, 100])
  assert.deepEqual(result.map((r) => r.value), [1, 1.75, 2.5, 4])
  // 请求顺序保持（不是升序输出）
  const reversed = percentile(values, [90, 10])
  assert.deepEqual(reversed.map((r) => r.percentile), [90, 10])
})

test('频数分布（严格相等、升序、比值分母为原始条数）', () => {
  const f = frequency([2, 1, 2, 3, 2])
  assert.deepEqual(f, [
    { value: 1, count: 1, ratio: 0.2 },
    { value: 2, count: 3, ratio: 0.6 },
    { value: 3, count: 1, ratio: 0.2 },
  ])
})

test('相关：Pearson 与 Spearman，零方差要显式说明', () => {
  const pearson = correlation([1, 2, 3, 4], [2, 4, 6, 8])
  assert.equal(pearson.defined, true)
  assert.equal(Number(pearson.value.toFixed(6)), 1)
  const spearman = correlation([1, 2, 3, 4], [1, 4, 9, 16], 'spearman')
  assert.equal(Number(spearman.value.toFixed(6)), 1)
  const flat = correlation([1, 1, 1], [1, 2, 3])
  assert.equal(flat.defined, false)
  assert.equal(flat.reason, 'zero-variance')
})

test('输入守卫：拒 NaN/Infinity、归一 -0、限长', () => {
  assert.throws(() => normalizeValues([1, Number.NaN]), /不是有限数字/)
  assert.throws(() => normalizeValues([1, Number.POSITIVE_INFINITY]), /不是有限数字/)
  assert.throws(() => normalizeValues([]), /不能为空/)
  assert.throws(() => normalizeValues(new Array(100_001).fill(1)), /超出上限/)
  assert.ok(Object.is(normalizeValues([-0])[0], 0))
})

test('spec.execute 全 action', () => {
  const base = spec.execute({ action: 'describe', values: [1, 2, 3] })
  assert.equal(base.count, 3)
  assert.equal(spec.execute({ action: 'percentile', values: [1, 2, 3], percentiles: [50] }).percentiles[0].value, 2)
  assert.equal(spec.execute({ action: 'frequency', values: [1, 1, 2] }).distinct, 2)
  const corr = spec.execute({ action: 'correlation', values: [1, 2], other: [2, 4] })
  assert.equal(corr.defined, true)
  assert.throws(() => spec.execute({ action: 'correlation', values: [1, 2], other: [1] }), /长度必须一致/)
  assert.throws(() => spec.execute({ action: 'nope', values: [1] }), /不支持的 action/)
})
