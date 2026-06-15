import "dotenv/config";
import * as path from "path";

// ── configuration from .env ────────────────────────────────────────

export const BASE_ORIGIN = process.env.BASE_ORIGIN || "https://re.bluepoch.com";
export const PAGE_PATH = process.env.PAGE_PATH || "/home/detail.html";
export const PAGE_URL = `${BASE_ORIGIN}${PAGE_PATH}`;
// Hash is page logic, not env config (# is comment char in .env)
export const PAGE_HASH = "#wallpaper";
export const IMAGES_DIR = path.resolve(
  __dirname,
  "..",
  process.env.IMAGES_DIR || "images",
);
export const SESSION = process.env.SESSION_NAME || "bluepoch";
export const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "4", 10);
export const PLAYWRIGHT_CONFIG =
  process.env.PLAYWRIGHT_CONFIG || ".playwright/config.json";

export const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
