---
name: save-images
description: Save all images from a web page using Playwright CLI. Network-first architecture captures real image requests via page.on("response"), DOM only drives scroll/pagination/thumbnail clicks. Handles SPA hash routing, content-based deduplication, 403 retries, and Windows shell escaping.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(node:*) Bash(ts-node:*) Bash(cd:*) Bash(ls:*) Bash(echo:*) Bash(rm:*) Bash(mkdir:*) Bash(npm:*)
---

# Save Images from Web Page (Network-First)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Node.js side (run-code context)                     │
│  ★ page.on("response") — captures ALL image requests │
│  ★ page.evaluate() — only drives DOM interaction     │
│  ★ page.waitForLoadState("networkidle")              │
│  ★ page.waitForTimeout()                             │
├──────────────────────────────────────────────────────┤
│  Browser side (page.evaluate)                        │
│  ★ inject hash (#wallpaper)                          │
│  ★ scroll sections + full page                       │
│  ★ click pagination (next/prev)                      │
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
- 15+ seconds without new `page.on("response")` image capture
- `document.body.scrollHeight` stable
- Next-page button not clickable
- 4 consecutive stable rounds

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

CDN filenames contain content hashes (e.g., `870_1440x2560_fcdf70aa.jpg`). Same filename = same content. Simply skip if file exists:

```typescript
if (fs.existsSync(dest)) {
    process.stdout.write(`  [SKIP] ${filename}\n`);
    return;
}
```

No more `_1`, `_2` suffixes. No need for MD5 hash comparison.

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

### 8. Environment Configuration (.env)

```env
BASE_ORIGIN=https://re.bluepoch.com
PAGE_PATH=/home/detail.html
SESSION_NAME=bluepoch
IMAGES_DIR=images
BATCH_SIZE=4
```

**Pitfall**: `#` is a comment character in `.env`. Never put `PAGE_HASH=#wallpaper` — it reads as empty. Keep hash in code.

### 9. 403 Retry with Browser Headers

CDN rejects requests lacking proper headers:

```typescript
// First attempt: basic headers
headers: { "User-Agent": UA, "Referer": referer, "Cookie": cookies }

// 403 → retry with full browser-mimicking headers
headers: {
    ...basic,
    "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
}
```

Extract cookies from browser session: `playwright-cli cookie-list`

### 10. Image Collection Pipeline

```
page.on("response")  ──→  networkImageSet (real-time)
                              │
page.evaluate()      ──→  DOM interactions only
  ├─ inject hash              (scroll, click, paginate)
  ├─ scroll sections
  ├─ click pagination
  ├─ click thumbnails
  └─ stability loop
                              │
                    ┌─────────┘
                    ▼
              Final merge + filter
              ├─ Remove data:/blob: URLs
              ├─ Remove .svg files
              ├─ Remove known UI icon filenames
              └─ Deduplicate by filename
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
| 8 | `uniqueFilename` creates duplicates | `_1`, `_2` files with same content | Skip by filename: `fs.existsSync` → skip |

## File Structure

```
.env                          # Configuration
.playwright/config.json       # Chrome launch + viewport
src/
├── config.ts                 # .env constants & shared configuration
├── download.ts               # HTTP download, cookie cache, URL utilities
├── scraper.ts                # Browser script (run-code) + network URL extraction
└── main.ts                   # Orchestration (pwc, main flow, summary)
images/                       # Output directory
__run_script.js               # Temp: generated run-code (auto-cleaned)
```
