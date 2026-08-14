import * as path from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import 'dotenv/config'

// ── configuration schema ──────────────────────────────────────────

const configSchema = z.object({
  BASE_ORIGIN: z.url(),
  PAGE_PATH: z.string().min(1),
  SESSION_NAME: z.string().min(1).default('bluepoch'),
  IMAGES_DIR: z.string().min(1).default('images'),
  BATCH_SIZE: z.coerce.number().int().positive().max(20).default(4),
  PLAYWRIGHT_CONFIG: z.string().min(1).default('.playwright/config.json'),
  LOG_DIR: z.string().min(1).default('logs'),
})

const parsed = configSchema.parse(process.env)

// ── exports ───────────────────────────────────────────────────────

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

export const BASE_ORIGIN = parsed.BASE_ORIGIN
export const PAGE_PATH = parsed.PAGE_PATH
export const PAGE_URL = `${BASE_ORIGIN}${PAGE_PATH}`
// Hash is page logic, not env config (# is comment char in .env)
export const PAGE_HASH = '#wallpaper'
export const IMAGES_DIR = path.resolve(PROJECT_ROOT, parsed.IMAGES_DIR)
export const SESSION = parsed.SESSION_NAME
export const BATCH_SIZE = parsed.BATCH_SIZE
export const PLAYWRIGHT_CONFIG = parsed.PLAYWRIGHT_CONFIG
export const LOG_DIR = path.resolve(PROJECT_ROOT, parsed.LOG_DIR)

export const USER_AGENT
  = process.env.USER_AGENT
    ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
