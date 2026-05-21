import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

const IMAGES_DIR = path.resolve(__dirname, '..', 'images');
const BASE_ORIGIN = 'https://re.bluepoch.com';
const PAGE_URL = `${BASE_ORIGIN}/home/detail.html#wallpaper`;

// ── playwright-cli helpers ──────────────────────────────────────────

const SESSION = 'bluepoch';

/** Path to playwright-cli Node.js entry — resolved once. */
let _cliEntryPath: string | null = null;

function getCliEntryPath(): string {
  if (_cliEntryPath) return _cliEntryPath;

  // Search common global install locations
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@playwright', 'cli', 'playwright-cli.js'),
    'C:/nvm4w/nodejs/node_modules/@playwright/cli/playwright-cli.js',
    path.resolve('node_modules', '@playwright', 'cli', 'playwright-cli.js'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      _cliEntryPath = c;
      return c;
    }
  }

  throw new Error(
    'Cannot find @playwright/cli installation. ' +
    'Install with: npm install -g @playwright/cli'
  );
}

function pwc(args: string, timeoutSec = 300): string {
  return execSync(`npx playwright-cli -s=${SESSION} ${args}`, {
    encoding: 'utf8',
    stdio: 'pipe',
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
    const raw = pwc('cookie-list', 15);
    const cookies: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('─')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        cookies.push(`${parts[0]}=${parts[1]}`);
      }
    }
    _cachedCookieHeader = cookies.join('; ');
    return _cachedCookieHeader;
  } catch {
    return '';
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
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function getExtFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0];
  const lastDot = withoutQuery.lastIndexOf('.');
  if (lastDot === -1) return '';
  const ext = withoutQuery.substring(lastDot).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : '';
}

function getFilenameFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0];
  const segments = withoutQuery.split('/');
  let raw = segments[segments.length - 1] || 'image';
  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = raw.substring(dotIdx).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) return raw;
  }
  // No recognized extension — leave as-is
  return raw;
}

function uniqueFilename(dir: string, filename: string): string {
  if (!fs.existsSync(path.join(dir, filename))) return filename;

  const extIdx = filename.lastIndexOf('.');
  const base = extIdx !== -1 ? filename.substring(0, extIdx) : filename;
  const ext = extIdx !== -1 ? filename.substring(extIdx) : '';

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

function downloadFile(url: string, dest: string, referer: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cookieHeader = getCookieHeader();
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Referer: referer,
    };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const doRequest = (retryWithExtraHeaders: boolean) => {
      const opts = {
        headers: {
          ...headers,
          ...(retryWithExtraHeaders
            ? {
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site',
              }
            : {}),
        },
      };

      const file = fs.createWriteStream(dest);
      const proto = url.startsWith('https') ? https : http;
      const req = proto.get(url, opts, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          return downloadFile(res.headers.location, dest, referer).then(resolve, reject);
        }
        if (res.statusCode === 403 && !retryWithExtraHeaders) {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          return doRequest(true);
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { try { fs.unlinkSync(dest); } catch {} reject(err); });
      });
      req.on('error', (err) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
      req.end();
    };

    doRequest(false);
  });
}

// ── network request image extraction ───────────────────────────────

