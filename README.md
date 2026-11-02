# 重返未来：1999 壁纸下载器

**中文** | [English](https://github.com/makursi/re1999-wallpaper-crawler/blob/main/README.en.md)

从[官网](https://re.bluepoch.com/home/detail.html#wallpaper)一次读取完整壁纸清单，下载到本地，再在一个本地页面里浏览。程序只在这台电脑上运行，其他设备无法访问。

当前版本 `2.0.0`

![壁纸墙](https://raw.githubusercontent.com/makursi/re1999-wallpaper-crawler/main/docs/screenshots/console-zh.webp)

## 安装

需要 [Node.js](https://nodejs.org/) **22.22.1 或更高版本**：在命令行里运行 `node -v` 确认。除此之外不需要别的运行环境。

1. 到 [Releases](https://github.com/makursi/re1999-wallpaper-crawler/releases) 下载最新的 `re1999-wallpaper-crawler-v<版本号>.zip`。
2. 解压到任意文件夹——路径里有中文、有空格都没关系。解压出来的这个文件夹就是程序目录，不要拆开这个文件夹，也不要把里面的文件单独挪走。
3. 在这个文件夹里打开命令行（在资源管理器地址栏输入 `cmd` 回车即可），运行一次 `npm install`。`npm install` 从 npm 源下载唯一的运行依赖（缩略图用的 `sharp`），版本由随包的 `package-lock.json` 钉住。
4. 运行 `npm start`。浏览器会自动打开壁纸页面，命令行窗口里也会打印页面地址。

Node 版本不够时，`npm install` 会在安装阶段报错退出（包里的 `.npmrc` 打开了 `engine-strict`）；即使绕过了安装检查，程序启动的第一句中文也会说明原因并以非零码退出。

## 启动与停止

每次使用都在程序目录里运行 `npm start`。程序已经在运行时再运行一次，只会把浏览器指回正在运行的那个页面，不会起第二份服务。

停止有两种方式，效果一样：

- 关掉运行 `npm start` 的那个命令行窗口；
- 在页面顶部导航条点「退出」。有下载在跑时会先确认一次。

只关浏览器标签页不会停止程序。

## 数据位置

壁纸、日志和设置都在程序目录下的 `data\` 里，第一次启动时自动创建：

| 位置 | 内容 |
|------|------|
| `data\images\` | 下载的壁纸，也就是页面上的壁纸墙 |
| `data\logs\` | 每次运行的日志 |
| `data\cache\` | 缩略图缓存，删掉只会让下次打开变慢 |
| `data\user.env` | 可选的本地配置覆盖，一般用不到 |

程序不在这个文件夹之外写任何东西：没有注册表项、没有系统服务、没有卸载程序，也没有记下安装位置的指针文件。`npm install` 用的 npm 会在用户目录里保留自己的下载缓存，那属于 npm，不属于这个程序。

## 更新

更新是三步，程序不会自己替换自己：

1. 把新版本的 zip 解压到一个**新文件夹**，不要覆盖旧文件夹。
2. 关闭正在运行的程序，把旧文件夹里的 `data\` 整个移到新文件夹里，与 `README.md`、`package.json` 放在同一层。
3. 在新文件夹里运行一次 `npm install`，再用 `npm start` 确认页面能打开，然后删除旧文件夹。

没有原地覆盖这一步：旧文件夹就是回退点。新版正常工作过一次之前，先不要删除旧文件夹。

### 回退

新版用着不对时，旧文件夹还在就能退回去：关掉新版，把新文件夹里的 `data\` 移回旧文件夹，在旧文件夹里运行 `npm start`。旧文件夹里的程序和依赖都还在，不需要重新安装。

## 卸载

删掉程序目录这一个文件夹即可，程序和 `data\` 一起消失，没有别的要清理。为什么别处不需要清理，见「数据位置」一节。

## 首次抓取预期

首次打开页面后，点顶部导航条里的「运行」，再点「开始运行」。大约 1000+ 张、共约 2 GB，视网速需要 10–40 分钟。中途关掉也没关系：下次点「开始运行」会跳过已经下载好的，只补没下完的。

## 装依赖失败时查什么

`npm install` 失败几乎都出在依赖来源或 Node 版本上，按顺序查：

1. **Node 版本**：`node -v` 必须不低于 `22.22.1`。低于这个版本时 npm 会报 `EBADENGINE` 并以非零码退出；按提示装好新版 Node 后重新运行。
2. **registry 可达性**：在同一台机器上运行 `npm ping`。公司网络、校园网或代理可能挡掉 `registry.npmjs.org`。
3. **代理与 registry 设置**：用 `npm config get registry` 和 `npm config get proxy` 看当前值；镜像或代理地址不对时，用 `npm config set registry <地址>` 改到能访问的那一个，再运行 `npm install`。

程序自己不在安装阶段联网：整条安装链路只用到 npm。

## 版权

壁纸版权归官方（Bluepoch）所有。本项目不存储、也不分发任何壁纸：仓库和发布包里都没有图片，程序只把官网提供的图片下载到运行它的这台电脑上。许可证是 MIT：仓库根有 [`LICENSE`](https://github.com/makursi/re1999-wallpaper-crawler/blob/main/LICENSE)，发布包里是同一份 `LICENSE.txt`。

## 反馈与问题

遇到问题时，到 [Issues](https://github.com/makursi/re1999-wallpaper-crawler/issues) 提问或报告。附上页面顶部显示的版本号和 `data\logs\` 里最新一次运行的日志。

## 源码

源码、开发命令、目录结构与全部约定见仓库根的 [AGENTS.md](https://github.com/makursi/re1999-wallpaper-crawler/blob/main/AGENTS.md)；这份 README 只讲使用。
