import "dotenv/config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";

// ── configuration from .env ────────────────────────────────────────

const BASE_ORIGIN = process.env.BASE_ORIGIN || "https://re.bluepoch.com";
const PAGE_PATH = process.env.PAGE_PATH || "/home/detail.html";
const PAGE_URL = `${BASE_ORIGIN}${PAGE_PATH}`;
// Hash is page logic, not env config (# is comment char in .env)
const PAGE_HASH = "#wallpaper";
const IMAGES_DIR = path.resolve(
  __dirname,
  "..",
  process.env.IMAGES_DIR || "images",
);
const SESSION = process.env.SESSION_NAME || "bluepoch";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "4", 10);
const PLAYWRIGHT_CONFIG =
  process.env.PLAYWRIGHT_CONFIG || ".playwright/config.json";
function pwc(args: string, timeoutSec = 300): string {
  return execSync(`npx playwright-cli -s=${SESSION} ${args}`, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutSec * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── cookie extraction ──────────────────────────────────────────────

let _cachedCookieHeader: string | null = null;

function getCookieHeader(): string {
  if (_cachedCookieHeader) return _cachedCookieHeader;
  try {
    const raw = pwc("cookie-list", 15);
    const cookies: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("─"))
        continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        cookies.push(`${parts[0]}=${parts[1]}`);
      }
    }
    _cachedCookieHeader = cookies.join("; ");
    return _cachedCookieHeader;
  } catch {
    return "";
  }
}

// ── download with proper headers ───────────────────────────────────

interface DownloadResult {
  url: string;
  filename: string;
  success: boolean;
  error?: string;
}

const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function getExtFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0].split("#")[0];
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot === -1) return "";
  const ext = withoutQuery.substring(lastDot).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : "";
}

function getFilenameFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0].split("#")[0];
  const segments = withoutQuery.split("/");
  let raw = segments[segments.length - 1] || "image";
  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = raw.substring(dotIdx).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) return raw;
  }
  // No recognized extension — leave as-is
  return raw;
}

function uniqueFilename(dir: string, filename: string): string {
  if (!fs.existsSync(path.join(dir, filename))) return filename;

  const extIdx = filename.lastIndexOf(".");
  const base = extIdx !== -1 ? filename.substring(0, extIdx) : filename;
  const ext = extIdx !== -1 ? filename.substring(extIdx) : "";

  let counter = 1;
  let candidate: string;
  do {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  } while (fs.existsSync(path.join(dir, candidate)));

  return candidate;
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function downloadFile(
  url: string,
  dest: string,
  referer: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cookieHeader = getCookieHeader();
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Referer: referer,
    };
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const doRequest = (retryWithExtraHeaders: boolean) => {
      const opts = {
        headers: {
          ...headers,
          ...(retryWithExtraHeaders
            ? {
                Accept:
                  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
              }
            : {}),
        },
      };

      const file = fs.createWriteStream(dest);
      const proto = url.startsWith("https") ? https : http;
      const req = proto.get(url, opts, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return downloadFile(res.headers.location, dest, referer).then(
            resolve,
            reject,
          );
        }
        if (res.statusCode === 403 && !retryWithExtraHeaders) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return doRequest(true);
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          try {
            fs.unlinkSync(dest);
          } catch {}
          reject(err);
        });
      });
      req.on("error", (err) => {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {}
        reject(err);
      });
      req.end();
    };

    doRequest(false);
  });
}

// ── network request image extraction ───────────────────────────────

function extractNetworkImageUrls(): string[] {
  try {
    const raw = pwc("requests", 30);
    const urls = new Set<string>();
    // Match image URLs in the requests output (various formats)
    const patterns = [
      /"url"\s*:\s*"([^"]+\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?[^"]*)?)"/gi,
      /https?:\/\/[^\s"'()<>]+\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?[^\s"'()<>]*)?/gi,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(raw)) !== null) {
        urls.add(m[1] || m[0]);
      }
    }
    return [...urls];
  } catch {
    return [];
  }
}

// ── build run-code script ──────────────────────────────────────────

