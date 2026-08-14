async (page) => {
  // ================================================
  // Network listener (Node.js side — runs throughout)
  // ================================================
  const networkImages = new Set();
  let lastImageTime = Date.now();
  const startTime = Date.now();
  let thumbnailsClicked = 0;
  let totalIdleSec = 0;

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
  // Logger helper (pushes to window.__wpLog for extraction)
  // ================================================

  async function log(msg) {
    await page.evaluate((m) => {
      (window.__wpLog = window.__wpLog || []).push({ t: Date.now(), msg: m });
    }, msg);
  }

  // ================================================
  // DOM helpers (browser side via page.evaluate)
  // ================================================

  async function injectHash() {
    await page.evaluate((hash) => {
      if (hash && location.hash !== hash) {
        location.hash = hash;
      }
    }, "__PAGE_HASH__");
    await page.waitForTimeout(4000);
    await log("[hash] current URL: " + page.url());
  }

  async function scrollPage() {
    await page.evaluate(async () => {
      // Scroll virtual-scroll wallpaper containers (dynamic scrollHeight)
      const lists = document.querySelectorAll(".papermask-mid-list");
      for (const list of lists) {
        list.scrollIntoView({ behavior: "instant", block: "center" });
        await new Promise(r => setTimeout(r, 500));
        // Dynamic scroll: re-read scrollHeight each iteration (virtual scroll grows)
        let prevSH = 0;
        let stall = 0;
        while (stall < 3) {
          list.scrollBy(0, 600);
          await new Promise(r => setTimeout(r, 300));
          const currSH = list.scrollHeight;
          if (currSH > prevSH) {
            prevSH = currSH;
            stall = 0;
          } else {
            stall++;
          }
        }
      }
      // Full page scroll (dynamic)
      let prevBodySH = 0;
      let bodyStall = 0;
      while (bodyStall < 2) {
        window.scrollBy(0, 600);
        await new Promise(r => setTimeout(r, 300));
        const currSH = document.body.scrollHeight;
        if (currSH > prevBodySH) {
          prevBodySH = currSH;
          bodyStall = 0;
        } else {
          bodyStall++;
        }
      }
      window.scrollTo(0, 0);
    });
    // Wait for lazy-loaded images to fire
    await page.waitForTimeout(3000);
  }

  async function clickAllThumbnails() {
    const count = await page.evaluate(() => {
      return document.querySelectorAll(".holder-img").length;
    });
    await log("[thumbnails] " + count);
    thumbnailsClicked = count;

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
            await new Promise(r => { zoom.onload = r; setTimeout(r, 10000); });
          }
          const close = document.querySelector(".papermaskDetailClose");
          if (close) { close.click(); await new Promise(r => setTimeout(r, 300)); }
        }, i);
      } catch(e) { await log("[thumb] fail #" + i + " " + (e?.message || e)); }
    }
  }

  function getScrollHeight() {
    return page.evaluate(() => {
      let total = document.body.scrollHeight;
      document.querySelectorAll(".papermask-mid-list").forEach(el => {
        total += el.scrollHeight;
      });
      return total;
    });
  }

  // ================================================
  // Main discovery flow
  // ================================================

  // Step 1: Inject hash + wait for SPA
  await log("[run-code] starting on: " + page.url());
  await injectHash();
  await page.waitForTimeout(3000);

  // Step 2: Refresh to capture initial images via network listener
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(3000);
  await injectHash();
  await page.waitForTimeout(2000);
  await log("[run-code] reloaded, now on: " + page.url());

  // Scroll to trigger initial lazy loading (before main scroll pass)
  await scrollPage();

  // Step 3: Scroll through content to trigger lazy loading
  await scrollPage();
  await page.waitForTimeout(2000);
  try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch(e) {}

  // Step 4: Click thumbnails (triggers high-res image loads)
  await clickAllThumbnails();

  // Step 5: Final scroll pass
  await scrollPage();

  // Step 6: Stability loop
  // Condition: 45s without new image AND stable scrollHeight (body + virtual containers)
  let stableRounds = 0;
  let prevSH = 0;
  let converged = false;
  await log("[stability] waiting for image requests to stop...");
  while (stableRounds < 6) {
    await page.waitForTimeout(5000);
    totalIdleSec += 5;
    const elapsed = (Date.now() - lastImageTime) / 1000;
    const sh = await getScrollHeight();
    await log("[stability] " + elapsed.toFixed(0) + "s idle, sh=" + sh + ", images=" + networkImages.size);

    if (elapsed > 45 && sh === prevSH) {
      stableRounds++;
    } else {
      stableRounds = 0;
      // Lightweight stall on virtual containers to trigger more lazy loads
      if (elapsed < 45) {
        await page.evaluate(async () => {
          const lists = document.querySelectorAll(".papermask-mid-list");
          for (const list of lists) {
            let stall = 0;
            let prev = list.scrollHeight;
            let iter = 0;
            while (stall < 2 && iter < 10) {
              list.scrollBy(0, 600);
              await new Promise(r => setTimeout(r, 200));
              const curr = list.scrollHeight;
              if (curr > prev) { prev = curr; stall = 0; }
              else { stall++; }
              iter++;
            }
          }
        });
      }
    }
    prevSH = sh;

    if (stableRounds >= 6) {
      converged = true;
      await log("[stability] converged after " + elapsed.toFixed(0) + "s");
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
  await log("[final] DOM=" + domUrls.length + " Network=" + networkImages.size + " Combined=" + finalUrls.length);
  await page.evaluate((urls) => { window.__wpUrls = urls; }, finalUrls);

  const discoveryStats = {
    converged,
    stableRounds,
    totalIdleSec,
    networkCount: networkImages.size,
    domCount: domUrls.length,
    combinedCount: finalUrls.length,
    thumbnailsClicked,
    discoveryDurationMs: Date.now() - startTime,
  };
  await page.evaluate((s) => { window.__wpStats = s; }, discoveryStats);
}
