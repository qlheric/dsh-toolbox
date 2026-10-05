/**
 * dsh-toolbox —— 一个包装齐十个零依赖确定性工具。
 *
 * 设计约束（刻意的）：
 *   1. **零运行时依赖、零构建**：纯 ESM，直接跑；没有 tsup/vitest/pnpm-workspace 那一套。
 *   2. **确定性**：每个工具只做纯计算（哈希用 node:crypto，不发网络、不读工作区）。
 *   3. **注册即 effect**：任一工具注册失败 → 逆序回滚已注册的，绝不留"注册了一半"的状态。
 *   4. **参数 schema 只用 rc.2 允许的词汇**：type/required(仅 true)/description/default/enum/items/properties。
 *
 * 加一个工具 = 写 `lib/<name>.js` 导出 `spec`，再在 MODULES 里登记一行。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import * as calculator from './lib/calculator.js'
import * as encoding from './lib/encoding.js'
import * as json from './lib/json.js'
import * as diff from './lib/diff.js'
import * as time from './lib/time.js'
import * as csv from './lib/csv.js'
import * as regex from './lib/regex.js'
import * as stat from './lib/stat.js'
import * as markdown from './lib/markdown.js'
import * as schema from './lib/schema.js'

/** 十个工具；加一个 = 写 lib/<name>.js 导出 spec，再在这里登记一行。 */
const MODULES = [calculator, encoding, json, diff, time, csv, regex, stat, markdown, schema]

export const name = '@qlheric/dsh-toolbox'
export const inject = ['tools']

export function apply(ctx) {
  const disposers = []
  const registered = []
  try {
    for (const mod of MODULES) {
      const spec = mod.spec
      if (spec === undefined || typeof spec.name !== 'string') {
        throw new Error(`模块 ${mod?.default?.name ?? '未知'} 没有导出合法的 spec`)
      }
      disposers.push(ctx.tools.register(defineTool(spec)))
      registered.push(spec.name)
    }
  } catch (error) {
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose()
      } catch {
        /* 回滚失败不掩盖原始错误 */
      }
    }
    throw new Error(
      `dsh-toolbox: 注册失败（已回滚 ${registered.length} 个：${registered.join(', ') || '无'}）：${String(error?.message ?? error)}`,
    )
  }
  console.log(`[dsh-toolbox] 已注册 ${registered.length} 个工具：${registered.join(', ')}`)
  return () => {
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose()
      } catch {
        /* 卸载期异常不外抛 */
      }
    }
  }
}
