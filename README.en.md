# dsh-toolbox

Ten tools in one dsh plugin: `json` `calculator` `encoding` `diff` `time` `csv` `regex` `stat` `markdown` `schema`.

All local, all pure: no network, no workspace reads, no eval of your code. Same input, same output, so tests can actually assert things. Zero runtime deps, zero build (plain ESM).

The reason this exists is mundane: while working, a model constantly needs to pull one field out of JSON, diff two texts, convert a timestamp, take percentiles of a column — and either guesses (wrong) or writes a throwaway script (slow, and next time it writes it again).

## Install

```
dsh plugin --profile <your-profile> add github:qlheric/dsh-toolbox
```

Restart dsh afterwards. Not on npm yet — skip `npm install`.

The `desktop` profile on the Electron app refuses this command, so there you edit `dsh.profile.bundles` in `package.json` and install with pnpm, which is how it is installed here.

## Tools

| tool | what it does |
|---|---|
| `json` | path lookup (`$`, `.a.b`, `['key']`, `[index]` incl. negative, `[*]` wildcard) + keys / type / validate / format |
| `calculator` | expression evaluation |
| `encoding` | base64 / base64url / url / hex, md5…sha512, uuid |
| `diff` | unified diff, JSON path-level diff, CSV row diff |
| `time` | now / convert / add / diff |
| `csv` | RFC 4180 parsing, column queries, numeric summaries, GFM tables |
| `regex` | test / find / replace / explain |
| `stat` | describe, percentiles, frequency, Pearson/Spearman |
| `markdown` | headings, TOC, table normalisation, strip markup, counts |
| `schema` | JSON Schema subset validation (local `$ref` supported) |

Limits, units and timezone semantics live in the tool descriptions, so the model can read them before calling instead of probing.

## Choices worth explaining

**`calculator` has no `eval`.** Hand-written parser; identifiers must match a whitelist of functions and constants.

**`regex` screens the pattern first.** Nested quantifiers like `(a+)+` get a risk level; a `high` verdict plus more than 4KB of input is refused outright. Better an error than a catastrophic backtrack on the host process.

**`schema` reports unknown keywords** (`schemaIssues`) instead of pretending not to see them — silent ignoring is what burns people.

**Failures explain themselves.** A missing JSON key says "no such key" rather than throwing a stack trace.

**Timezones are presentation only.** `time` computes in UTC; `add` clamps to month end (Jan 31 + 1 month = Feb 28).

## Development

```
node --test      # 61 tests
```

One file per tool (`lib/<name>.js`) exporting a `spec` plus pure helpers. `index.js` is the only mount point and **rolls back in reverse order** if a registration fails, so you never get a half-installed plugin.

Adding a tool = one file + one line in `MODULES` + a test.

Parameter schemas stick to the vocabulary dsh 0.2.0-rc.2 accepts (`required` may only be `true`); a test enforces that.

## Not doing

No network, no filesystem, no code execution. `schema` is a subset. Use another plugin for scraping.

## License

MIT
