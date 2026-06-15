import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import { USER_AGENT, IMAGE_EXTENSIONS } from "./config";

// ── types ──────────────────────────────────────────────────────────

export interface DownloadResult {
  url: string;
  filename: string;
  success: boolean;
  error?: string;
}

// ── cookie extraction ──────────────────────────────────────────────

let _cachedCookieHeader: string | null = null;

export function getCookieHeader(
  pwc?: (args: string, timeoutSec?: number) => string,
): string {
  if (_cachedCookieHeader) return _cachedCookieHeader;
  if (!pwc) return "";
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

// ── URL utilities ──────────────────────────────────────────────────

export function getExtFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0].split("#")[0];
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot === -1) return "";
  const ext = withoutQuery.substring(lastDot).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : "";
}

export function getFilenameFromUrl(url: string): string {
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

export function uniqueFilename(dir: string, filename: string): string {
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

export function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// ── download with proper headers ───────────────────────────────────

export function downloadFile(
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
