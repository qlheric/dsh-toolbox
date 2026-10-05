import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addUnit, formatInZone, humanizeDuration, parseInstant, spec } from '../lib/time.js'

test('严格 ISO 解析与拒绝模糊输入', () => {
  assert.equal(parseInstant('2026-10-06T05:30:00Z').epoch, Date.UTC(2026, 9, 6, 5, 30, 0))
  assert.equal(parseInstant('2026-10-06 05:30:00+08:00').epoch, Date.UTC(2026, 9, 5, 21, 30, 0))
  assert.equal(parseInstant('2026-10-06').epoch, Date.UTC(2026, 9, 6))
  assert.throws(() => parseInstant('2026/10/06'), /不是严格 ISO/)
  assert.throws(() => parseInstant('2026-02-30'), /不是合法日历日期/)
  assert.throws(() => parseInstant(''), /非空字符串/)
})

test('时区只影响呈现', () => {
  const instant = parseInstant('2026-10-06T05:30:00Z')
  const sh = formatInZone(instant.epoch, 'Asia/Shanghai')
  const utc = formatInZone(instant.epoch, 'UTC')
  assert.equal(sh.local, '2026-10-06T13:30:00')
  assert.equal(sh.offset, '+08:00')
  assert.equal(utc.local, '2026-10-06T05:30:00')
  assert.throws(() => formatInZone(instant.epoch, 'Mars/Olympus'), /未知时区/)
})

test('日历算术含月末钳制', () => {
  const jan31 = Date.UTC(2026, 0, 31, 12, 0, 0)
  assert.equal(new Date(addUnit(jan31, 1, 'months')).toISOString(), '2026-02-28T12:00:00.000Z')
  assert.equal(new Date(addUnit(jan31, 1, 'days')).toISOString(), '2026-02-01T12:00:00.000Z')
  assert.equal(new Date(addUnit(jan31, 1, 'years')).toISOString(), '2027-01-31T12:00:00.000Z')
  assert.equal(new Date(addUnit(jan31, -1, 'months')).toISOString(), '2025-12-31T12:00:00.000Z')
  assert.throws(() => addUnit(jan31, 1, 'fortnights'), /不支持的 unit/)
  assert.throws(() => addUnit(jan31, 1.5, 'days'), /安全整数/)
})

test('时长人性化', () => {
  const h = humanizeDuration(90_061_500)
  assert.equal(h.days, 1)
  assert.equal(h.hours, 1)
  assert.equal(h.minutes, 1)
  assert.equal(h.seconds, 1)
  assert.equal(humanizeDuration(-1000).totalSeconds, -1)
})

test('spec.execute 各 action', () => {
  const now = spec.execute({ action: 'now', timezone: 'UTC' })
  assert.equal(now.ok, true)
  assert.match(now.iso, /^\d{4}-\d{2}-\d{2}T/)
  const diff = spec.execute({ action: 'diff', from: '2026-10-06T00:00:00Z', to: '2026-10-07T12:00:00Z' })
  assert.equal(diff.days, 1)
  assert.equal(diff.hours, 12)
  const added = spec.execute({ action: 'add', value: '2026-01-31', amount: 1, unit: 'months', timezone: 'Asia/Shanghai' })
  assert.equal(added.iso, '2026-02-28T00:00:00.000Z')
  assert.match(added.local, /^2026-02-28T08:00:00/)
  assert.throws(() => spec.execute({ action: 'nope' }), /不支持的 action/)
})
