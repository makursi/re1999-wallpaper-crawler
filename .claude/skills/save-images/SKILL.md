---
name: save-images
description: Save all images from a web page using Playwright CLI. Network-first architecture captures real image requests via page.on("response"), DOM only drives scroll/pagination/thumbnail clicks. Handles SPA hash routing, content-based deduplication, 403 retries, Windows shell escaping, and structured logging.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(node:*) Bash(ts-node:*) Bash(cd:*) Bash(ls:*) Bash(echo:*) Bash(rm:*) Bash(mkdir:*) Bash(npm:*)
---

# Save Images from Web Page (Network-First)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  pino Logger (dual-write)                            │
│  ★ Terminal: pino-pretty (info↑, colored)            │
│  ★ File: logs/save-wallpapers-{ts}.jsonl (debug↑)    │
├──────────────────────────────────────────────────────┤
│  Node.js side (run-code context)                     │
│  ★ page.on("response") — captures ALL image requests │
│  ★ page.evaluate() — only drives DOM interaction     │
│  ★ page.waitForLoadState("networkidle")              │
│  ★ window.__wpLog — diagnostic log (browser-side array) │
├──────────────────────────────────────────────────────┤
│  Browser side (page.evaluate)                        │
│  ★ inject hash (#wallpaper)                          │
│  ★ scroll sections + full page                       │
│  ★ scroll virtual container (dynamic scrollHeight)    │
│  ★ click thumbnails → high-res modal                 │
│  ★ trigger lazy loading                              │
└──────────────────────────────────────────────────────┘
```

**核心思路**：网络层捕获真实图片请求，DOM 只负责触发行为。即使图片从 DOM 中被卸载（虚拟列表/SPA），网络层已记录。

## Quick Start

```bash
npm run save-wallpapers
```

## Key Design Decisions

### 1. Network-First Capture

```javascript
// ✅ Register BEFORE any page interaction
const networkImages = new Set();
let lastImageTime = Date.now();
page.on("response", (response) => {
    const ct = response.headers()["content-type"] || "";
    if (ct.includes("image/")) {
        networkImages.add(response.url());
        lastImageTime = Date.now();
    }
});

// Then scroll, click, paginate — all image requests captured
await scrollPage();
await clickThumbnails();
```

### 2. Stop Condition (not DOM-based)

Old (broken): poll `extractAllImageUrls()` count until stable → fails because SPA unloads images from DOM.

New (correct):
- 45+ seconds without new `page.on("response")` image capture
- `scrollHeight` (body + all `.papermask-mid-list` virtual containers) stable
- 6 consecutive stable rounds (each round = 5s wait)
- Lightweight stall on virtual containers while `elapsed < 45` to stimulate lazy loading
- `getScrollHeight()` MUST include virtual scroll containers — `document.body.scrollHeight` alone is useless on SPA pages

### 3. Hash Injection for SPA

`#wallpaper` is stripped by Windows CLI → inject in browser:

```javascript
await page.evaluate((hash) => {
    if (hash && location.hash !== hash) {
        location.hash = hash;
    }
}, "#wallpaper");
await page.waitForTimeout(4000);  // wait for SPA re-render
```

### 4. Deduplication: Skip by Filename

CDN filenames contain content hashes (e.g., `870_1440x2560_fcdf70aa.jpg`). Same filename = same content. `downloadOne` returns `{ kind: "skipped" }` without downloading:

```typescript
// downloadOne checks existence before attempting download
if (fs.existsSync(dest)) {
  return { kind: "skipped", url: absUrl, filename };
}
```

Download outcomes use a discriminated union for type-safe handling:

```typescript
export type DownloadOutcome =
  | { kind: "ok"; url: string; filename: string }
  | { kind: "skipped"; url: string; filename: string }
  | { kind: "failed"; url: string; filename: string; reason: string };
```

No `_1`, `_2` suffixes (removed `uniqueFilename` dead code). No MD5 comparison needed.

### 5. Windows Shell Escaping: `--filename`

**Problem**: Multi-line script strings break in cmd.exe (splitting at spaces, `#` treated as comment).

**Failed approaches**:
- `execSync` with inline string → cmd.exe splits multi-line
- `spawnSync` with `shell: true` → same splitting
- `spawnSync` with `shell: false` + `npx.cmd` → `.cmd` files can't be spawned directly
- `bash -c` → bash not available on stock Windows

**Solution**: Write run-code script to temp file, load via `--filename`:

```typescript
fs.writeFileSync(scriptFile, runScript, "utf8");
execSync(`npx playwright-cli -s=${SESSION} run-code --filename="${scriptFile}"`, {
    stdio: "pipe",
    timeout: 600_000,
});
```

**Critical**: The file must contain a plain function expression (NOT `module.exports`):

```javascript
// ✅ Correct
async (page) => {
    await page.evaluate(...);
}

// ❌ Wrong — runs in Node.js context without page
module.exports = async (page) => { ... }
```

### 6. `run-code` Runs in Node.js Context

The `page` object is Playwright Page — browser globals (`window`, `document`) are NOT available directly:

```javascript
// ❌ window is not defined (Node.js context)
window.__wpUrls = finalUrls;

// ✅ Use page.evaluate to access browser globals
await page.evaluate((urls) => { window.__wpUrls = urls; }, finalUrls);
```

### 7. Persistent Chrome with Desktop Viewport

Use `.playwright/config.json`:

```json
{
  "launch": {
    "channel": "chrome",
    "headless": false,
    "args": ["--window-size=1920,1080", "--window-position=0,0"]
  },
  "context": {
    "viewport": null
  }
}
```

`viewport: null` lets the real window size determine layout. SPA correctly detects desktop environment and renders wallpaper content (mobile layout may hide it).

### 8. Environment Configuration (.env + zod)

Runtime values from `.env`, validated at startup with `zod` schema:

```env
BASE_ORIGIN=https://re.bluepoch.com
PAGE_PATH=/home/detail.html
SESSION_NAME=bluepoch
IMAGES_DIR=images
BATCH_SIZE=4
PLAYWRIGHT_CONFIG=.playwright/config.json
LOG_DIR=logs
```

```typescript
// config.ts — startup validation, bad values fail immediately
const configSchema = z.object({
  BASE_ORIGIN: z.string().url(),
  BATCH_SIZE: z.coerce.number().int().positive().max(20).default(4),
  LOG_DIR: z.string().min(1).default("logs"),
  // ...
});
const parsed = configSchema.parse(process.env);
```

**Pitfall**: `#` is a comment character in `.env`. Never put `PAGE_HASH=#wallpaper` — it reads as empty. Keep hash in code.

### 9. 403 Retry with Browser Headers

CDN rejects requests lacking proper headers. Uses `undici` fetch (native Cookie header support):

```typescript
// downloadFile with fetch + 403 retry
async function doRequest(retry: boolean): Promise<void> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Referer: referer,
  };
  const cookie = getCookieHeader();
  if (cookie) headers["Cookie"] = cookie;

  if (retry) {
    // 403 → add full browser-mimicking headers
    Object.assign(headers, {
      "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    });
  }

  const response = await fetch(url, { headers, redirect: "follow" });

  if (response.status === 403 && !retry) return doRequest(true);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}
```

Fetch handles redirects (`redirect: "follow"`) and protocol selection automatically. No more manual `http.get`/`https.get` branching or Promise constructor wrapping.

### 10. Structured Logging (pino) + Run-Code Diagnostic Log

Replaces all `console.log`/`process.stdout.write`/`process.stderr.write` with structured JSON logs.

```
pino Logger
├── Terminal: pino-pretty (colorized, info↑)
└── File: logs/save-wallpapers-{timestamp}.jsonl (debug↑, machine-readable)
```

**Log levels**:
| Level | Usage |
|-------|-------|
| `info` | Pipeline steps, counts, summary |
| `debug` | Per-file download OK/SKIP |
| `warn` | Per-file download FAIL |
| `error` | Fatal errors (run-code crash) |

**Run-code diagnostic log via `window.__wpLog`**:

The run-code script runs in a separate `playwright-cli` process. Its `console.log` calls go to a playwright-cli console log file — not stdout — making them invisible to `main.ts`. Instead, run-code pushes diagnostic messages to `window.__wpLog` (browser-side array) via a helper:

```javascript
// run-discovery.js
async function log(msg) {
  await page.evaluate((m) => {
    (window.__wpLog = window.__wpLog || []).push({ t: Date.now(), msg: m });
  }, msg);
}

// Usage throughout run-discovery.js:
await log("[run-code] starting on: " + page.url());
await log("[pagination] page " + pageIdx);
await log("[final] DOM=150 Network=300 Combined=320");
```

`main.ts` step 3b extracts it alongside `window.__wpUrls`:

```typescript
const rawLog = execSync(
  `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpLog || [])"`,
  { encoding: 'utf8', stdio: 'pipe', timeout: 15_000 },
).trim();

