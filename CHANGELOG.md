# Changelog

本文件只记**对外可见的变化**（工具面、参数口径、兼容声明）。内部重构不写。

## [Unreleased]

### 待做
- 替换动作：装本包前需先卸掉 `@deepseek-ai/dsh-tool-*` 十件套（工具名同名 → 注册表硬拒绝，两者不能共存）。
- 发布（README 重构、repo 命名）待老大拍板。

## [0.2.0] — 2026-10-06

### 新增（10/10 工具齐了）
| 工具 | 能力 | 关键口径 |
|---|---|---|
| `stat` | `describe`/`percentile`/`frequency`/`correlation` | 求和用 Neumaier 补偿、方差用 Welford；样本/总体方差可切；零方差显式返回 `defined=false` |
| `markdown` | `headings`/`toc`/`table`/`to_text`/`stats` | 锚点按 GFM（小写/去标点/空格转 `-`/保留中文）；标题收集**自动跳过代码块**；HTML `<table>` 也能转 GFM |
| `schema` | `validate`/`paths`/`explain`/`normalize` | JSON Schema 子集（含 `$ref`）；**不支持的关键字绝不静默忽略**（进 `schemaIssues`，strict 时判失败）；`normalize` 不改原对象、不强转类型 |

### 测试
- `node --test`：**61 项全绿**（10 个工具）。
- 本轮又抓出并修掉 4 处：`stat` 把总体标准差写成样本、`schema` explain 的路径口径、`markdown` 未拒绝非字符串输入、测试自身两处期望值写错。

### 验收（沙箱真跑，不是"应该能跑"）
- 干净沙箱 profile `profiles/zsandbox2`（base + web-app + 本包）→ 启动日志：
  `[dsh-toolbox] 已注册 10 个工具：calculator, encoding, json, diff, time, csv, regex, stat, markdown, schema`，**stderr 零告警**。
- `--dump-config` 合成树有 `- id: tool-box` 行，无 `not found`。

### 环境坑（两个，都实测）
1. `DSH_HOME`（`C:\Users\38628\.dsh`）是 **junction → `G:\DSH-Home`**：pnpm 的 `link:` 依赖会生成**相对符号链接**，在 C: 路径下解析成不存在的 `C:\Users\38628\workagent2\…` ⇒ 悬空。要用**绝对 junction**或直接拷贝。
2. **插件若 import 核心包（如 `@deepseek-ai/dsh-tools`），它的 realpath 必须在 profile 内**：用 junction 指到别的盘（`G:\workagent2\…`）会让核心包解析失败 ⇒ 宿主日志只有一行 `tool-box (@qlheric/dsh-toolbox): failed to import`。装进 `node_modules` 后即正常（真实安装天然满足）。

## [0.1.0] — 2026-10-06

### 新增（7/10 工具）
| 工具 | 能力 | 关键口径 |
|---|---|---|
| `json` | `get`/`keys`/`type`/`validate`/`format` | 路径支持 `$`、点号、`['键']`、`[下标]`（含负数）、`[*]` 通配；取值失败**返回原因不抛异常**；`validate` 给行列 |
| `calculator` | 算式求值 | **不用 `eval`**；标识符必须命中白名单函数/常量；`^` 右结合；结果非有限数即报错 |
| `encoding` | base64/base64url/url/hex、md5~sha512、uuid v4 | 纯本地；hex 解码校验长度与字符集 |
| `diff` | `text`(unified)/`json`(路径级)/`csv`(按行) | 动态规划带规模守卫：超 `maxLines` 退化为"前后缀 + 整段替换"，不卡死 |
| `time` | `now`/`convert`/`add`/`diff` | 内部一律 UTC；时区只影响呈现；`add` 月/年**按月末钳制**（1-31 +1月 = 2-28） |
| `csv` | `parse`/`query`/`stats`/`summarize`/`to_markdown` | RFC 4180 状态机；引号内逗号/换行/`""` 转义；忽略 BOM；支持 `tab` |
| `regex` | `test`/`find`/`replace`/`explain` | **静态 ReDoS 体检**（嵌套量词/分支重叠 → low~high）；`high` 且输入 >4KB **拒绝执行**；上限 pattern 16KB / 输入 64KB |

### 测试
- `node --test`：**39 项全绿**（7 个工具，含边界与失败路径）。
- 测试当场抓出并修掉 3 个真缺陷：`json` 路径省略 `$` 时的裸键解析、`diff` 尾部上下文丢失、`time` 带偏移量时间戳被误判为非法日期。

### 兼容
- `dsh.compatibility`：`>=0.2.0-rc.2 <0.3.0`，`dshReleases["0.2.0-rc.2"]="compatible"`，`profiles: ["web","desktop"]`。
- 零运行时依赖、零构建（纯 ESM）；参数 schema 只用 rc.2 允许的词汇（`type`/`required`(仅 true)/`description`/`default`/`enum`）。