function buildRunCodeScript(): string {
  // Network-first architecture:
  // - page.on("response") captures ALL image requests (Node.js side)
  // - page.evaluate() only drives DOM interaction: hash, scroll, pagination, click
  // - Stop condition: 15s no new image + stable scrollHeight + no next page
  return `async (page) => {
    // ================================================
    // Network listener (Node.js side — runs throughout)
    // ================================================
    const networkImages = new Set();
    let lastImageTime = Date.now();

    const onResponse = (response) => {
      const ct = response.headers()["content-type"] || "";
      if (ct.includes("image/")) {
        const url = response.url();
        const prev = networkImages.size;
        networkImages.add(url);
        if (networkImages.size > prev) {
          lastImageTime = Date.now();
        }
      }
    };
    page.on("response", onResponse);

    // ================================================
    // DOM helpers (browser side via page.evaluate)
    // ================================================

    async function injectHash() {
      await page.evaluate((hash) => {
        if (hash && location.hash !== hash) {
          location.hash = hash;
        }
      }, "${PAGE_HASH}");
      await page.waitForTimeout(4000);
      console.log("[hash] current URL: " + page.url());
    }

    async function scrollPage() {
      await page.evaluate(async () => {
        // Scroll wallpaper sections
        const lists = document.querySelectorAll(".papermask-mid-list");
        for (const list of lists) {
          list.scrollIntoView({ behavior: "instant", block: "center" });
          await new Promise(r => setTimeout(r, 500));
          const sh = list.scrollHeight;
          for (let y = 0; y < sh; y += 300) {
            list.scrollBy(0, 300);
            await new Promise(r => setTimeout(r, 300));
          }
        }
        // Full page scroll
        const total = document.body.scrollHeight;
        for (let y = 0; y < total; y += 400) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 300));
        }
        window.scrollTo(0, 0);
      });
      // Wait for network to settle after scrolling
      try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch(e) {}
    }

    async function clickNextPage() {
      return await page.evaluate(() => {
        const btn = document.querySelector('.newsmask-bottom-page[src*="next"]');
        if (!btn || btn.offsetParent === null) return false;
        btn.click();
        return true;
      });
    }

    async function goBackToFirstPage() {
      for (let i = 0; i < 10; i++) {
        const clicked = await page.evaluate(() => {
          const btn = document.querySelector('.newsmask-bottom-page[src*="pre"]');
          if (!btn || btn.offsetParent === null) return false;
          btn.click();
          return true;
        });
        if (!clicked) break;
        await page.waitForTimeout(1000);
      }
    }

    async function clickAllThumbnails() {
      const count = await page.evaluate(() => {
        return document.querySelectorAll(".holder-img").length;
      });
      console.log("[thumbnails] " + count);

      for (let i = 0; i < count; i++) {
        try {
          await page.evaluate(async (idx) => {
            const thumbs = document.querySelectorAll(".holder-img");
            if (idx >= thumbs.length) return;
            thumbs[idx].scrollIntoView({ behavior: "instant", block: "center" });
            await new Promise(r => setTimeout(r, 300));
            thumbs[idx].click();
            await new Promise(r => setTimeout(r, 1500));
            const zoom = document.querySelector("#papermaskDetailTop-zoom");
            if (zoom && !zoom.complete) {
              await new Promise(r => { zoom.onload = r; setTimeout(r, 3000); });
            }
            const close = document.querySelector(".papermaskDetailClose");
            if (close) { close.click(); await new Promise(r => setTimeout(r, 300)); }
          }, i);
          try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch(e) {}
        } catch(e) {}
      }
    }

    function hasNextPage() {
      return page.evaluate(() => {
        const btn = document.querySelector('.newsmask-bottom-page[src*="next"]');
        return !!(btn && btn.offsetParent !== null);
      });
    }

    function getScrollHeight() {
      return page.evaluate(() => document.body.scrollHeight);
    }

    // ================================================
    // Main discovery flow
    // ================================================

    // Step 1: Inject hash + wait for SPA
    console.log("[run-code] starting on: " + page.url());
    await injectHash();
    await page.waitForTimeout(3000);

    // Step 2: Refresh to capture initial images via network listener
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await injectHash();
    await page.waitForTimeout(2000);
    console.log("[run-code] reloaded, now on: " + page.url());

    // Step 3: Scroll through all pages to trigger lazy loading
    for (let pageIdx = 0; pageIdx < 10; pageIdx++) {
      await scrollPage();
      const clicked = await clickNextPage();
      if (!clicked) break;
      await page.waitForTimeout(2000);
      try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch(e) {}
    }

    // Step 4: Go back to first page, scroll again
    await goBackToFirstPage();
    await scrollPage();

    // Step 5: Click thumbnails (triggers high-res image loads)
    await clickAllThumbnails();

    // Step 6: Final scroll pass
    await scrollPage();

    // Step 7: Stability loop
    // Condition: 15s without new image AND stable scrollHeight AND no next page
    let stableRounds = 0;
    let prevSH = 0;
    console.log("[stability] waiting for image requests to stop...");
    while (stableRounds < 4) {
      await page.waitForTimeout(5000);
      const elapsed = (Date.now() - lastImageTime) / 1000;
      const sh = await getScrollHeight();
      const next = await hasNextPage();
      console.log("[stability] " + elapsed.toFixed(0) + "s idle, sh=" + sh + ", next=" + next + ", images=" + networkImages.size);

      if (elapsed > 15 && sh === prevSH && !next) {
        stableRounds++;
      } else {
        stableRounds = 0;
        // Keep scrolling to trigger more lazy loads if needed
        if (elapsed < 15) {
          await page.evaluate(() => window.scrollBy(0, 500));
        }
      }
      prevSH = sh;

      if (stableRounds >= 4) {
        console.log("[stability] converged after " + elapsed.toFixed(0) + "s");
        break;
      }
    }

    // ================================================
    // Final collection
    // ================================================
    page.removeListener("response", onResponse);

    // Get DOM images for reporting
    const domUrls = await page.evaluate(() => {
      const urls = new Set();
      document.querySelectorAll("img").forEach(img => {
        if (img.src && !img.src.startsWith("data:") && !img.src.startsWith("blob:")) {
          urls.add(img.src);
        }
      });
      return [...urls];
    });

    // Filter helpers (apply same filter as before)
    const iconNames = ["pre.png","next.png","star.png","hide.png","share.png",
      "menuc.png","menu.png","v2c.png","b.png","s.png","a.png","d.png",
      "c.png","pc.png","z.png","log.png","logo.png","wx.png","age.png",
      "ageword.png","agewordm.png","cha.png","v2.webp","v2c.png"];

    function shouldKeep(url) {
      const lower = url.toLowerCase();
      if (url.startsWith("data:") || url.startsWith("blob:")) return false;
      if (lower.indexOf(".svg") !== -1) return false;
      const filename = lower.split("/").pop().split("?")[0];
      if (iconNames.indexOf(filename) !== -1) return false;
      return true;
    }

    // Merge network + DOM, apply filter
    const allUrls = new Set();
    for (const u of networkImages) if (shouldKeep(u)) allUrls.add(u);
    for (const u of domUrls) if (shouldKeep(u)) allUrls.add(u);

    const finalUrls = [...allUrls];
    console.log("[final] DOM=" + domUrls.length + " Network=" + networkImages.size + " Combined=" + finalUrls.length);
    await page.evaluate((urls) => { window.__wpUrls = urls; }, finalUrls);
  }`;
}

