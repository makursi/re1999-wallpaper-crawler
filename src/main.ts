import type { DownloadSummary } from "./download";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import {
  BATCH_SIZE,
  IMAGES_DIR,
  LOG_DIR,
  PAGE_URL,
  PLAYWRIGHT_CONFIG,
  SESSION,
} from "./config";
import { classifyOutcomes, downloadBatch, extractCookies } from "./download";
import { createLogger } from "./logger";
import { buildRunCodeScript } from "./scraper";

// ── Playwright CLI wrapper ─────────────────────────────────────────

function pwc(args: string, timeoutSec = 300): string {
  return execSync(`npx playwright-cli -s=${SESSION} ${args}`, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutSec * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
}

// ── summary ────────────────────────────────────────────────────────

function printSummary(
  logger: ReturnType<typeof createLogger>,
  summary: DownloadSummary,
) {
  logger.info("========================================");
  logger.info("           DOWNLOAD SUMMARY");
  logger.info("========================================");
  logger.info(`  Total images found : ${summary.total}`);
  logger.info(`  Successfully saved : ${summary.ok}`);
  logger.info(`  Skipped (existing) : ${summary.skipped}`);
  logger.info(`  Failed             : ${summary.failed}`);

  if (summary.failures.length > 0) {
    logger.info("  Failed URLs:");
    for (const f of summary.failures) {
      logger.info(`    - ${f.url}`);
      logger.info(`      Reason: ${f.reason}`);
    }
  }

  if (fs.existsSync(IMAGES_DIR)) {
    const totalSize = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /\.(?:png|jpe?g|webp|gif)$/i.test(f))
      .reduce((s, f) => s + fs.statSync(path.join(IMAGES_DIR, f)).size, 0);
    const mb = (totalSize / 1024 / 1024).toFixed(1);
    logger.info(`  Total size on disk  : ${mb} MB`);
  }
  logger.info("========================================");
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const logger = createLogger(LOG_DIR);

  // 0. Clean slate
  logger.info("0. Preparing fresh browser session...");
  try {
    pwc("close-all", 10);
  } catch {}
  try {
    pwc("delete-data", 10);
  } catch {}
  logger.info("   Session cleared.");

  // 1. Open browser with real Chrome, 2560x1440 window, persistent
  logger.info("1. Opening browser...");
  const configPath = path.resolve(__dirname, "..", PLAYWRIGHT_CONFIG);
  pwc(`open --persistent --config=${configPath}`);

  // Navigate to the page and wait for it to load
  logger.info("1b. Navigating to wallpaper page...");
  pwc(`goto ${PAGE_URL}`);
  try {
    pwc("wait-for load", 30);
  } catch {}

  // 2. Run comprehensive image discovery script
  logger.info("2. Running image discovery (scroll + thumbnails)...");
  logger.info("   (this may take several minutes)");

  // Write run-code script to temp file, load via --filename.
  // This avoids Windows cmd.exe escaping issues with multi-line strings and # hashes.
  const runScript = buildRunCodeScript();
  const scriptFile = path.resolve(__dirname, "..", "__run_script.js");
  fs.writeFileSync(scriptFile, runScript, "utf8");

  try {
    const runOutput = execSync(
      `npx playwright-cli -s=${SESSION} run-code --filename="${scriptFile}"`,
      {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 600_000,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    // Log run-code output line by line for diagnostics
    for (const line of runOutput.trim().split("\n")) {
      logger.info({ phase: "run-code" }, line.trim());
    }
  } catch (err: unknown) {
    const execErr = err as {
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    logger.error({ err: execErr.message }, "run-code execution failed");
    if (execErr.stdout != null) {
      for (const line of execErr.stdout.trim().split("\n")) {
        logger.info({ phase: "run-code" }, line.trim());
      }
    }
    if (execErr.stderr != null) {
      for (const line of execErr.stderr.trim().split("\n")) {
        logger.warn({ phase: "run-code" }, line.trim());
      }
    }
  }
  try {
    fs.unlinkSync(scriptFile);
  } catch {}

  // 3. Extract URLs from browser (merged network + DOM from run-code)
  logger.info("3. Extracting image URLs from browser...");

  const rawJson = execSync(
    `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpUrls || [])"`,
    {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    },
  ).trim();

  let allUrls: string[];
  try {
    const first: unknown = JSON.parse(rawJson);
    allUrls =
      typeof first === "string"
        ? (JSON.parse(first) as string[])
        : (first as string[]);
  } catch {
    logger.error("Failed to parse URLs from browser.");
    allUrls = [];
  }
  logger.info(`   Total unique images: ${allUrls.length}`);

  // 3b. Extract run-code diagnostic log
  try {
    const rawLog = execSync(
      `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpLog || [])"`,
      {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ).trim();
    const logEntries: unknown = JSON.parse(rawLog);
    const entries = (
      Array.isArray(logEntries)
        ? logEntries
        : typeof logEntries === "string"
          ? JSON.parse(logEntries)
          : []
    ) as Array<{ t: number; msg: string }>;
    for (const entry of entries) {
      logger.info({ phase: "run-code" }, entry.msg);
    }
  } catch {
    logger.warn("Failed to extract run-code diagnostic log.");
  }

  if (allUrls.length === 0) {
    logger.warn("No images found. The page structure may have changed.");
    printSummary(logger, {
      ok: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      failures: [],
    });
    return;
  }

  // 4. Extract cookies for download
  logger.info("4. Extracting cookies...");
  extractCookies(pwc);

  // 5. Download all images
  logger.info("5. Downloading images...");
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const outcomes = await downloadBatch(allUrls, IMAGES_DIR, BATCH_SIZE, logger);

  // 6. Print summary
  const summary = classifyOutcomes(outcomes);
  printSummary(logger, summary);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