for (const entry of JSON.parse(rawLog)) {
  logger.info({ phase: 'run-code' }, entry.msg);
}
```

**Pitfall**: Do NOT rely on `console.log` inside run-code for diagnostics. playwright-cli's `run-code` echoes the script source to stdout but does NOT forward the Node.js-side `console.log` calls. Browser-side `console.log` (inside `page.evaluate`) goes to a separate console log file (`console-...log`). The `window.__wpLog` pattern is the only reliable way to get diagnostic data from run-code back to `main.ts`.

### 11. Cookie Extraction (Split Responsibility)

`download.ts` exports two separate concerns:

```typescript
// main.ts calls once to extract cookies from Playwright session
export function extractCookies(pwc: (args: string) => string): string

// downloadFile uses internally (no pwc parameter needed)
function getCookieHeader(): string
```

Global mutable cache `_cachedCookieHeader` is now an internal implementation detail, not part of the public API.

### 12. Dynamic ScrollHeight for Virtual Scroll Containers

The wallpaper page uses a virtual scroll container (`.papermask-mid-list`) that dynamically grows `scrollHeight` as content renders. A fixed-loop approach misses content:

Old (broken): `const sh = list.scrollHeight; for (let y = 0; y < sh; y += 300)` — sh locked at initial value.

New (correct): while-loop with stall detection re-reads `scrollHeight` each iteration:

```javascript
let prevSH = 0, stall = 0;
while (stall < 3) {
  list.scrollBy(0, 600);
  await new Promise(r => setTimeout(r, 300));
  const currSH = list.scrollHeight;
  if (currSH > prevSH) { prevSH = currSH; stall = 0; }
  else { stall++; }
}
```

Stall counter (3 consecutive no-growth rounds) acts as the stop condition. This pattern replaces the removed pagination logic — the site has no next/prev buttons; all content loads via scroll-triggered virtual rendering.

### 13. Run-Code Script as Separate File

The 180-line run-code JavaScript was embedded as a TypeScript template string in `scraper.ts` → zero syntax validation, no IDE support.

Now lives at `scripts/run-discovery.js` — can be linted, syntax-checked (`node --check`), and IDE-highlighted. `buildRunCodeScript()` just reads the file and replaces the `__PAGE_HASH__` placeholder:

```typescript
// scraper.ts (11 lines)
export function buildRunCodeScript(): string {
  const scriptFile = path.resolve(__dirname, "..", "scripts", "run-discovery.js");
  const raw = fs.readFileSync(scriptFile, "utf8");
  return raw.replace("__PAGE_HASH__", PAGE_HASH);
}
```

### 14. Image Collection Pipeline

```
page.on("response")  ──→  networkImageSet (real-time)

