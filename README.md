# Read broken CSV files faster

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/farcasteralpha/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/farcasteralpha/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, entered in
[csv-reader-speed-01-run-20261121](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
on [make.fun](https://make.fun).

`solve.js` (dependency-free ES module) exports `run(input)`, which returns
exactly csv-reader 1.0.0's answer `{columns, rows, errors}` for every input
`{text, header}` — including its broken-row policy (BOM, CRLF, stray CRs,
doubled quotes, quote junk, unterminated quotes, short/long rows) — while
reading the text with native scans (`indexOf`, one regex scan per unquoted
field) instead of one character at a time. `main.ts` is the driver the
harness runs: it reads `/input/cases.json`, answers each case with `run`,
and writes `/output/answers.json`.

## Layout

- `solve.js` — the fast parser (ES module, no dependencies)
- `main.ts` — the harness driver (Node 22, V8 incremental marking off)
- `LICENSE` — MIT
