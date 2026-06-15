import { PAGE_HASH } from "./config";

// ── network request image extraction ───────────────────────────────

export function extractNetworkImageUrls(
  pwc: (args: string, timeoutSec?: number) => string,
): string[] {
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

export function buildRunCodeScript(): string {
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
