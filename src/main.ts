import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  PAGE_URL,
  IMAGES_DIR,
  SESSION,
  BATCH_SIZE,
  PLAYWRIGHT_CONFIG,
  IMAGE_EXTENSIONS,
} from "./config";
import {
  getCookieHeader,
  downloadBatch,
  classifyOutcomes,
} from "./download";
import type { DownloadOutcome, DownloadSummary } from "./download";
import { buildRunCodeScript, extractNetworkImageUrls } from "./scraper";

// ── Playwright CLI wrapper ─────────────────────────────────────────

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

// ── summary ────────────────────────────────────────────────────────

function printSummary(summary: DownloadSummary) {
  console.log("\n========================================");
  console.log("           DOWNLOAD SUMMARY");
  console.log("========================================");
  console.log(`  Total images found : ${summary.total}`);
  console.log(`  Successfully saved : ${summary.ok}`);
  console.log(`  Skipped (existing) : ${summary.skipped}`);
  console.log(`  Failed             : ${summary.failed}`);

  if (summary.failures.length > 0) {
    console.log("\n  Failed URLs:");
    for (const f of summary.failures) {
      console.log(`    - ${f.url}`);
      console.log(`      Reason: ${f.reason}`);
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
  const networkUrls = extractNetworkImageUrls(pwc);
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
    printSummary({ ok: 0, skipped: 0, failed: 0, total: 0, failures: [] });
    return;
  }

  // 6. Cache cookies for download
  console.log("5. Extracting cookies...");
  getCookieHeader(pwc);

  // 7. Download all images
  console.log("6. Downloading images...");
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const outcomes = await downloadBatch(
    allUrls,
    IMAGES_DIR,
    BATCH_SIZE,
    (o: DownloadOutcome) => {
      if (o.kind === "ok") process.stdout.write(`  [OK] ${o.filename}\n`);
      else if (o.kind === "skipped") process.stdout.write(`  [SKIP] ${o.filename}\n`);
      else process.stderr.write(`  [FAIL] ${o.filename}: ${o.reason}\n`);
    },
  );

  // 8. Print summary (browser stays open per requirement #14)
  const summary = classifyOutcomes(outcomes);
  printSummary(summary);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
