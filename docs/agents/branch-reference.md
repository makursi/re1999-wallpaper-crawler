# Branch reference: packaging, build, Console boot and the Run log

These six lessons used to sit in `AGENTS.md` and load on every turn. Each one only
bites in four kinds of work — **packaging, build, Console boot, or a change to the
Run log** — so they live here, and the pointer in `AGENTS.md` leads with those
triggers. The wording is the wording they had there: nothing was softened in the
move. A new lesson that only those branches need belongs here, not in the
always-loaded file.

The bundling lesson below is now also carried by a check: CI builds the program
and boots it (`pnpm build`, then `pnpm smoke:boot`), so a missing banner fails on
the PR that removes it instead of first on a tag.

## The boot check (`pnpm smoke:boot`)

`scripts/smoke-boot.ts` is the command CI runs after `pnpm build`. It stages the
built tree into a temporary root, starts `server.js` on an OS-assigned port with
the browser suppressed, and drives the program only through the page's own API
with the boot token: `/api/status` must report the version the build injected,
`<data>/instance.json` must name this boot's port, token and pid, and
`/api/exit` must answer `202` and end the process with code 0. A second case
stages the same tree with `run.js` removed and requires the boot refusal, and a
third runs `update.js` against a package with no installation pointer and
requires its Chinese, non-zero refusal.

**What the CI claim covers.** All three entries compile; the check boots the
Console and runs the updater's refusal. `run.js` is compiled but never executed,
so a bundling failure that only `run.js` has stays green.

**What "no network" means.** No `.env`, no browser and no real Run: the staged
tree has no configuration, so the status read never asks the Gallery list. The
boot does make one outbound request — the Console's own courtesy update check,
bounded at three seconds and never fatal — and the check neither silences it nor
pretends it does not happen.

**The blocked-port retry.** `--port 0` lets the OS choose, and on this machine
the dynamic range (1024–15000) includes ports `fetch` refuses (`bad port`), so
the console case retries the whole boot with a fresh port twice before failing.

**What it cannot cover.** The Windows-only surfaces stay manual: the two
launchers, the updater's real folder swap, a `node_modules` junction, and the
manual's rendering.

## The six lessons

### An ESM bundle of CommonJS packages needs `createRequire`

`scripts/build.ts` prepends a banner to both entries:
`const require = createRequire(import.meta.url)`. It is not decoration. esbuild
inlines a CommonJS dependency's `require` as its own shim, and in ESM output that
shim calls a `require` that does not exist — the first bundled CJS package that
requires a builtin kills the program at import. Measured, not guessed: without
the banner the built Console died on `dotenv` (`Dynamic require of "fs" is not
supported`) before it printed a URL, while typecheck, lint and every test passed.
Only booting the artifact catches this class of failure.

### The launcher is ASCII, and the program prints the Chinese

A `.bat` with Chinese text is not reliable on Windows, and `chcp 65001` is not a
universal fix. Measured on a real Chinese Windows 11 in fresh console windows
(936): a UTF-8 no-BOM script shows the line as mojibake; UTF-8 + `chcp 65001`
shows it correctly but only while the file stays BOM-less (and turns cmd's own
messages English); a UTF-8 **BOM** makes the first line run as
`'锘緻echo' 不是内部或外部命令`, so `@echo off` never happens; GBK is correct on
that machine and on no other. So `packaging/启动.bat` and `packaging/更新.bat`
are pure ASCII — `cd`, the two root variables (or the package root and `%*`),
`app\node.exe app\<entry>.js`, and `pause` on both paths (a start's window keeps
its last lines after a clean exit too, #96; a failure keeps its message) — and
every Chinese line
(the window title, the "do not close" line, the Mark-of-the-Web steps, every
updater answer) is Node's, which writes Unicode to the console. Do not add
Chinese to a script, and do not let its line endings be normalized: they are
stored with CRLF, and `.gitattributes` marks `*.bat -text`.

### The user manual is UTF-8 with a BOM, and CRLF

`packaging/使用说明.txt` is the one document a player opens after unzipping, in
Notepad. A BOM is Notepad's one unambiguous "this is UTF-8" signal — without it
the reader uses a heuristic, and a wrong guess is mojibake; CRLF is one line per
line. `.gitattributes` marks `packaging/*.txt -text` so git neither normalizes
nor rewrites those bytes, and the packager copies the file verbatim. Measured on
this machine: Notepad's status bar reports `UTF-8 BOM` and `Windows (CRLF)`, and
the document reads back through UI Automation with no replacement character and
the Chinese intact. `tests/scripts/packaging-docs.test.ts` pins the BOM, the line
endings, the facts the manual must name, and `LICENSE`'s agreement with
`package.json`. Do not let a formatter or an editor "fix" the encoding.

### Git history is LF, the Windows worktree is CRLF

The repository stores LF; `core.autocrlf=true` only makes Windows checkouts
CRLF, and `.gitattributes` (`* text=auto eol=lf`) now pins the worktree to LF so
the formatter, CI and the checkout agree.

**Do not judge line endings from text output.** `git cat-file` runs the smudge
filter when it prints a blob, so `git cat-file blob <sha> | grep -c $'\r'`
reports CRLF for content that is stored as LF — and in this shell `grep -c $'\r'`
silently degrades to counting *lines* (it returns the line count for both CRLF
and LF input). Compare **sizes** instead:

```sh
sha=$(git rev-parse HEAD:core/main.ts)
git cat-file --batch-check='%(objectsize)' <<< "$sha"   # vs wc -c on the file
```

A blob smaller than its file by roughly one byte per line is LF.

### The Run log is written synchronously, and must stay that way

`core/logger.ts` writes the JSONL Run log through `pino.destination({ sync: true })`
on the main thread, with `pino-pretty` as a plain stream rather than a second
`transport` target. That costs one blocking write per record and buys the one
property the log exists for: a transport puts the file sink in a worker thread,
and a worker that stops leaves the process logging into a dead channel while
still exiting 0 — which is how Run `2026-09-15T09-36-50` lost its `run_report`
(ADR 0007). The file sink also keeps the **lower level** of the two sinks,
because pino's multistream writes in level order and has no error isolation: the
record has to reach the file before a console stream that throws can eat it
(pino sorts the streams by level in `add()`, so the order of the array in the
source is decoration, not the mechanism — raising the file's level above the
console's is what would invert it). Do not "optimize" this back into a
transport.

### Git hooks live in `.git/hooks`, and `core.hooksPath` must stay unset

`simple-git-hooks` writes `.git/hooks/*` from the `prepare` script. A leftover
`git config core.hooksPath .githooks` (the removed shell-hook setup) points at a
deleted directory and makes git skip hooks **silently** — clear it with
`git config --unset core.hooksPath`. Verify the hooks actually fire by trying a
commit on `main`: it must be refused.
