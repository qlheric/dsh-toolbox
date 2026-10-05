/**
 * time —— 时间换算（确定性、零依赖，只用 Intl + Date）。
 *
 * action:
 *   now      当前时间（UTC + 指定时区呈现）
 *   convert  把一个严格 ISO 时间戳按指定时区呈现（可选换算出另一时区的墙上时间）
 *   add      UTC 日历算术（月/年按月末钳制）
 *   diff     两个严格 ISO 时间戳之间的固定时长差（天/时/分/秒）
 *
 * 口径声明：内部一律 UTC 计算；时区只影响**呈现**，不改变时间点本身。
 */

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/
const UNITS = new Set(['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'])
const DEFAULT_TZ = 'Asia/Shanghai'

export function parseInstant(text, field = 'value') {
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`${field} 必须是非空字符串`)
  const match = ISO_PATTERN.exec(text.trim())
  if (match === null) throw new Error(`${field} "${text}" 不是严格 ISO 8601（例：2026-10-06T05:30:00Z 或 2026-10-06 05:30:00+08:00）`)
  const [, y, mo, d, hh, mm, ss, ms, offset] = match
  const hasTime = hh !== undefined
  const zone = offset ?? (hasTime ? 'Z' : 'Z')
  if (!hasTime && offset !== undefined && offset !== 'Z') throw new Error(`${field} 只有日期时不能带偏移量`)
  const iso = `${y}-${mo}-${d}${hasTime ? `T${hh}:${mm}:${ss ?? '00'}.${(ms ?? '0').padEnd(3, '0')}` : 'T00:00:00.000'}${zone}`
  const epoch = Date.parse(iso)
  if (Number.isNaN(epoch)) throw new Error(`${field} "${text}" 解析失败`)
  // 校验日历合法性：把时间点按**输入自带的偏移**回推，再比对年月日
  // （带 +08:00 的 10-06 05:30 换算成 UTC 是 10-05 21:30，直接比 UTC 会误判）
  const offsetMinutes = offset === undefined || offset === 'Z' ? 0 : (() => {
    const sign = offset.startsWith('-') ? -1 : 1
    const [oh, om] = offset.slice(1).split(':')
    return sign * (Number(oh) * 60 + Number(om))
  })()
  const verify = new Date(epoch + offsetMinutes * 60_000)
  if (verify.getUTCFullYear() !== Number(y) || verify.getUTCMonth() + 1 !== Number(mo) || verify.getUTCDate() !== Number(d)) {
    throw new Error(`${field} "${text}" 不是合法日历日期`)
  }
  return { epoch, iso: new Date(epoch).toISOString(), hasTime }
}

export function formatInZone(epoch, timeZone) {
  let formatter
  try {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    throw new Error(`未知时区 "${timeZone}"（要用 IANA 名，如 Asia/Shanghai / UTC）`)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((p) => [p.type, p.value]))
  const offsetMinutes = -new Date(epoch).getTimezoneOffset()
  void offsetMinutes
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  const offset = zoneOffset(epoch, timeZone)
  return { local, offset, display: `${local}${offset}` }
}

function zoneOffset(epoch, timeZone) {
  const base = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(epoch))
  const name = base.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const match = /GMT([+-]\d{2}:\d{2})?/.exec(name)
  if (match === null) return ''
  return match[1] ?? '+00:00'
}

export function addUnit(epoch, amount, unit) {
  if (!UNITS.has(unit)) throw new Error(`不支持的 unit "${unit}"（可用 ${[...UNITS].join('/')}）`)
  if (!Number.isSafeInteger(amount)) throw new Error('amount 必须是安全整数')
  const date = new Date(epoch)
  const fixedMs = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }
  if (Object.hasOwn(fixedMs, unit)) return epoch + fixedMs[unit] * amount
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const timeMs = (date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()) * 1000 + date.getUTCMilliseconds()
  const monthsToAdd = unit === 'months' ? amount : amount * 12
  const totalMonths = year * 12 + month + monthsToAdd
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const clampedDay = Math.min(day, daysInTarget)
  return Date.UTC(targetYear, targetMonth, clampedDay) + timeMs
}

export function humanizeDuration(ms) {
  const sign = ms < 0 ? -1 : 1
  let rest = Math.abs(ms)
  const days = Math.floor(rest / 86_400_000)
  rest -= days * 86_400_000
  const hours = Math.floor(rest / 3_600_000)
  rest -= hours * 3_600_000
  const minutes = Math.floor(rest / 60_000)
  rest -= minutes * 60_000
  const seconds = Math.floor(rest / 1000)
  const milliseconds = rest - seconds * 1000
  return { sign, days, hours, minutes, seconds, milliseconds, totalSeconds: Math.round(ms / 1000) }
}

export const spec = {
  name: 'time',
  description:
    '时间工具：now 取当前时间；convert 把严格 ISO 时间戳按 IANA 时区呈现（并给出偏移量）；' +
    'add 做 UTC 日历算术（月/年按月末钳制，如 1-31 + 1 月 = 2-28）；diff 给两个时间戳之间的固定时长差。' +
    '口径：内部一律 UTC 计算，时区只影响呈现，不改变时间点。默认时区 Asia/Shanghai。',
  parameters: {
    action: { type: 'string', enum: ['now', 'convert', 'add', 'diff'], required: true, description: '要做的操作' },
    value: { type: 'string', description: 'convert/add 的严格 ISO 8601 时间戳（省略则用当前时刻）' },
    timezone: { type: 'string', default: 'Asia/Shanghai', description: 'IANA 时区名，默认 Asia/Shanghai' },
    from: { type: 'string', description: 'diff 的起始时间戳' },
    to: { type: 'string', description: 'diff 的结束时间戳' },
    amount: { type: 'integer', description: 'add 的增量（可为负）' },
    unit: {
      type: 'string',
      enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'],
      description: 'add 的单位',
    },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    const timeZone = String(args?.timezone ?? DEFAULT_TZ)
    if (action === 'now') {
      const epoch = Date.now()
      return { ok: true, action, iso: new Date(epoch).toISOString(), epoch, timezone: timeZone, ...formatInZone(epoch, timeZone) }
    }
    if (action === 'convert') {
      const instant = args?.value === undefined ? { epoch: Date.now(), iso: new Date().toISOString() } : parseInstant(args.value)
      return { ok: true, action, iso: instant.iso, epoch: instant.epoch, timezone: timeZone, ...formatInZone(instant.epoch, timeZone) }
    }
    if (action === 'add') {
      const instant = args?.value === undefined ? { epoch: Date.now(), iso: new Date().toISOString() } : parseInstant(args.value)
      const amount = args?.amount === undefined ? 0 : Number(args.amount)
      const unit = String(args?.unit ?? '')
      const resultEpoch = addUnit(instant.epoch, Math.trunc(amount), unit)
      return {
        ok: true,
        action,
        from: instant.iso,
        amount: Math.trunc(amount),
        unit,
        iso: new Date(resultEpoch).toISOString(),
        epoch: resultEpoch,
        timezone: timeZone,
        ...formatInZone(resultEpoch, timeZone),
      }
    }
    if (action === 'diff') {
      const start = parseInstant(args?.from, 'from')
      const end = parseInstant(args?.to, 'to')
      const ms = end.epoch - start.epoch
      return { ok: true, action, from: start.iso, to: end.iso, milliseconds: ms, ...humanizeDuration(ms) }
    }
    throw new Error(`不支持的 action "${action}"（可用 now/convert/add/diff）`)
  },
  timeoutMs: 2000,
}
