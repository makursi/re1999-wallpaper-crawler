# 重返未来：1999 壁纸下载器

**中文** | [English](README.en.md)

工具从[官网](https://re.bluepoch.com/home/detail.html#wallpaper)下载全部壁纸到本地，并在一个页面里浏览。服务只在你自己的电脑上运行，其他设备访问不到。

![壁纸墙](docs/screenshots/console-zh.webp)

## 准备

安装 Node 22、pnpm 和 Chrome。在项目根目录中打开终端（Windows 用 PowerShell），逐行执行：

```bash
npm install -g @playwright/cli
npx playwright-cli install
pnpm install
```

## 启动

```bash
pnpm webui
```

终端打印一行地址，浏览器自动打开它：

```
WebUI: http://127.0.0.1:8791/?token=……
```

## 页面

镜像 1013 是本地已有的张数，官方清单 1010 是官网现有的张数。下一行给两个数：官网有、本地没有的张数，以及本地有、官网清单里已经没有的个数。

## 运行期间

Chrome 窗口自动翻页，不要点击其中的元素，也不要关闭它。

按 Ctrl+C 结束服务，未完成的下载也会停止。

已经存在的文件会跳过，只下载新增的壁纸。

## 结果

运行结束后，“运行”面板给出三种结论之一：

- 干净：没有发现问题。
- 已解释：出现的是常规情况，例如官网背景图被正确排除、本地多了几张官网已删除的图。这些情况记录在案，不影响使用。
- 缺陷：这次没有抓全，或有文件下载失败。再运行一次通常可以解决。

## 常见问题

- 提示“先完成站点配置”：缺少 `.env` 文件。在项目根目录新建文件，命名为 `.env`，写入两行。

  ```
  BASE_ORIGIN=https://re.bluepoch.com
  PAGE_PATH=/home/detail.html
  ```

## 文件位置

- `images`：壁纸文件。
- `logs`：每次运行写一个 JSONL 日志。

