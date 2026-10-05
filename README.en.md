# dsh-toolbox

**Ten zero-dependency deterministic tools in one package** for DeepSeek Harness (dsh): JSON query, math evaluation, encoding & hashing, text diff, time conversion, CSV, regex, statistics, Markdown, JSON Schema.

Install once — ten tools land in the model's tool surface. No one-plugin-per-small-tool.

- Core: **dsh 0.2.0-rc.2** (verified on `DSH Desktop v2.0.17`)
- Runtime dependencies: **none** (hashing uses `node:crypto`)
- Build step: **none** (plain ESM)
- License: MIT

## Why

While coding or analysing data, a model constantly needs to *compute* something: pull one field out of JSON, diff two texts, convert a timestamp into a timezone, take percentiles of a column, validate a JSON Schema.

Left alone it either estimates (and gets it wrong) or writes a throwaway script (slow, messy, irreproducible). dsh-toolbox turns those jobs into ten deterministic tools: same input, same output — computed locally, no network, no workspace reads.

## Install

```bash
dsh plugin --profile <your-profile> add github:qlheric/dsh-toolbox
```

Restart dsh; the tools appear as `json`, `calculator`, `encoding`, `diff`, `time`, `csv`, `regex`, `stat`, `markdown`, `schema`.

> **Desktop (Electron) note**: the `desktop` profile is owned by the Electron app (the CLI refuses `--profile desktop`), so there you write `dsh.profile.bundles` in `package.json` and install with pnpm — that is how it is installed on this machine. Every other profile can use the command above; the CLI reconciles bundles for you.
> Not published to npm yet — use the GitHub source above.

## Tools

| Tool | Actions | Contract highlights |
|---|---|---|
| `json` | `get` `keys` `type` `validate` `format` | paths: `$`, `.a.b`, `['key']`, `[index]` (negative ok), `[*]` wildcard; a failed lookup **returns the reason instead of throwing**; `validate` reports line/column |
| `calculator` | expression evaluation | **no `eval`**; identifiers must match a whitelist of functions/constants; right-associative `^`; non-finite results are an error |
| `encoding` | `encode` `decode` `hash` `uuid` | base64 / base64url / url / hex; md5…sha512; hex decode validates length and alphabet |
| `diff` | `text` `json` `csv` | unified diff with `@@` hunks and context; JSON diff down to paths (add/remove/change); above `maxLines` it degrades to prefix/suffix + block replace instead of hanging |
| `time` | `now` `convert` `add` `diff` | all arithmetic in UTC, timezone affects presentation only; `add` clamps to month end (Jan 31 + 1 month = Feb 28) |
| `csv` | `parse` `query` `stats` `summarize` `to_markdown` | RFC 4180 state machine; quotes may contain commas/newlines/`""`; BOM ignored; `tab` supported |
| `regex` | `test` `find` `replace` `explain` | **static ReDoS screening** (nested quantifiers / overlapping alternation → low…high); `high` plus >4KB input is **refused**; caps: pattern 16KB, input 64KB |
| `stat` | `describe` `percentile` `frequency` `correlation` | Neumaier-compensated sum, Welford variance, population/sample switch, explicit `defined=false` on zero variance |
| `markdown` | `headings` `toc` `table` `to_text` `stats` | GFM anchors (CJK preserved); heading scan skips fenced code; HTML `<table>` converts to GFM too |
| `schema` | `validate` `paths` `explain` `normalize` | JSON Schema subset incl. local `$ref`; **unsupported keywords are never silently ignored**; `normalize` never mutates input and never coerces types |

## Design choices

1. **Determinism first** — everything is pure computation: no network, no temp files, no "it depends". Easy to assert on.
2. **Failures explain themselves** — a missing JSON key reports "no such key"; a ReDoS-risky regex is **refused with a reason** instead of gambling with the host process.
3. **Contracts live in the descriptions** — limits, units and timezone semantics are stated up front so the model can predict behaviour instead of probing.
4. **One package, not ten** — one mount point, one compatibility declaration, one upgrade.

## Compatibility

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "compatibility": { "dsh": ">=0.2.0-rc.2 <0.3.0", "dshReleases": { "0.2.0-rc.2": "compatible" }, "profiles": ["web", "desktop"] }
}
```

Parameter schemas stick to the vocabulary rc.2 accepts (`type` / `required` (true only) / `description` / `default` / `enum` / `items`), and a test enforces that.

## Development

```bash
node --test          # 61 tests, all green
```

- `lib/<tool>.js` exports a `spec` plus pure helpers (easy to unit-test);
- `index.js` is the only mount point; if any registration fails it **rolls back in reverse order** rather than leaving a half-registered plugin;
- adding a tool = one `lib/<name>.js`, one line in `MODULES`, one test file.

**Sandbox acceptance** (verified here): in a clean profile the boot log shows
`[dsh-toolbox] 已注册 10 个工具：…` with an **empty stderr**.

## Boundaries

- No network, no filesystem, no code execution.
- `schema` is a **subset**: unsupported keywords are surfaced (`schemaIssues`), not ignored.
- Free-text scraping/parsing belongs to dedicated web tools, not here.

## License

MIT © 2026 qlheric
