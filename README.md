# 重返未来：1999 壁纸下载器

**中文** | [English](README.en.md)

从[官网](https://re.bluepoch.com/home/detail.html#wallpaper)一次读取完整壁纸清单，下载到本地，再在一个本地页面里浏览。程序只在这台电脑上运行，其他设备无法访问。

![壁纸墙](docs/screenshots/console-zh.webp)

## 下载使用（玩家）

不需要安装 Node.js、Chrome 或任何命令行工具。

1. 到 [Releases](https://github.com/makursi/re1999-wallpaper-crawler/releases) 下载最新的 `.zip`。
2. 解压到任意文件夹——路径里有中文、有空格都没关系。
3. 双击 `启动.bat`。浏览器会自动打开壁纸页面。要停止程序，可以关闭那个黑色窗口，也可以在页面顶部导航条里点“退出”；程序退出后窗口会等你按任意键再关闭。
4. 首次打开时，点顶部导航条里的“运行”，在面板里点“开始运行”。大约 1000+ 张、共约 2 GB，视网速需要 10–40 分钟；中途关掉也没关系，下次会跳过已经下载好的。

更新、回退、卸载、数据在哪、被 Windows 或杀毒软件拦下时怎么办，都写在包内的 [`使用说明.txt`](packaging/使用说明.txt) 里。

## 版权

壁纸版权归官方（Bluepoch）所有。本项目不存储、也不分发任何壁纸：仓库和发布包里都没有图片，程序只把官网提供的图片下载到使用者自己的电脑上。许可证见 [LICENSE](LICENSE)。

## 从源码构建（开发者）

需要 Node 22 和 pnpm。

```bash
pnpm install
pnpm build
pnpm webui
```

`pnpm build` 产出 `build/`：Console、抓取入口、更新入口和预构建的页面。`pnpm webui` 直接运行这棵树，`build/` 就是它的应用根——站点配置从 `build/.env` 读，数据写到 `build/data/`，而 `pnpm build` 会重建 `build/`。要在源码页面里抓取，先把仓库根的 `.env` 复制进去（或启动前设置 `BASE_ORIGIN`）：

```powershell
Copy-Item .env build\.env
pnpm webui
```

长期保留的数据请放在仓库根的 `data/`（`pnpm core:run` 用的就是它）。

其他命令：

| 任务 | 命令 |
|------|------|
| 打包便携版 | `pnpm package`（构建 + 打出 `dist-package/re1999-wallpaper-crawler-v<version>.zip`） |
| 测试 | `pnpm test` |
| 类型检查 | `pnpm typecheck` |
| Lint | `pnpm lint` |
| 格式 | `pnpm fmt` / `pnpm fmt:check` |
| 只构建页面 | `pnpm build:web` |

面向 agent 的终端入口（`pnpm core:run`、`pnpm check-run`）、完整命令表、目录结构与全部约定见 [AGENTS.md](AGENTS.md)。

## 结构

- `core/`：爬虫。一次请求读取完整的官方清单，再并行下载；没有浏览器，也没有会话。
- `web/`：本地控制台，服务端和页面都在这里。
- `scripts/`：构建、打包和 pre-commit 守卫。
- `packaging/`：发布包根目录的文件（`启动.bat`、`更新.bat`、`使用说明.txt`）和站点常量模板。

设计决定记录在 [`docs/adr/`](docs/adr/)，每一步的动机、被否掉的方案和实测数字在 [`HISTORY.md`](HISTORY.md)。