// ── summary ────────────────────────────────────────────────────────

function printSummary(
  totalFound: number,
  success: DownloadResult[],
  failed: DownloadResult[],
  skipped: number,
) {
  console.log("\n========================================");
  console.log("           DOWNLOAD SUMMARY");
  console.log("========================================");
  console.log(`  Total images found : ${totalFound}`);
  console.log(`  Successfully saved : ${success.length}`);
  console.log(`  Skipped (existing) : ${skipped}`);
  console.log(`  Failed             : ${failed.length}`);

  if (failed.length > 0) {
    console.log("\n  Failed URLs:");
    for (const f of failed) {
      console.log(`    - ${f.url}`);
      if (f.error) console.log(`      Reason: ${f.error}`);
    }
  }

  if (fs.existsSync(IMAGES_DIR)) {
    const totalSize = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) =>
        IMAGE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
      )
      .reduce((s, f) => s + fs.statSync(path.join(IMAGES_DIR, f)).size, 0);
    const mb = (totalSize / 1024 / 1024).toFixed(1);
    console.log(`\n  Total size on disk  : ${mb} MB`);
  }
  console.log("========================================\n");
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  // 0. Clean slate
  console.log("0. Preparing fresh browser session...");
  try {
    pwc("close-all", 10);
  } catch {}
  try {
    pwc("delete-data", 10);
  } catch {}
  console.log("   Session cleared.");

  // 1. Open browser with real Chrome, 2560x1440 window, persistent
  console.log("1. Opening browser...");
  const configPath = path.resolve(__dirname, "..", PLAYWRIGHT_CONFIG);
  pwc(`open --persistent --config=${configPath}`);
  await sleep(2000);

  // Navigate to the page (two-step preserves hash better)
  console.log("1b. Navigating to wallpaper page...");
  pwc(`goto ${PAGE_URL}`);
  await sleep(5000);

  // 2. Run comprehensive image discovery script
  console.log("2. Running image discovery (scroll + thumbnails)...");
  console.log("   (this may take several minutes)");

  // Write run-code script to temp file, load via --filename.
  // This avoids Windows cmd.exe escaping issues with multi-line strings and # hashes.
  const runScript = buildRunCodeScript();
  const scriptFile = path.resolve(__dirname, "..", "__run_script.js");
  fs.writeFileSync(scriptFile, runScript, "utf8");

  try {
    execSync(
      `npx playwright-cli -s=${SESSION} run-code --filename="${scriptFile}"`,
      {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 600_000,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
  } catch (err: any) {
    console.log(`   (run-code error: ${err.message}, proceeding anyway)`);
  }
  try {
    fs.unlinkSync(scriptFile);
  } catch {}

  // 3. Extract URLs from browser
  console.log("3. Extracting image URLs from browser...");
  await sleep(2000);

  const rawJson = execSync(
    `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpUrls || [])"`,
    {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    },
  ).trim();

  let domUrls: string[];
  try {
    const first = JSON.parse(rawJson);
    domUrls = typeof first === "string" ? JSON.parse(first) : first;
  } catch {
    console.error("Failed to parse URLs from browser.");
    domUrls = [];
  }
  console.log(`   DOM images found: ${domUrls.length}`);

  // 4. Also capture network-level image requests
  console.log("4. Extracting network request images...");
  const networkUrls = extractNetworkImageUrls();
  console.log(`   Network images found: ${networkUrls.length}`);

  // 5. Merge & deduplicate
  const allUrlSet = new Set<string>();
  for (const u of domUrls) allUrlSet.add(u);
  for (const u of networkUrls) allUrlSet.add(u);
  const allUrls = [...allUrlSet];
  const totalFound = allUrls.length;
  console.log(`   Total unique images: ${totalFound}`);

  if (allUrls.length === 0) {
    console.log("\nNo images found. The page structure may have changed.");
    printSummary(0, [], [], 0);
    return;
  }

  // 6. Cache cookies for download
  console.log("5. Extracting cookies...");
  getCookieHeader();

  // 7. Download all images
  console.log("6. Downloading images...");
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const successResults: DownloadResult[] = [];
  const failedResults: DownloadResult[] = [];
  let skippedCount = 0;

  for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
    const batch = allUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url): Promise<DownloadResult> => {
        const absUrl = resolveUrl(url, BASE_ORIGIN);
        const filename = getFilenameFromUrl(absUrl);
        const dest = path.join(IMAGES_DIR, filename);

        if (fs.existsSync(dest)) {
          process.stdout.write(`  [SKIP] ${filename}\n`);
          return { url: absUrl, filename, success: false, error: "skipped" };
        }

        try {
          await downloadFile(absUrl, dest, PAGE_URL);
          process.stdout.write(`  [OK] ${filename}\n`);
          return { url: absUrl, filename, success: true };
        } catch (err: any) {
          process.stderr.write(`  [FAIL] ${filename}: ${err.message}\n`);
          return { url: absUrl, filename, success: false, error: err.message };
        }
      }),
    );

    for (const r of results) {
      if (r.error === "skipped") {
        skippedCount++;
      } else if (r.success) successResults.push(r);
      else failedResults.push(r);
    }
  }

  // 8. Print summary (browser stays open per requirement #14)
  printSummary(totalFound, successResults, failedResults, skippedCount);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
