# Wallpaper Scraper

Automatically scrape and download wallpapers from the [Bluepoch](https://re.bluepoch.com/home/detail.html#wallpaper) website using Playwright CLI. The tool opens a real browser, clicks through pagination, scrolls lazy-loaded content, opens thumbnail previews for high-resolution versions, and downloads all discovered images to a local directory.

## Features

- **Full page traversal** — auto-clicks pagination, scrolls through sections, and expands thumbnails to find high-res images
- **Multi-source extraction** — collects image URLs from DOM elements (`<img>`, `data-src`, `background-image`, `<picture>`, `<link preload>`) and captured network requests
- **Smart deduplication** — filters out UI icons, SVGs, and duplicate URLs
- **Authenticated downloads** — reuses browser cookies so gated images download correctly
- **Batch downloading** — downloads images in parallel batches of 4

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Playwright CLI](https://www.npmjs.com/package/@playwright/cli) installed globally:

```bash
npm install -g @playwright/cli
npx playwright-cli install
```

## Setup

```bash
npm install
```

## Usage

Run the scraper:

```bash
npm run save-wallpapers
```

The script will:
1. Launch a persistent, headed browser session
2. Navigate to the wallpaper page and run image discovery (may take a few minutes)
3. Download all unique wallpapers into the `images/` directory
4. Print a summary with download counts and total size on disk

Downloaded images are saved under `./images/`.

## Project Structure

```
├── src/
│   └── save_wallpapers.ts   # Main scraper script
├── images/                  # Output directory for downloaded wallpapers
├── package.json
└── tsconfig.json
```

## How It Works

1. Opens the target page in a persistent Playwright browser session
2. Runs an in-browser script that clicks through pagination, scrolls sections, and opens thumbnail previews to collect high-resolution image URLs
3. Extracts additional image URLs from recorded network requests
4. Merges, deduplicates, and filters out non-wallpaper images (icons, UI sprites)
5. Downloads each image using the browser's cookies and a realistic user agent header