function extractNetworkImageUrls(): string[] {
  try {
    const raw = pwc('requests', 30);
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
  // All browser API calls MUST be inside page.evaluate().
  // run-code runs in Node.js context with `page` as the Playwright Page object.
  const browserCode = `
    async function() {
      var BASE = "${BASE_ORIGIN}";
      var collectedUrls = [];

      function absUrl(url) {
        try { return new URL(url, BASE).href; } catch(e) { return url; }
      }

      function extractAllImageUrls() {
        var urlSet = [];
        var seen = {};

        function add(u) {
          var resolved = absUrl(u);
          if (!seen[resolved]) { seen[resolved] = true; urlSet.push(resolved); }
        }

        // img.src
        var imgs = document.querySelectorAll("img");
        for (var i = 0; i < imgs.length; i++) {
          var src = imgs[i].src;
          if (src && !src.startsWith("data:") && !src.startsWith("blob:")) add(src);
        }

        // data-src / data-original (lazy loading)
        var lazyEls = document.querySelectorAll("[data-src], [data-original]");
        for (var j = 0; j < lazyEls.length; j++) {
          var ds = lazyEls[j].getAttribute("data-src") || lazyEls[j].getAttribute("data-original");
          if (ds && !ds.startsWith("data:") && !ds.startsWith("blob:")) add(ds);
        }

        // background-image
        var all = document.querySelectorAll("*");
        for (var k = 0; k < all.length; k++) {
          var bg = getComputedStyle(all[k]).backgroundImage;
          if (bg && bg !== "none") {
            var m = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
            if (m && m[1] && !m[1].startsWith("data:") && !m[1].startsWith("blob:")) add(m[1]);
          }
        }

        // <picture> <source>
        var sources = document.querySelectorAll("picture source");
        for (var s = 0; s < sources.length; s++) {
          var srcset = sources[s].getAttribute("srcset");
          if (srcset) {
            var parts = srcset.split(",");
            for (var p = 0; p < parts.length; p++) {
              var url = parts[p].trim().split(" ")[0];
              if (url && !url.startsWith("data:") && !url.startsWith("blob:")) add(url);
            }
          }
        }

        // link preload
        var links = document.querySelectorAll('link[rel="preload"][as="image"]');
        for (var l = 0; l < links.length; l++) {
          var href = links[l].getAttribute("href");
          if (href && !href.startsWith("data:") && !href.startsWith("blob:")) add(href);
        }

        return urlSet;
      }

      function sleep(ms) {
        return new Promise(function(r) { setTimeout(r, ms); });
      }

      // Step 1: Click through pagination
      for (var pageIdx = 0; pageIdx < 10; pageIdx++) {
        var nextBtn = document.querySelector('.newsmask-bottom-page[src*="next"]');
        if (!nextBtn) break;
        var urls = extractAllImageUrls();
        for (var ui = 0; ui < urls.length; ui++) collectedUrls.push(urls[ui]);
        nextBtn.click();
        await sleep(2000);
      }

      // Step 2: Scroll through each section
      var midLists = document.querySelectorAll(".papermask-mid-list");
      for (var li = 0; li < midLists.length; li++) {
        midLists[li].scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(1500);
        midLists[li].scrollTop = 0;
        var sh = midLists[li].scrollHeight;
        for (var sy = 0; sy < sh; sy += 300) {
          midLists[li].scrollBy(0, 300);
          await sleep(500);
        }
      }

      // Full page scroll
      var totalHeight = document.body.scrollHeight;
      for (var y = 0; y < totalHeight; y += 400) {
        window.scrollTo(0, y);
        await sleep(400);
      }
      window.scrollTo(0, 0);
      await sleep(1000);

      // Step 3: Click thumbnails for high-res
      var thumbnails = document.querySelectorAll(".holder-img");
      console.log("[thumbnails] found " + thumbnails.length);
      for (var ti = 0; ti < thumbnails.length; ti++) {
        try {
          thumbnails[ti].scrollIntoView({ behavior: "instant", block: "center" });
          await sleep(500);
          thumbnails[ti].click();
          await sleep(1500);

          var zoomImg = document.querySelector("#papermaskDetailTop-zoom");
          if (zoomImg && zoomImg.src && !zoomImg.src.startsWith("data:") && !zoomImg.src.startsWith("blob:")) {
            if (!zoomImg.complete || zoomImg.naturalWidth === 0) {
              await new Promise(function(r) { zoomImg.onload = r; setTimeout(r, 3000); });
            }
            if (zoomImg.src && zoomImg.naturalWidth > 0) {
              collectedUrls.push(absUrl(zoomImg.src));
            }
          }

          var closeBtn = document.querySelector(".papermaskDetailClose");
          if (closeBtn) closeBtn.click();
          await sleep(500);
        } catch(e) {}
      }

      // Mobile modal
      var mobZoom = document.querySelector("#papermaskDetailTop-zoom-mobile");
      if (mobZoom && mobZoom.src && !mobZoom.src.startsWith("data:") && !mobZoom.src.startsWith("blob:")) {
        collectedUrls.push(absUrl(mobZoom.src));
      }

      // Step 4: Go back to first page
      for (var pi = 0; pi < 10; pi++) {
        var prevBtn = document.querySelector('.newsmask-bottom-page[src*="pre"]');
        if (!prevBtn) break;
        prevBtn.click();
        await sleep(1500);
      }

      // Final scroll
      window.scrollTo(0, 0);
      await sleep(500);
      var th2 = document.body.scrollHeight;
      for (var y2 = 0; y2 < th2; y2 += 400) {
        window.scrollTo(0, y2);
        await sleep(300);
      }

      // Step 5: Stability polling
      var prevCount = 0;
      var stableRounds = 0;
      for (var round = 0; round < 50; round++) {
        var curUrls = extractAllImageUrls();
        for (var ci = 0; ci < curUrls.length; ci++) collectedUrls.push(curUrls[ci]);
        var count = collectedUrls.length;

        if (count !== prevCount) {
          console.log("[round " + round + "] " + prevCount + " -> " + count);
          stableRounds = 0;
        } else {
          stableRounds++;
        }
        prevCount = count;

        if (stableRounds >= 6) {
          console.log("[stable] " + count + " urls collected");
          break;
        }

        window.scrollBy(0, 500);
        await sleep(3000);
      }

      // Step 6: Final filter — deduplicate + remove unwanted
      var uniqueUrls = [];
      var seen2 = {};
      var iconNames = ["pre.png","next.png","star.png","hide.png","share.png",
        "menuc.png","menu.png","v2c.png","b.png","s.png","a.png","d.png",
        "c.png","pc.png","z.png","log.png","logo.png","wx.png","age.png",
        "ageword.png","agewordm.png","cha.png","v2.webp","v2c.png"];

      for (var fi = 0; fi < collectedUrls.length; fi++) {
        var url = collectedUrls[fi];
        if (seen2[url]) continue;
        seen2[url] = true;

        var lower = url.toLowerCase();
        if (url.startsWith("data:") || url.startsWith("blob:")) continue;
        if (lower.indexOf('.svg') !== -1) continue;

        var filename = lower.split("/").pop().split("?")[0];
        if (iconNames.indexOf(filename) !== -1) continue;

        uniqueUrls.push(url);
      }

      console.log("[final] " + uniqueUrls.length + " unique images");
      window.__wpUrls = uniqueUrls;
    }
  `.trim();

  // The run-code receives `page` — wrap everything in page.evaluate()
  return `async (page) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(2000);
    await page.evaluate(${browserCode});
  }`;
}

// ── summary ────────────────────────────────────────────────────────

function printSummary(totalFound: number, success: DownloadResult[], failed: DownloadResult[]) {
  console.log('\n========================================');
  console.log('           DOWNLOAD SUMMARY');
  console.log('========================================');
  console.log(`  Total images found : ${totalFound}`);
  console.log(`  Successfully saved : ${success.length}`);
  console.log(`  Failed             : ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n  Failed URLs:');
    for (const f of failed) {
      console.log(`    - ${f.url}`);
      if (f.error) console.log(`      Reason: ${f.error}`);
    }
  }

  if (fs.existsSync(IMAGES_DIR)) {
    const totalSize = fs.readdirSync(IMAGES_DIR)
      .filter((f) => IMAGE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
      .reduce((s, f) => s + fs.statSync(path.join(IMAGES_DIR, f)).size, 0);
    const mb = (totalSize / 1024 / 1024).toFixed(1);
    console.log(`\n  Total size on disk  : ${mb} MB`);
  }
  console.log('========================================\n');
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  // 0. Clean slate
  console.log('0. Preparing fresh browser session...');
  try { pwc('close-all', 10); } catch {}
  try { pwc('delete-data', 10); } catch {}
  console.log('   Session cleared.');

  // 1. Open browser
  console.log('1. Opening browser...');
  pwc(`open --headed --persistent ${PAGE_URL}`);
  await sleep(3000);

  // 2. Maximize viewport first
  console.log('2. Maximizing viewport...');
  pwc('resize 1920 1080');
  await sleep(1500);

  // 3. Run comprehensive image discovery script
  console.log('3. Running image discovery (scroll + thumbnails)...');
  console.log('   (this may take several minutes)');

  // Use spawnSync (shell:false) to call playwright-cli.js directly with node,
  // passing the script as a single argument without shell interpretation.
  const runScript = buildRunCodeScript();
  const scriptFile = path.resolve(__dirname, '..', '__run_script.js');
  fs.writeFileSync(scriptFile, runScript, 'utf8');

  try {
    const cliPath = getCliEntryPath();
    console.log(`   Using playwright-cli at: ${cliPath}`);
    const result = spawnSync('node', [cliPath, `-s=${SESSION}`, 'run-code', runScript], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 600_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } catch (err: any) {
    console.log(`   (run-code error: ${err.message}, proceeding anyway)`);
  }
  try { fs.unlinkSync(scriptFile); } catch {}

  // 4. Extract URLs from browser
  console.log('4. Extracting image URLs from browser...');
  await sleep(2000);

  const rawJson = execSync(
    `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpUrls || [])"`,
    { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, maxBuffer: 50 * 1024 * 1024 }
  ).trim();

  let domUrls: string[];
  try {
    const first = JSON.parse(rawJson);
    domUrls = typeof first === 'string' ? JSON.parse(first) : first;
  } catch {
    console.error('Failed to parse URLs from browser.');
    domUrls = [];
  }
  console.log(`   DOM images found: ${domUrls.length}`);

  // 5. Also capture network-level image requests
  console.log('5. Extracting network request images...');
  const networkUrls = extractNetworkImageUrls();
  console.log(`   Network images found: ${networkUrls.length}`);

  // 6. Merge & deduplicate
  const allUrlSet = new Set<string>();
  for (const u of domUrls) allUrlSet.add(u);
  for (const u of networkUrls) allUrlSet.add(u);
  const allUrls = [...allUrlSet];
  const totalFound = allUrls.length;
  console.log(`   Total unique images: ${totalFound}`);

  if (allUrls.length === 0) {
    console.log('\nNo images found. The page structure may have changed.');
    return;
  }

  // 7. Cache cookies for download
  console.log('6. Extracting cookies...');
  getCookieHeader();

  // 8. Download all images
  console.log('7. Downloading images...');
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const successResults: DownloadResult[] = [];
  const failedResults: DownloadResult[] = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
    const batch = allUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url): Promise<DownloadResult> => {
        const absUrl = resolveUrl(url, BASE_ORIGIN);
        let filename = getFilenameFromUrl(absUrl);
        filename = uniqueFilename(IMAGES_DIR, filename);
        const dest = path.join(IMAGES_DIR, filename);

        try {
          await downloadFile(absUrl, dest, PAGE_URL);
          process.stdout.write(`  [OK] ${filename}\n`);
          return { url: absUrl, filename, success: true };
        } catch (err: any) {
          process.stderr.write(`  [FAIL] ${filename}: ${err.message}\n`);
          return { url: absUrl, filename, success: false, error: err.message };
        }
      })
    );

    for (const r of results) {
      if (r.success) successResults.push(r);
      else failedResults.push(r);
    }
  }

  // 9. Print summary (browser stays open per requirement #14)
  printSummary(totalFound, successResults, failedResults);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