page.evaluate()      ──→  DOM interactions + diagnostic log
  ├─ inject hash              → log("[hash] ...")
  ├─ scroll containers (dynamic scrollHeight loop)
  ├─ click thumbnails         → log("[thumbnails] ...")
  ├─ stability loop           → log("[stability] ...")
  └─ final merge              → log("[final] ...")
                              │
                    ┌─────────┘
                    ▼
              Final merge + filter
              ├─ Remove data:/blob: URLs
              ├─ Remove .svg files
              ├─ Remove known UI icon filenames
              └─ Deduplicate by filename
                              │
                    ┌─────────┘
                    ▼
              window.__wpUrls  (URL list)
              window.__wpLog   (diagnostic log)
```

## Common Pitfalls

| # | Problem | Symptom | Solution |
|---|---------|---------|----------|
| 1 | `#wallpaper` lost | Page shows wrong content | Inject via `page.evaluate(() => location.hash = "#wallpaper")` |
| 2 | `window is not defined` in run-code | `ReferenceError` | Use `await page.evaluate(...)` |
| 3 | `#` in `.env` is comment | `PAGE_HASH` reads empty | Hardcode hash in TypeScript |
| 4 | cmd.exe splits multi-line script | "too many arguments" error | Write to temp file → `--filename` |
| 5 | `--filename` with `module.exports` | `SyntaxError: Unexpected token` | Use plain function expression |
| 6 | `setViewportSize` removed → mobile layout | No wallpaper content | Use `viewport: null` + `--window-size=1920,1080` |
| 7 | `background-image` scan too broad | Never stabilizes (57 new/round) | Limit to `[class]`, `[id]`, `[style*="background"]` only |
| 8 | `BATCH_SIZE=zero` → silent download failure | `NaN` causes 0 downloads, no error | Zod validates at startup: `z.coerce.number().int().positive()` |
| 9 | `execSync` stdio pipe without using return | run-code output lost, can't diagnose issues | Capture return value and log it (see §10) |
| 10 | `pwc requests` for post-hoc network capture | Only captures ~2 URLs, not useful | Deleted. Trust run-code's `page.on("response")` instead |
| 11 | `goto` + fixed `sleep(5000)` | May not wait long enough on slow networks | Use `pwc("wait-for load", 30)` with timeout |
| 12 | Fixed-loop virtual scroll: `for (y < sh)` with stale `scrollHeight` | Content beyond initial height never loads | Dynamic while-loop with per-iteration `scrollHeight` re-read + stall detection |
| 13 | `resolveUrl` try-catch swallowing errors | Invalid URLs passed silently to fetch | Remove try-catch; let URL constructor throw naturally |
| 14 | `process` / `Buffer` globals in TypeScript | ESLint `node/prefer-global/*` errors | `import process from 'node:process'`, `import { Buffer } from 'node:buffer'` |
| 15 | `console.log` in run-code → invisible to main.ts | Diagnostic output lost during the "172 images" mystery | Use `window.__wpLog` pattern (see §10): push messages via `page.evaluate`, extract in main.ts step 3b |
| 16 | Trailing `;` on `--filename` function expression | `SyntaxError: Unexpected token ';'` | `--filename` expects `async (page) => { ... }` — no trailing semicolon |
| 17 | Fixed timeouts + `networkidle` + silent `catch(e) {}` couple capture to network speed | Image count fluctuates 67~607 across runs | Replace `networkidle` with fixed `waitForTimeout`; stability 15s→45s, 4→6 rounds; `catch(e) {}`→`catch(e) { await log(...) }`; zoom fallback 3s→10s |
| 18 | `getScrollHeight()` only reads `document.body.scrollHeight` (fixed viewport = always 720) | Stability check `sh === prevSH` always true — decorative | Sum body + all `.papermask-mid-list` scrollHeights; embed lightweight stall (`stall<2, iter<10`) on virtual containers in stability loop instead of `window.scrollBy` |

## File Structure

```
.env                          # Runtime config (validated by zod)
.playwright/config.json       # Chrome launch + viewport
eslint.config.mjs             # @antfu/eslint-config
scripts/
  run-discovery.js            # Browser-side discovery script (lintable, separate file)
src/
├── config.ts                 # zod schema + typed config exports (36 lines)
├── logger.ts                 # pino factory, dual-write terminal + file (35 lines)
├── download.ts               # undici fetch + extractCookies + DownloadOutcome + batch (202 lines)
├── scraper.ts                # Script loader (reads run-discovery.js, replaces __PAGE_HASH__) (11 lines)
└── main.ts                   # pwc wrapper + pipeline orchestration + run-code stdout capture (185 lines)
images/                       # Output directory
logs/                         # pino JSON log files (gitignored)
  └── save-wallpapers-{timestamp}.jsonl
__run_script.js               # Temp: generated run-code (auto-cleaned)
```
