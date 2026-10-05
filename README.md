# dsh-toolbox

dsh 的工具箱插件。装上就有十个工具：`json` `calculator` `encoding` `diff` `time` `csv` `regex` `stat` `markdown` `schema`。

全是本地算的纯函数：不联网、不碰工作区、不跑你的代码。同样的输入永远同样的输出，写断言不用碰运气。零运行时依赖、零构建，纯 ESM。

起因很土：模型干活时老要"掏个 JSON 字段、比两段文本、换算个时区、给一列数字算分位"，要么心算（会错），要么临时糊个脚本（慢，下次还得重来）。

## 装

```
dsh plugin --profile <你的 profile> add github:qlheric/dsh-toolbox
```

装完重启 dsh。npm 上还没有，别用 `npm install`。

Electron 桌面端的 `desktop` profile 不认这条命令（CLI 会拒绝接管），那边只能自己改 `package.json` 的 `dsh.profile.bundles`，再用 pnpm 装 —— 本机就是这么装的。

## 十个工具

| 工具 | 能干啥 |
|---|---|
| `json` | 按路径取值：`$`、`.a.b`、`['键']`、`[下标]`（负数也行）、`[*]` 通配；还有 keys / type / validate / format |
| `calculator` | 算式求值 |
| `encoding` | base64 / base64url / url / hex 互转，md5~sha512，uuid |
| `diff` | unified diff、JSON 路径级差异、CSV 逐行差异 |
| `time` | now / convert / add / diff |
| `csv` | RFC 4180 解析、按列查、数值列统计、转 GFM 表格 |
| `regex` | test / find / replace / explain |
| `stat` | 描述统计、分位、频数、Pearson/Spearman |
| `markdown` | 标题、目录、表格规范、去标记、字数 |
| `schema` | JSON Schema 子集校验（支持本地 `$ref`） |

上限、单位、时区语义这些细节都写在工具描述里，模型调用前就能看明白，不用试出来。

## 几处刻意的地方

**`calculator` 不用 `eval`。** 自己写的解析器，标识符必须命中白名单里的函数和常量。

**`regex` 先体检再跑。** `(a+)+` 这类嵌套量词会给一个风险等级，判到 high 且输入超过 4KB 就直接不跑。宁可报错，也不让宿主去赌灾难性回溯。

**`schema` 遇到不认识的关键字会报出来**（`schemaIssues`），不装作没看见 —— 静默忽略最坑人。

**失败说人话。** `json` 取不到键就告诉你"没有这个键"，不是甩个栈出来。

**时区只影响呈现。** `time` 内部一律按 UTC 算；`add` 加减月份按月末钳制（1-31 加一个月 = 2-28）。

## 开发

```
node --test      # 61 个用例
```

每个工具一个文件（`lib/<名字>.js`），导出 `spec` 和纯函数，方便单测。`index.js` 是唯一入口，注册失败会**逆序回滚**，不会留个装了一半的插件。

加工具 = 写一个文件 + 在 `index.js` 的 `MODULES` 加一行 + 补测试。

参数 schema 只用 dsh 0.2.0-rc.2 认的字段（`required` 只能是 `true`），有测试盯着这条，别改坏。

## 不做的

不联网、不读写文件、不执行代码。`schema` 是子集实现。抓网页那类事请找别的插件。

## 许可

MIT
