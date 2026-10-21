# Reverse: 1999 Wallpaper Downloader

[中文](README.md) | **English**

Fetches the complete wallpaper list from the [official gallery](https://re.bluepoch.com/home/detail.html#wallpaper) in one request, downloads every wallpaper to your computer, and shows them on a local page. The program runs only on your machine; other devices cannot reach it.

![The wallpaper wall](docs/screenshots/console-en.webp)

## Download and use (players)

Nothing to install — no Node.js, no Chrome, no command line.

1. Download the latest `.zip` from [Releases](https://github.com/makursi/re1999-wallpaper-crawler/releases).
2. Extract it anywhere — Chinese characters and spaces in the path are fine.
3. Double-click `启动.bat`. Your browser opens the wallpaper page; closing the black window stops the program.
4. On first use, open “运行” in the top navigation and click “开始运行” (“Start a Run” after switching the page to English). Expect roughly 1,000+ wallpapers, about 2 GB in total, and 10–40 minutes depending on your connection. Closing it halfway is fine: the next start skips what is already downloaded.

Updating, rolling back, uninstalling, where your files live, and what to do when Windows or an antivirus blocks the program are all covered by the manual shipped in the package, [`使用说明.txt`](packaging/使用说明.txt) (Chinese).

## Copyright

The wallpapers are the property of the official site (Bluepoch). This project does not store or distribute them: neither the repository nor the release ships an image, and the program only saves the images the official site serves onto the computer of the person running it. See [LICENSE](LICENSE).

## Build from source (developers)

Node 22 and pnpm are required.

```bash
pnpm install
pnpm build
pnpm webui
```

`pnpm build` produces `build/`: the Console, the Run entry, the updater and the prebuilt page. `pnpm webui` runs that tree directly, and `build/` is its application root — site configuration is read from `build/.env` and data is written to `build/data/`, while `pnpm build` recreates `build/`. To scrape from the source page, copy the repository's `.env` in first (or set `BASE_ORIGIN` before starting):

```powershell
Copy-Item .env build\.env
pnpm webui
```

Long-lived data belongs in the repository's `data/` (that is what `pnpm core:run` uses).

Other commands:

| Task | Command |
|------|---------|
| Package the portable release | `pnpm package` (`pnpm build` + `dist-package/re1999-wallpaper-crawler-v<version>.zip`) |
| Tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm fmt` / `pnpm fmt:check` |
| Build the page only | `pnpm build:web` |

The agent-facing terminal entries (`pnpm core:run`, `pnpm check-run`), the full command table, the directory structure and every convention live in [AGENTS.md](AGENTS.md).

## Layout

- `core/`: the crawler. One request reads the complete official list, then parallel downloads; no browser and no session.
- `web/`: the local Console, service and page together.
- `scripts/`: the build, the packager and the pre-commit guard.
- `packaging/`: the files at the release's archive root (`启动.bat`, `更新.bat`, `使用说明.txt`) and the site-constants template.

Design decisions live in [`docs/adr/`](docs/adr/); each round's trigger, rejected alternatives and measured numbers live in [`HISTORY.md`](HISTORY.md).
