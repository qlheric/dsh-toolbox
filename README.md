# dsh-toolbox · DSH 工具箱

**一个包，十个零依赖确定性工具**：JSON 查询、算式求值、编码哈希、文本差异、时间换算、CSV、正则、统计、Markdown、JSON Schema。

给 DeepSeek Harness（dsh）用。装一次，十把工具一起进模型工具面——不用为每个小工具装一个插件。

- 内核：**dsh 0.2.0-rc.2**（桌面端 `DSH Desktop v2.0.17` 实测）
- 依赖：**零运行时依赖**（哈希走 `node:crypto`）
- 构建：**零构建**（纯 ESM，装上即可跑）
- 许可：MIT

---

## 为什么

写代码/查数据时，模型每轮都要"算一下、转一下、比一下"：JSON 里掏一个字段、对两段文本做 diff、把时间戳换时区、给一列数字算分位、验证一段 JSON Schema……

这些活儿**要么靠模型心算（会错），要么临时写脚本（慢、乱、不可复现）**。dsh-toolbox 把它们变成 10 个确定性工具：输入一样，输出永远一样，而且**本地算、不发网络、不读工作区**。

## 安装

## 安装

```bash
dsh plugin --profile <你的 profile> add github:qlheric/dsh-toolbox
```

装完重启 dsh，工具为 `json` / `calculator` / `encoding` / `diff` / `time` / `csv` / `regex` / `stat` / `markdown` / `schema`。

> **桌面端（Electron）注意**：`desktop` profile 被 Electron 独占（`dsh plugin --profile desktop` 会被官方 CLI 拒绝），那里只能手写 `package.json` 的 `dsh.profile.bundles` 并用 pnpm 装（本机就是这么装的）；**其它 profile** 直接用上面这条命令，CLI 会自动同步 bundles。
> npm 尚未发布（`npm install @qlheric/dsh-toolbox` 暂时不可用），请用上面的 GitHub 源。

## 快速上手

```
json      input={"a":{"b":[1,2,3]}}  action=get  path=$.a.b[-1]   → 3
diff      left="a\nb\nc"  right="a\nB\nc"  mode=text              → @@ -1,3 +1,3 @@ … -b +B
time      action=add  value=2026-01-31  amount=1  unit=months     → 2026-02-28（月末钳制）
stat      action=describe  values=[2,4,4,4,5,5,7,9]               → mean 5 · median 4.5 · q1 4 · q3 5.5
csv       action=summarize  csv="id,score\n1,10\n2,20"            → score: sum 30 · mean 15
regex     action=test  pattern="(a+)+"  input="aaaa…"             → 拒绝执行（静态 ReDoS high + 大输入）
schema    action=validate  schema={type:integer}  data="1"        → valid=false · /type：期望 integer，实际 string
```

## 工具清单

| 工具 | actions | 关键口径 |
|---|---|---|
| `json` | `get` `keys` `type` `validate` `format` | 路径支持 `$`、`.a.b`、`['键']`、`[下标]`（含负数）、`[*]` 通配；**取值失败返回原因不抛异常**；`validate` 给行列 |
| `calculator` | 算式求值 | **不用 `eval`**；标识符必须命中白名单函数/常量；`^` 右结合；结果非有限数即报错 |
| `encoding` | `encode` `decode` `hash` `uuid` | base64 / base64url / url / hex；md5~sha512；hex 解码校验长度与字符集 |
| `diff` | `text` `json` `csv` | unified diff（`@@` 头 + 上下文行）；JSON 给到路径级 add/remove/change；超 `maxLines` 退化为"前后缀 + 整段替换"，不卡死 |
| `time` | `now` `convert` `add` `diff` | 内部一律 UTC、时区只影响呈现；`add` 月/年**按月末钳制**（1-31 +1月 = 2-28） |
| `csv` | `parse` `query` `stats` `summarize` `to_markdown` | RFC 4180 状态机；引号内逗号/换行/`""` 转义；忽略 BOM；支持 `tab` |
| `regex` | `test` `find` `replace` `explain` | **静态 ReDoS 体检**（嵌套量词/分支重叠 → low~high）；`high` 且输入 >4KB **拒绝执行**；上限 pattern 16KB / 输入 64KB |
| `stat` | `describe` `percentile` `frequency` `correlation` | Neumaier 补偿求和、Welford 方差；样本/总体可切；零方差显式 `defined=false` |
| `markdown` | `headings` `toc` `table` `to_text` `stats` | GFM 锚点（保留中文）；标题收集自动跳过代码块；HTML `<table>` 也能转 GFM |
| `schema` | `validate` `paths` `explain` `normalize` | JSON Schema 子集（含本地 `$ref`）；**不支持的关键字绝不静默忽略**；`normalize` 不改原对象、不强转类型 |

## 设计取舍

1. **确定性优先**：全部纯计算。没有网络、没有临时文件、没有"看情况"。同样的输入永远同样的输出，便于写断言。
2. **失败要说人话**：`json` 取值失败给"不存在键 a"而不是抛异常；`regex` 命中 ReDoS 风险时**拒绝执行并说明原因**，而不是让宿主去赌灾难性回溯。
3. **口径写进描述**：每个工具的边界（上限、单位、时区语义）都写在工具描述里，模型调用前就能预判，不用靠试。
4. **一个包，不是十个包**：十把工具共用一个挂载点、一份兼容声明、一次升级。

## 兼容

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "compatibility": { "dsh": ">=0.2.0-rc.2 <0.3.0", "dshReleases": { "0.2.0-rc.2": "compatible" }, "profiles": ["web", "desktop"] }
}
```

参数 schema 只用 rc.2 允许的词汇（`type` / `required`(仅 `true`) / `description` / `default` / `enum` / `items`）——这一点有测试守着。

## 开发与测试

```bash
node --test          # 61 项，全绿
```

- `lib/<工具>.js` 导出 `spec`（工具定义）+ 纯函数（便于单测）；
- `index.js` 是唯一的挂载入口，注册失败会**逆序回滚**已注册的工具，绝不留"注册了一半"的状态；
- 加一个工具 = 写 `lib/<name>.js` + 在 `index.js` 的 `MODULES` 登记一行 + 写测试。

**沙箱验收判据**（本机实测过）：干净 profile 里启动后日志出现
`[dsh-toolbox] 已注册 10 个工具：…` 且 **stderr 零告警**。

## 已知边界

- 不做网络请求、不读写文件、不执行代码（`calculator` 自写解析器，`regex` 只跑 JavaScript 正则且带 ReDoS 门禁）。
- `schema` 是**子集**实现：不支持的关键字会被**报出来**（`schemaIssues`）而不是忽略。
- 十把工具都在**确定性**范围内；涉及抓取/解析自由文本的活请交给专门的联网工具。

## 许可

MIT © 2026 qlheric
