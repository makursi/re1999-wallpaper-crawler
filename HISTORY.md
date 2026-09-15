# HISTORY — 项目沿革与决策记录

> **读法**（也写进 AGENTS.md）：改动任何管线之前，先扫一遍对应迭代的条目，避免重走已被否决的方案。本文只记**为什么现在长这样**；现状事实（命令、架构、陷阱、词表）以 AGENTS.md / `src/` / CONTEXT.md / `docs/adr/` 为准，不在此重复。
> **约定**：每条 = 触因 → 决策（含被否决项）→ 验证 → 教训。

---

## 迭代历史

### 2026-06-14 — 基线：单文件实现 + 全量分析（WORKLOG v1）

单文件 `src/save_wallpapers.ts`（652 行），CLI 脚本串起整个流程。本次会话只做文档化，无代码变更。核心架构在当时就已定型：

- **Network-first 捕获**：图片 URL 用 `page.on("response")` 监听 `content-type: image/*` 收集，DOM 只负责驱动滚动/点击触发懒加载
- **稳定性循环**：旧方案轮询 DOM 图片数量判稳定，但 SPA 会卸载已浏览元素 ⇒ 永不收敛；改为「15s 无新网络图片 + scrollHeight 不变 + 无下一页按钮」三条件联合判稳
- **CDN 哈希去重**：CDN 文件名含内容哈希，同文件名 = 同内容，`fs.existsSync` 直接跳过

**陷阱记录**（多数已固化进 AGENTS.md Gotchas，不重复）：`--filename` 而非内联（cmd.exe 吞 `#`/多行）；run-code 运行在 Node 侧需 `page.evaluate` 访问浏览器；`module.exports`/尾部分号会 SyntaxError；`viewport: null` + 真实窗口尺寸才能加载桌面版布局。

### 2026-06-15 — 模块化拆分（4 文件）

**触因**：652 行单文件不可维护。

**决策**：
- 层级选 **文件级拆分（A）**，否决工具库（B）/ Scrapy 式多站点框架（C）——单一抓取目标，简单优先
- **否决 NestJS**：CLI 脚本项目 vs HTTP 框架完全不匹配（无路由/API/DB）
- 4 文件方案：`config.ts` / `download.ts` / `scraper.ts` / `main.ts`；否决再拆 playwright/cookie 为独立文件（小函数，独立文件徒增 import）
- `buildRunCodeScript()` 保留为 TS 函数（类型检查 + 模板替换有类型提醒），不拆 `.js`
- `pwc`（Playwright CLI 包装）通过参数注入，不放进 config.ts——纯函数可测试，config 不依赖 `child_process`
- 类型就地定义 + Cookie 闭包缓存，不引入 `types.ts`
- 一次性拆完再验证（`tsc --noEmit` + 完整运行）；跳过 vitest——可测性分析后仅 3 个纯函数值得测，ROI 低

**验证**：tsc 零错误；382 张全下载，0 失败，1376.8 MB。

**教训**：模块化前先定层级；框架选择要对口；依赖注入优于全局变量；闭包缓存是合理封装。

### 2026-06-15 — 抽象优化（undici / zod / union）

**触因**：逐模块评估抽象质量，消除低级实现与死代码。

**决策**：
- `downloadFile` 用 **undici fetch** 重写：85→45 行，消除手动协议选择 + 递归重定向 + Promise 构造器 + stream piping
- `.env` 加 **zod schema 校验**：6 变量无校验时 `BATCH_SIZE=zero` → `NaN` → 下载循环静默失败；启动即抛明确错误
- `DownloadResult` → **`DownloadOutcome` discriminated union**：`{kind: "ok"|"skipped"|"failed", ...}`，`classifyOutcomes` switch 穷尽，编译期保证
- 删死代码 `getExtFromUrl` / `uniqueFilename`（-23 行，CDN 哈希去重后无人引用）
- 提取 `downloadBatch` + `classifyOutcomes` + `downloadOne`（可单测）；`onProgress` 回调保实时进度
- `buildRunCodeScript()` 不拆——220 行自成一体的模板，拆开无收益反增序列化 bug 风险

**验证**：tsc/eslint 零错误；607 张（DOM 发现的历史峰值，含重复残留）、0 失败。

**教训**：fetch 比 raw http 干净太多；配置校验防 NaN 类运行时谜题；discriminated union > boolean + 魔法字符串；死代码应立即删；不是所有大函数都需要拆。

### 2026-06-17 — 日志体系 + 深度审查（pino / grill ×2）

**触因**：`npm run save-wallpapers` 只发现 172 张，磁盘已有 640 张 —— 差距 468 张，靠日志追踪但 run-code 的 console.log 不可见；`extractNetworkImageUrls` 只贡献 2 张（vs DOM 172）几乎不工作。

**决策**（grill 决策树，11 题）：
- pino 双写：终端 pino-pretty + JSONL 文件（时间戳文件名）
- run-code stdout 逐行入日志，提供 `phase: "run-code"` 结构
- **删除 `extractNetworkImageUrls`**（不是修复）：2 张 vs 172 张，给了安全感但不工作
- `getCookieHeader` 拆为 `extractCookies` + 内部 `getCookieHeader`；`resolveUrl` 删 try-catch（错误吞没）；删魔法 sleep（`goto` 后 5s / 提取前 2s）；翻页上限 `for < 10` → while 无上限
- `buildRunCodeScript` 模板字符串 → 独立 `scripts/run-discovery.js` 文件（占位符 `__PAGE_HASH__`）
- eslint：`@antfu/eslint-config`，200+ 错误，`--fix` 修 85%，28 项手动（`node:` 前缀、`perfectionist/sort-imports` 字母序、`ts/strict-boolean-expressions` 要求 `!= null`、`catch (err: unknown)`、`regexp` 非捕获组 `(?:png)` 等）

**验证**：tsc/eslint 零错误；172 张全跳过、0 失败。

**教训**：日志缺失是真 bug——没有它 468 张差距永远无法定位；删除不工作的死代码是净收益；eslint `--fix` 强大但不完整，剩余需逐个理解规则意图。

### 2026-06-17 — 诊断通道 + 虚拟滚动修复（`__wpLog`）

**触因**：pino 上线后 run-code 的 `[hash]`/`[stability]` 日志仍不可见。排查发现 playwright-cli 吞掉 Node 侧 console.log，stdout 只回显脚本源码，浏览器 console 写文件但我们不读。同时 `__wpLog` 暴露两个新问题：`scrollHeight=720` 恒定不变（虚拟容器动态增长、固定上界 for 循环提前结束）+ 翻页循环零执行（站点无分页）。

**决策**：
- **诊断通道改走 `window.__wpLog`**：run-code 侧 `log()` 辅助函数 `page.evaluate` 推入 `{t, msg}`；main 侧 `--raw eval "JSON.stringify(window.__wpLog)"` 提取逐条入 pino。浏览器全局变量是跨进程唯一可靠路径
- `--filename` 尾部禁止分号/`module.exports`（SyntaxError）
- `scrollPage()` 重写：while + stall 检测，每轮重读 `scrollHeight`，步长 300→600
- **删除翻页死代码**：`clickNextPage` / `goBackToFirstPage` / `hasNextPage`，步骤 7→6

**验证**：67→112 张（+67%）；缩略图 14→30；run-discovery.js 236→200 行。

**教训**：诊断日志是调试的钥匙（`[thumbnails] 14 vs 30` 直接量化改进）；虚拟滚动必须动态读 scrollHeight；'next=false' 日志暴露翻页是死代码。

### 2026-06-18 — 网络解耦（networkidle 全面退役）

**触因**：同一代码库捕获量在 67~607 间波动（9 倍），当前 292 张远低于峰值。定位到 **5 个网络耦合点** —— 各处 `waitForLoadState("networkidle")` + 固定短阈值系统性截断慢网下的懒加载。

**决策**（按 D→A→C 优先级）：
- **D 稳定阈值** 15s/4 轮 → **45s/6 轮**；循环内滚动触发阈值 15→45
- **A reload**：`waitUntil: networkidle` → `"load"` + 主动 `scrollPage()` 触发首屏懒加载
- **B scroll 末尾**：`waitForLoadState("networkidle", 10s)` → `waitForTimeout(3000)`
- **C 缩略图间**：networkidle 整行删除；`catch(e) {}` → `catch(e) { log("[thumb] fail #" + i + ...) }`
- **E zoom 兜底** `setTimeout(r, 3000)` → `10000`

**设计原则**：网络层 `page.on("response")` 一直运行、不依赖 networkidle 捕获；稳定性用时间阈值 + 计数而非网络状态；所有等待从"等网络空闲"改为"给足够时间让请求发出"。

**验证**：292→367 张（+26%）；缩略图 43→60；稳定收敛从 ~17-32s（被 15s 截断）→ 70s；缩略图 60 个全成功。

**教训**：固定时间阈值是最危险的网络耦合（15s 阈值在慢网下系统性提前退出）；`networkidle` 对懒加载页面不可靠——JS 初始化完就算 idle，懒加载未必触发；`catch(e) {}` 是 bug 加速器。

### 2026-06-18 — scrollHeight 真实信号 + 稳定循环内嵌 stall

**触因**：`sh=720` 全程不变——`getScrollHeight()` 只读 `document.body.scrollHeight`（固定视口），没读实际增长的 `.papermask-mid-list` 虚拟容器；稳定循环内 `window.scrollBy` 滚 body 对懒加载无效。

**决策**：
- `getScrollHeight()` 改为 body + 所有 `.papermask-mid-list` 容器 scrollHeight 之和
- 稳定循环内 `window.scrollBy` → 容器级轻量 stall：`while (stall < 2 && iter < 10) { list.scrollBy(0, 600); wait 200ms; 重读 scrollHeight }`

**验证**：367→442 张（+20%）；scrollHeight 从装饰性的 720 → 真实的 104098；稳定收敛 70→71s。三次累计：292→442（**+51%**）。

**教训**：恒为 720 的信号是红旗（选错信号源）；稳定循环需要双信号（45s 无新图 ∧ scrollHeight 不变）且两条腿都真；滚 body 对虚拟滚动页面无效，必须滚容器；等待期内嵌 stall 持续触发更多渲染。

### 2026-08-06 — 日志可观测性重构（run_report / run_meta / Vitest / ADR 0002）

**触因**：让 Agent 能分析爬取日志 —— 现有日志 4 类硬伤：run-code stdout 回显整个脚本源码（每次 ~60 行噪音）；失败仅 `reason: HTTP 403` 无结构；无 run-id/配置快照，跨 run 分析被配置漂移误导；无结构化汇总，且非图片 URL（`detail.html`）泄漏进最终集合照常"下载"。

**决策**（grill 9 题定语义，domain-modeling 落词表进 CONTEXT.md）：
- JSONL 保留 + 每次运行产出一条 **`type: "run_report"`**（单条自包含结构化记录，含 discovery/download/defects/failures 四大块）——ADR 0002，否决独立 report.json/.md（单一事实来源）
- 首条 **`type: "run_meta"`**：runId + 时间戳 + 配置快照，排除配置漂移
- 下载事件补 `status/retried/durationMs/bytes`；run-discovery 末尾写 `__wpStats`（converged/stableRounds/totalIdleSec/计数/thumbnailClicked）
- 停掉 run-code stdout 逐行记录
- **TDD**（Vitest 4.1.10）：3 个纯逻辑 seam —— `classifyOutcomes` / `detectLeaks` / `buildRunReport`，10 个测试；浏览器侧胶水靠真跑验证，避免 mock 网络/文件系统的脆弱测试
- 缺陷自动判定 5 类：discoveryLeak / nonConverged / emptyResult / persistentFailures / emptyFiles；分析配方写进 AGENTS.md

**验证**：tsc/eslint 零错误；10 passed；真跑 converged=true、6 轮稳定、35s idle、combined=972、0 fail；自动捕获 `discoveryLeak=1`（页面自身 `detail.html`，判定良性 accept —— 网络层捕获了页面的 canonical image 响应但不是 Wallpaper、不下载）。

**教训**：grill 定语义、domain-modeling 落词表，schema 一次成型；测试选纯逻辑 seam；真实数据暴露真缺陷（leak 在旧日志里"悄悄被下载"）；run_meta 是跨 run 分析前提；ADR 记否决项（独立 report.json 是"下一个人会重新提"的方案）。

### 2026-08-14 — ESM 迁移（ts-node → tsx / ADR 0003）

**触因**：CommonJS + ts-node（`type: commonjs`、`.js` 后缀、`__dirname` 5 处）迁移到原生 ESM + tsx。验收标准 **Run parity**：run_report 结构契约不变（14 键）+ 指标不退化。

**决策**：
- `module/moduleResolution: nodenext`；相对导入全加 `.js` 后缀（11 处机械改动）
- `__dirname` → `import.meta.dirname`（Node ≥20.11）；`config.ts` 抽 `PROJECT_ROOT`（5 处重复收敛单点）
- `verbatimModuleSyntax: true` 编译期拦截类型误导入；删 declaration/outDir/sourceMap，`noEmit: true`（无构建需求，tsx 直跑）
- ADR 0003：ESM + tsx 选型，否决 ts-node ESM / bundler resolution

**验证**：tsc/eslint 零错误；10 passed（vitest 原生支持 ESM）；真跑与基准深比较：14 键契约一致、combinedCount=972 一致、download/defects/failures 深比较相等、thumbnailsClicked 165 vs 135 属运行时抖动。

**教训**：esbuild 0.28 平台二进制走 optionalDependencies，无需 `allowScripts`；PowerShell `Set-Content UTF8` 写 BOM 会破坏 JSON 解析（用 .NET WriteAllText(utf8NoBom)）；迁移类任务必须连带更新文档（AGENTS.md 仍写 ts-node 时 review 子代理一针见血）。

### 2026-09-03 — save-images 技能 mattpocock 重构 + 跨 agent 迁移

**触因**：把 `.claude/skills/save-images/SKILL.md`（468 行知识倾倒、模型调用）重构为 71 行操作 runbook；随后迁至 `.agents/skills/save-images/`（PR #1），放开为任意 agent 调用；实跑一次全量爬取验证。

**决策**：
- **目录 `.agents/skills/`**（跨 agent 约定：pi / Codex / Gemini CLI / Cursor 原生读）；删 `.claude` 副本（438 行）与 `.pi/` 设计。**Claude Code 例外**：仍只读 `.claude/skills`，`.agents` 支持在 feature request 中
- 去 `disable-model-invocation: true` → 模型可自主触发；用户仍可 `/skill:save-images` 指名调用
- **Preflight 探测 playwright-cli 可用性而非 session eval**：管线自管 session（close-all + delete-data + open --persistent），运行前 eval 必报 "not open"，属预期非故障
- 内容分流：决策历史 → `docs/adr/`；词汇 → `CONTEXT.md`；运行分析 → `AGENTS.md`（单一事实源）；技能只留算子流程 + *Done when* 完成标准
- AGENTS.md 增 Git Conventions 节固化提交流程

**验证**（实跑 302s）：converged=true、6 轮稳定、60s idle、combinedCount=502；下载 502 skipped / 0 ok / 0 failed（全部 Content-hash skip，磁盘 1963.9 MB 共 971 文件）；defects 仅 discoveryLeak=1（良性）；run_meta 与 .env 一致无漂移。

**教训**：技能 Preflight 不应探测 session（管线自管 session，探测必报 not open，误判前置失败）；`download.successRate: 0` 是全跳过语义不是失败（口径 ok/(ok+failed)，重抓全命中 skip 属干净重抓）；`discoveryLeak` 仅含页面自身 HTML URL 时良性 accept 不要重跑；`.agents/skills` 是跨 agent 约定目录但 Claude Code 只读 `.claude/skills`——迁移前先查目标 harness 的扫描路径；技能是"指向文档的指针"不是"项目记忆"（决策/词汇/分析分别指向 ADR/CONTEXT/AGENTS）；错误排查优先读工具全量输出（probe 首次只见堆栈尾部误判故障，读完整错误才定位 `Browser 'bluepoch' is not open`）。

---

### 2026-09-04 — src 目录按领域轴重组（Discovery / Download / Report）

**触因**：src 平铺 7 文件（936 行），模块归属靠读 import 才能看出；CONTEXT-MAP 已定义领域边界（Discovery/Download/Diagnostics），目录却没跟随。

**决策**（grill 两轮，全部按推荐）：
- **领域轴**（跟随 CONTEXT-MAP）：新增 `src/discovery/`、`src/download/`、`src/report/`；否决技术层轴（browser/analysis/core）——层是技术术语，与领域词表冲突
- `main.ts` 保持 `src/main.ts` 根入口（`tsx src/main.ts` 不动）；`config.ts`/`logger.ts` 留根（合计 74 行，单开目录是"一目录一文件"，等涨到 3+ 文件再收）
- 接受单文件目录（`discovery/` 只有 11 行 loader——目录是领域信标不是仓库）
- **`scraper.ts` 改名 `discovery-loader.ts`**：CONTEXT.md 词表明确 _Avoid: scraper script_，文件名是 agent 会 grep 的词，Avoid 词永久误导
- 不写 ADR（可回滚、非惊讶、无僵化收益），HISTORY.md 记录即可；main.ts 内 helpers 不拆（本次=纯目录移动，零逻辑变更，与函数重构分账）
- 文档同步：AGENTS.md 架构树、CONTEXT-MAP.md 的 Owns/Where-things-live 一并更新（单一事实源）

**验证**：`npx tsc --noEmit` 零错误；`npm test` 10 passed；`npx eslint .` 零错误。

**教训**：目录结构应照抄已有领域词表（CONTEXT-MAP），人类读文档和 agent 读目录得到同一张图；重构与函数拆分是两笔账，混在一起出问题难定位；文件名里的 Avoid 词会永久误导 grep。

---

### 2026-09-04 — 慢网修复 + Run parity 验证（waitForList / 无条件滚动探测 / 900s 超时）

**触因**：重构后实跑发现折叠——combinedCount 22 vs 基线 502（09-03），thumbnails=0，sh=4964 vs 历史 119704。用户报告网络延迟高。

**诊断**（关键：把现象和代码耦合区分开）：
- 修复前日志显示两处代码耦合缺陷：① reload 后固定 ~9s 就滚动/点缩略图，慢网下 bundle 未启动完 → `[thumbnails] 0`、双跑滚动打在空 DOM；② 稳定循环把滚动探测绑在 `elapsed < 45`，idle 超线后列表再也不滚 → 挂起的懒加载永不触发 → 提前收敛
- 此两处与 HISTORY 2026-06-18 教训同源：固定时间阈值是最危险的网络耦合

**决策**：
- `waitForList()`：轮询等 `.papermask-mid-list` 出现（90s 上限）再进滚动，替代盲等固定时间
- 稳定循环每轮无条件滚动探测；收敛仍要求 45s 无新图且 sh 不变——计时器只确认穷尽，不冻结探测
- run-code 超时 600s→900s（实测 425s 已靠近上限）
- 修复后实跑验证：`[list] rendered` 出现、images 35→47 持续推进、收敛正常——**修复本身工作正常**，但仍 21 张（网络捕获 47 = 页面真实 DOM，非探测不足）

**真相**：**官网资源已被爬完**（用户确认）。证据：run_meta 同代码同配置；页面静态只有 15 个 `.holder-img`、无 tab/无加载更多；壁纸 URL 止于 `20260729/976` 批次；磁盘 971 文件含全部，下载全 Content-hash skip。捕获下滑是历史趋势（972→502→21），非 crawler 缺陷。

**验证**：`node --check` / tsc / vitest 10 passed / eslint 全绿；实跑 2 次确认结论稳定。

**教训**：低 combinedCount ≠ crawler 缺陷——先看 run_report 的 net/dom/shh 与页面静态 DOM 能否对上，再定是否重跑；修复与"外部内容减少"要分开诊断，修复验证不能只盼数字回到基线；链式 PR base 分支删除后无法改 base，需 rebase + 强推 + 重建 PR。

---

### 2026-09-15 — 站点杂项过滤 + 官方总数跨轮追踪（wallpaper-url.ts / gallery.ts / ADR 0004-0005）

**触因**：
1. 09-14 重跑发现官网 09-07 批次上新 36 张（编号 977–1012），磁盘 971→1007 文件；09-04 写下的「971 文件 = 官网全量、使命达成」被证伪
2. 用户要求：每轮爬完自动更新官方图片总数，方便后续跨轮对比
3. `images/` 里混着 6 个非壁纸文件，且每轮都被重新尝试下载

**决策**：
- 新增 `src/wallpaper-url.ts`，把「什么算 Wallpaper」收敛成一个纯模块；杂项按**结构规则**标记：非图片 URL / 主机 `hm.baidu.com` / 路径前缀 `/home/img/` / 文件名前缀 `icon-`
  - 否决**按精确文件名**：统计像素每次请求的 query 都不同（`logs/` 里 `hm.gif` 共 22 个不同 URL），图标名带构建哈希
  - 否决**只保留 CDN `/PICTURE/` 白名单**：白名单失效是静默丢图（跑完像一次干净的空结果），黑名单最坏只是多下，可见且可恢复
  - 否决**把规则塞进 `scripts/run-discovery.js` 的 `shouldKeep`**：那份 JS 不可类型检查、不可单测
- 过滤点放 `main.ts`（TS、可测）。`discovery.combinedCount` 语义**保持不变**（仍是原始捕获数，含杂项），被丢掉的杂项另立 `run_report.siteAssets`，以免破坏既有跨轮可比性
- 新增 `src/report/gallery.ts` + `logs/gallery-state.json`：官方总数 = 磁盘上的壁纸文件数（累计），单调取 `max`，每轮写入并对比上一轮；无历史记录时用 `officialTotal - download.ok` 反推上一轮值，避免升级时把增量记成 0（ADR 0005，并明确区别于 ADR 0002 所否决的「同一轮数据的第二份表示」——这是跨轮记忆）
- 删除那 6 个杂项文件（`1.png` / `BG2.png` / `icon-192_*.png` / `Vinyl record.png` / `hm.gif` / `detail.html`，共 3.6 MB）
- `IMAGE_EXTENSIONS` 统一到 `src/wallpaper-url.ts` 单一来源：`report.ts` 那份随 `isImageUrl` 迁走时删掉，`config.ts` 那份在自审后也去掉，`download.ts` 改为从 `wallpaper-url.ts` 引入（本条目初版写的「复用为统一判据」当时并不成立，已纠正）

**验证**：
- 三件套：tsc / vitest（33 passed，新增 `wallpaper-url.test.ts` 与 `gallery.test.ts`）/ eslint 全绿
- 突变测试确认用例有牙：删掉 `host` 规则 + 把 `Math.max` 换成直接赋值 → 4 个失败；还原后全绿（避免「写了个自证式测试」）
- 实跑 `2026-09-15T03-43-08`：converged；combinedCount 97，siteAssets 7（2 个 `hm.gif` query 变体 + `/home/img/` 下 3 个 + `icon-192` + `detail.html`），download 90 全 skip / 0 failed；首轮 gallery 记录 `officialTotal 1001`、`firstRun true`
- **过滤生效的直接证据**：6 个杂项文件已从磁盘删除，该轮结束后 `images/` 仍是 1001 个文件、杂项一个都没回来，而其余 90 个 URL 全部被重新尝试（否则会以 `ok` 重新落盘）
- 提交前跑了双轴自审（standards / spec 两个独立子 agent），列出的问题全部采纳并修复：`CONTEXT-MAP.md` 同步、`IMAGE_EXTENSIONS` 真正统一到一处、ADR 0005 那句与首轮数据不符的承诺、「Images captured / Wallpapers found」标签、两道过滤的交代

**教训**：
- 「资源已爬完」是**可被证伪的结论**，写进文档必须附日期与当时的数字，不能当永久事实——09-04 的 971 全量结论 10 天后就被 09-07 批次推翻
- 单轮数字（`combinedCount`）回答不了「官网一共有多少」；累计量必须显式持久化。跨轮记忆与 ADR 0002 所否决的「同一轮数据的重复表示」是两件事，别一并否掉
- 清理杂项要「**先标记再删**」：只删文件不加规则，下一轮就原样下回来。删除是清场，规则才是不复发的保证
- 黑名单优于白名单，当「误伤」比「多下」更贵时——白名单的失效模式是静默丢数据

---

### 2026-09-15 — 测试移出 src（tests/ 镜像 + vitest include 护栏）

**触因**：3 个测试文件与源文件同目录（417 行，占 src 下 TS 的 28%）；「src = 产品代码」这条边界在目录上不可见，只在人心里。

**决策**（grill 两轮，全部按推荐）：
- **仓根 `tests/` 镜像 src**：`tests/wallpaper-url.test.ts`、`tests/report/{report,gallery}.test.ts`，import 改用相对路径且带 `.js`（ADR 0003）。否决 `src/**/__tests__/`——src 里仍有测试，边界没画出来；否决维持同目录
- **tsconfig**：删 `rootDir`（无 emit/build 脚本消费者，实际已废弃）+ `include` 加 `tests/**/*` 与 `vitest.config.ts`。两条失败模式均已实测：只加 include 不删 rootDir → `TS6059 not under rootDir`；不把测试加进 include → ESLint type-aware 报 `not found by the project service` 解析错误。`eslint.config.mjs` 无需改动
- **新增 `vitest.config.ts`**（`test.include: ['tests/**/*.test.ts']`）：把「测试只住 `tests/`」从约定变成**配置层强制**。护栏实测有效——往 `src/` 丢一个 `.test.ts`，vitest 仍只报 3 files / 33 tests
- 本次只动测试（gallery 归属、CI、`lint`/`typecheck` 脚本另开账）；纯移动零逻辑改动 → **不真跑**爬虫，按 09-04 同类先例只跑三件套
- 文档：AGENTS.md 架构树拆成 `src/` 与 `tests/` 两块、CONTEXT-MAP 三处 `(+ tests)` 去掉（测试位置是文件布局事实，归 AGENTS.md 而非领域表）、CLAUDE.md 去重为 `@AGENTS.md` 指针；不写 ADR（可回滚、非惊讶、无僵化收益）

**验证**：`npx tsc --noEmit` 零错误；`npm test` 33 passed（与基线同数）；`npx eslint .` 零错误；`git diff -M` 三个文件均识别为 rename（相似度 97/98/99%，改动仅限 import 路径行）。**未真跑爬虫**：理由见上；本类改动不触碰 `run_report` 的键集合与语义，故验证规范里的 **Run parity 不适用**（那条针对会改 run_report 的迁移）。

**教训**：移动文件后 import 深度要按**新位置**数，不能按旧位置想当然——`tests/report/x.test.ts` 到 `src/` 是 `../../`，第一版写成 `../` 被 tsc 当场抓住（这就是边做边跑 typecheck 的价值）；目录约定若不落到配置层强制（vitest include），半年后必然被人放回去。

---

### 2026-09-15 — 工具链换代：oxlint 取代 eslint + simple-git-hooks + CI

**触因**：eslint（10）+ `@antfu/eslint-config`（9）在本仓是纯开销：type-aware 慢、配置只为这一个仓服务；钩子还是手写的 shell `.githooks/pre-commit`（只查分支、不查代码）；仓里没有任何 workflow，PR 没有自动门禁。用户要求：换 oxlint、上 simple-git-hooks、补 CI、删掉 `.githooks`。

**决策**（grill 一轮 8 题，全部按推荐）：
- **lint：eslint → oxlint 1.82**（`oxlint --type-aware .`，type-aware 由 `oxlint-tsgolint` 7.0.2001 提供）。`.oxlintrc.json` = `correctness: error` + `suspicious: warn` + `oxc / typescript / unicorn / import / node / promise / vitest` 插件；只有两处用配置豁免而非改代码：`eqeqeq` 允许 `!= null`（本意就是同时吃 null 与 undefined）、`import/no-unassigned-import` 允许 `dotenv/config`（副作用导入）。否决「eslint 并存一段时间」——两套规则互相打架。
- **钩子：simple-git-hooks 接管，`.githooks/` 删除**。分支门禁的逻辑搬进 `scripts/check-branch.mjs`（原 shell 钩子的等价物：拦 `main` / `master` / detached HEAD），作为 pre-commit 第一步，之后接 `lint-staged`（`oxlint --fix --deny-warnings`）；pre-push = `typecheck && test`。否决「只留 lint-staged、放弃门禁」——`AGENTS.md` 明写这条是 "enforced, not just asked"；否决「两套钩子并存」——机制重复且 `core.hooksPath` 会让 simple-git-hooks 静默失效。
- **npm → pnpm 12.3.4**（删 `package-lock.json`，加 `packageManager` + `engines.node >=22.22.1`）。理由：工作区所有兄弟仓都是 pnpm，且 CI 的参考实现（toolbox）与 `sxzz/workflows` 都按 pnpm 设计。
- **CI：手写 `.github/workflows/ci.yml`**（`pnpm/setup@v2` + `runtime: node@24` + `cache` + `require-lockfile`，跑 lint → typecheck → test）。否决直接用 `sxzz/workflows` 的 `unit-test.yml` reusable：其 test job 会无条件跑 `pnpm run build`，本仓无 build 脚本，绕过要传 `build: ''` 这种 hack；30 行手写 CI 更可控、可读。
- **顺手修掉 oxlint 报出的真问题**（不是补规则，具体行为差异见下方「行为差异」）：`main.ts` 4 处不安全类型断言改成运行时校验（`errorMessage()` 收窄、`window.__wpUrls` / `__wpLog` 的 JSON 加数组+字符串校验）、`wallpaper-url.ts` 的 `matchesRule` 补 `never` 穷尽守卫、`download.ts` 的 `_cachedCookieHeader` 去掉下划线前缀、`report.ts` 的 `.sort()` → `.toSorted()`（`lib` 提到 ES2023）。自审后又补了 `parseStats` 的逐字段校验（`numberOr` / `booleanOr` / `isRecord`）与 `parseJsonPayload`（三处重复的双层 `JSON.parse` 收成一个），因为原先还留着一处 `as Partial<DiscoveryStats>`——它不在 oxlint 的报错里，但会让脏数据直接进 `run_report.discovery`。
- **oxlint 忽略名单只放 `scripts/run-discovery.js`**（不是整个 `scripts/`）：自审指出新写的 `scripts/check-branch.mjs` 被误伤；实测 type-aware 对它是干净通过的。（**2026-09-15 晚更正**：当时写的理由是“它不在 tsconfig 的 `include` 里，纳入需先开 `allowJs`”——真正的原因比这硬：它是 playwright-cli 的协议载荷，详见下一条；`allowJs` 只是当时以为的前置条件。）
- **oxfmt 全量重排留到单独一轮**：实测 `oxfmt --check` 报 21 个文件里 16 个要改；其中 `src` + `tests` 共 11 个文件 +237/-169 行，`scripts/run-discovery.js`（无 lint、无类型、无测试的浏览器脚本）一个文件就 +189/-140。一次性重排会淹没本轮真正的逻辑改动。
- 加 `.editorconfig`（当时仅编辑器默认：UTF-8 / 2 空格 / 末行换行；**当晚已补上 `end_of_line = lf`**）与 `.vscode/extensions.json`（`oxc.oxc-vscode`）；`TRASH.md` 写进 `.gitignore`（本地保留、永不提交）。
- **行尾：本轮的这个结论是错的，已更正。** 本条目初版说「git 历史存的就是 CRLF」并据此把 `.gitattributes` 从 PR #12 里拿出去——那是**测量事故**：`git cat-file` 打印 blob 时会跑 smudge 过滤器，而当时用来判断的 `grep -c $'\r'` 在这个 shell 里静默退化成「数行数」（对 LF 文件也返回行数，两堆文件报出的数字其实都是行数）。用 `git cat-file --batch-check='%(objectsize)'` 与文件实际字节数对比后，真相是本仓**一直存 LF**（blob 比 CRLF 工作区小约每行 1 字节），`git ls-files --eol` 报的 `i/lf` 才是对的；PR #12 里那句 AGENTS.md Gotcha 和开放问题描述因此都是错的，均已改成正确版 + 正确测量方法。

**行为差异**（本轮唯一不是「配置搬运」的部分，逐条列出供真跑时对账；均只影响畸形输入，正常 payload 下逐字节等价）：
- `window.__wpUrls`：非数组 payload 以前会当作数组继续用（`.length` 为 `undefined`），现在归为 `[]`；数组里的非字符串元素现在被过滤掉。
- `window.__wpLog`：同上，且逐条要求 `msg` 为字符串。
- `window.__wpStats`：以前是 `{ ...fallback, ...parsed }`（脏值直入 + 多余键透传），现在逐字段校验（非 number / 非 boolean / `NaN` → fallback），**多余键不再进 report**。
- `.sort()` → `.toSorted()`：少了原地改动，排序结果相同。
- `_cachedCookieHeader` 重命名：纯内部符号。

**验证**：`pnpm typecheck` 零错误；`pnpm test` 33 passed（与基线同数）；`pnpm lint` 零 error 零 warning（`--deny-warnings` 全仓退 0），并用 `oxlint --debug files .` 确认真的 lint 了 13 个文件（不是空跑）；`pnpm install` 退出 0，`--frozen-lockfile` 报 "Lockfile passes supply-chain policies"；**门禁“真会拦”也验了**——拿一个含 `debugger` 的文件试：`pnpm lint` 退 1、pre-commit 被 lint-staged 拦下；再拿一个 floating promise 试，type-aware 规则确实报错（证明 tsgolint 真的接上了）；**钩子实做演练**——把 `scripts/check-branch.mjs` 拿到临时仓里对三种真实 git 状态各跑一次（`main` → 拒；detached HEAD → 拒；feature 分支 → 通过），再在真仓里走一次真提交，看到 guard 先跑、lint-staged 对 staged 文件跑 `oxlint --fix`。CI 在 PR #12 上真实跑绿。

提交前跑了双轴自审（standards / spec 两个独立子 agent，延续 09-15 先例）：standards 轴指出 `parseStats` 残留 `as` 断言、三处重复的双层 `JSON.parse`、`scripts/check-branch.mjs` 被忽略名单误伤，均已采纳修复；spec 轴指出 `.gitignore` 里 `TRASH.md` 写重复与 HISTORY 里 oxfmt 实测数字自相矛盾（已修正），并把「工具链轮里改了运行时代码」列为已声明的范围偏移。

**真跑（合并后的 main，`runId 2026-09-15T04-56-21`，265s）**：`converged: true`、6 轮稳定、idle 65s、`combinedCount` 187（上轮 97，属页面视图波动不是回退）、`thumbnailsClicked` 43；`siteAssets` 7；download 180 个全部 Content-hash skip（`ok: 0` / `failed: 0`，即 runbook 说的 successRate: 0 属设计）；`gallery.officialTotal` 1001 = `previousOfficialTotal` 1001、`newSinceLastRun` 0（官网无新图），`firstRun` 转 false（状态文件连续）；`defects` 仅 `discoveryLeak = 1`，URL 是页面自身 `detail.html` —— 按 AGENTS.md 判定**良性、接受，不重跑**。

**契约对账（轻量版 Run parity）**：新旧 `run_report` 的顶层 / `discovery` / `download` 三处键集合逐字一致，`run_meta` 配置快照逐字段相同（无配置漂移）；磁盘仍是 1001 个文件，那 7 个 Site asset（`1.png` / `BG2.png` / `hm.gif` 的 2 个 query 变体 / `Vinyl record.png` / `icon-192_*` / `detail.html`）一个都没回到 `images/`。因此上面「行为差异」清单里那几条只在畸形输入下成立，正常路径逐字节等价——**这是真跑背书，不是推设**。

**教训**：
- linter 换代是「新规则重新审旧代码」的机会：首轮 10 条诊断里 6 条是真缺陷，只有 2 条该用配置豁免；一律 `off` 掉报错规则等于白换工具。
- 钩子机制换代必须检查 `core.hooksPath`：旧值指向已删除目录时 git **静默跳过**所有钩子，「钩子装了」和「钩子生效」是两件事，只能用一次真提交演练来证明。
- 工具链的隐藏门禁来自包管理器默认值：pnpm 12 会拒绝 24h 内发布的版本（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）、并要求 `allowBuilds` 白名单（否则 `ERR_PNPM_IGNORED_BUILDS` 直接非零退出）。应对是 pin 前一版 + 写白名单，而不是放宽策略。
- 格式化工具的全量重排要单独记账：它重写的是「人手工调过的风格」和「没有测试保护的脚本」，混在其它改动里既难 review 也难回滚。
- 「行尾是不是 LF」不能用会跑过滤器的命令去量：`git cat-file` 打印 blob 时会 smudge（把 LF 显示成 CRLF），而 `grep -c $'\r'` 在 Windows 的 git-bash 里对 `$'\r'` 静默失效、退化成数行数——两个错误叠起来让整个仓看起来都是 CRLF，我据此把错误结论写进了仓库文档。可靠的量法只有一个：比**字节数**（`git cat-file --batch-check='%(objectsize)'` vs `wc -c`）。教训是**先用已知样本校准量具**：只要拿一个 LF 文件和一个 CRLF 文件试一下，这个量具当场就露馅了。

---

### 2026-09-15 — oxfmt 接入 + 行尾钉到 LF（含一次差点上线的格式化事故）

**触因**：上一轮把 oxfmt 推迟了（实测 21 个文件里 16 个要改），行尾政策也标为未决；用户要求把清单上的未完项做完。

**决策**：
- **行尾：先纠错再决策**。上一轮「历史存 CRLF」是量具故障（详见上一条），真相是历史一直存 LF。于是加 `.gitattributes`（`* text=auto eol=lf`）把 Windows 工作区也钉到 LF，并用 `git checkout-index -a -f` 刷新工作区；`git add --renormalize` 在这里是 no-op（索引早就是 LF），不要把它当成可以验证的工具。`.editorconfig` 也跟着写上 `end_of_line = lf`。
- **oxfmt 0.67**（0.68 发布未满 24h，被 pnpm 供应链策略挡下）+ `.oxfmtrc.json`：`semi: false` / `singleQuote: true` / `arrowParens: "avoid"`（对齐原 antfu 风格）/ `printWidth: 100` / `endOfLine: "lf"` / `sortImports: true`。`**/*.md` 与 `pnpm-lock.yaml` 暂不格式化。试过 `experimentalOperatorPosition: "start"`（能把运算符前移风格还原得更彻底），但它自标 experimental，拒了。
- **`scripts/run-discovery.js` 对两个工具都永久排除，并撤销了「把它纳入 lint」的原计划**。对 **oxfmt**：交给它以后文件以 `;async (page) => {` 开头，而 playwright-cli 是把文件包成 `(\n<内容>\n)(page);` 求值的 → `SyntaxError: Unexpected token ';'`。用 e2e 探针当场验证：带前导 `;` 的脚本报这个错、不带前导 `;` 的同文件能把 `window.__probe` 写成 `no-semi-ok`。也就是说这个格式化会静默弄死整个 Discovery（搜不到任何 URL，报告为 `emptyResult`）。对 **oxlint**：它不会弄死文件，但这个文件本身就是一个裸表达式语句，所以 `no-unused-expressions` 在第 1 行就是个**不可修复的 error**（实测：只读 lint 报 1 error + 5 warning，`oxlint --fix` 改了 0 字节但退 1）。而 lint-staged 跑的是 `--fix --deny-warnings`，那会让任何改动这个文件的提交恒被拦死；要绕过得加 disable 注释或规则豁免，对一个“本来就不允许被改写”的文件不值得。
- **补上一个 lint-staged 漏洞**（上一轮收窄忽略名单时引入的）：被忽略的文件被显式传给工具时，oxlint 退 1（No files found to lint）、oxfmt 退 2（Expected at least one target file）→ 一旦提交只涉及 `scripts/run-discovery.js`，pre-commit 就会把提交拦死。两边都加 `--no-error-on-unmatched-pattern`（两个工具都有这个 flag），并写进 lint-staged。
- oxfmt 进 lint-staged（提交时本地就格式化），CI 加 `Format` 步（`fmt:check`）。
- **本轮没做的两项分别是：`autofix.yml`（阻塞在人工安装 autofix.ci App，自动化做不了）与 CI 的 Windows job（上一轮就只是“可选建议”，本轮未纳入）；两者继续挂在开放问题里。** Markdown 格式化（`**/*.md`）也没做，因为它是对 300 行中文散文的单独决定。

**验证**：
- 四件套：`pnpm fmt:check` / `typecheck` / `lint`（`--deny-warnings` 全仓 0/0）/ `test`（33 passed）全绿。
- **AST 对比证明“只改了空白”**：逐文件比较 HEAD 与现在的语法树（忽略 import 顺序、忽略括号，import 声明逐字排序比较）：12 个被重排文件里 11 个结构完全一致，剩下 `download.ts` 只有一处 `'Referer':` → `Referer:`（无引号键名，同一个字符串）；`scripts/run-discovery.js` 未被改写。
- **提交演练**：只 stage 协议载荷文件（加一行注释）→ pre-commit 退 0 且文件字节不变（无前导 `;`、注释保留）；`node --check` 也过。
- 交付后真跑一次冒烟（格式化涉及 `main.ts` / `report.ts` / `download.ts`，虽然 AST 等价，但这是唯一能真正证明管线还活着的检查）：**已跑，干净**（`2026-09-15T05-15-31`，252s）——`converged`、6 轮、idle 55s、`combinedCount` 172、`siteAssets` 7、download 165 全 skip / 0 failed、`gallery.officialTotal` 1001 = `previousOfficialTotal`（`newSinceLastRun` 0）、`defects` 仅良性 `discoveryLeak`（页面自身 `detail.html`，接受不重跑）；`run_report` 键集合与上一轮一致，磁盘仍 1001 个文件。这一跑也就是那个前导分号坑的反证：若 run-code 载荷被格式化弄坏，这里会是 `emptyResult` + `combinedCount` 近 0。

**教训**：
- 格式化不是“纯白”操作：当被格式化的文件本身是一个**协议载荷**时，formatter 的“安全”预处理（在裸表达式前插 `;`）恰好会弄死它。凡是被别的进程当作源码/表达式消费的文件（`--filename` 脚本、模板、eval 字符串），先查清消费方式，再决定是否允许格式化。
- 同一件事在“会被改写”与“只是被检查”两种模式下结论可能不同，但都要有实测：oxfmt 是改一下就坏（已证）；oxlint 是只读就先报不可修复的 error（已证）——两个排除各有各的证据，不要用“同理”代替实测。
- 工具“忽略名单”与“显式传路径”是两套语义：忽略只影响遍历，不影响显式传入时的非零退出。所以收窄忽略名单时，必须同步检查 lint-staged 这类“显式传文件”的调用方，并用一次真提交演练证明。
- 真跑的价值不可替代：AST 等价、单测全绿、`node --check` 通过——这些都拦不住上面那个前导分号的坑，只有“实际跑一次管线”或“实际跑一次那个被包装的执行路径”能拦住。
- **改完一个事实要把它的旧副本一并删掉**：本轮把行尾结论从“CRLF”改成“LF”时只加了新节、忘了删旧节，结果同一个 `AGENTS.md` 里两段自相矛盾（评审当场拓到）——这正是本文档自己记过的失败模式：单一事实源靠的是“旧副本也被清掉”，不是“新副本写对”。

---

### 2026-09-15 晚 — 官方清单成为唯一真源（ADR 0006 / 过滤器并轨 / 一次探针证伪两个前提）

**触因**：用户要求重新评审 09-15 那轮的两个功能（Site asset 过滤 + 官方总数跨轮追踪），理由是那是没走完整工作流的产物。方式是三轮 grill（每轮先自己查事实再问决策，全部按推荐落地）+ 一次受控探针。

**探针（subagent 执行，独立 session，未碰 `bluepoch` 会话，未下载）**：
- `POST https://re.bluepoch.com/activity/official/websites/picture/query`（body `{"current":1,"pageSize":2000}`，GET 亦可）→ `data.total` = 1001 + 完整 `pageData[]`（`id` / `title` / `pictureUrl`），**无需任何 cookie**。
- 该清单 1001 个 `pictureUrl` 的 basename 与 `images/` 的 1001 个文件**完全相等**（API 独有 0、磁盘独有 0）——镜像本来就是完整的，旧实现那个 `officialTotal: 1001` 是“数文件”蒙对的。
- CDN 侧匿名抽样 12 个 URL（跳 12 个批次）全部 206，下载同样不需要登录态。
- 页面 DOM 里不展示总数；`window` 里也没有完整清单（`imgArr` 只存当前 15 条，`paperData` 是 9 条诱饵数组）。清单只存在于那个网络响应里，而我们的捕获只收 `content-type: image/*`，所以一直看不到它。

**决策**（三轮 grill，全部按推荐）：
- **分阶段**：本轮只做 (A)「接口取数 + 精确校验」，但客户端按 (C)「整体坍缩成接口客户端 + 下载器」的形状做接缝，并新增 `discovery.coverage` 作为 (C) 的立项门槛；(C) 单独一轮、单独 ADR。
- **ADR 0006 取代 ADR 0005**：官方总数 = 清单的 `data.total`（**可以下降**），新增 = 清单 `id` 集合差（按 id 不按文件名），镜像双向对账 `missingFromDisk` / `extraOnDisk`；状态改存 id 集合于 `images/.gallery-state.json`（与它描述的镜像同生共死）。接口不可用时 `officialTotal: null` + defect `gallerySourceUnavailable`，**绝不退回数文件**。
- **首轮不再撕谎**：`newSinceLastRun: null`（不是 0）+ `firstRun: true`。
- **误杀用真值判**：丢掉却在清单里 = `siteAssetFalsePositive`；结构化「画廊家族」判据不做。
- **过滤器并轨**：`shouldKeep` 只剩 `data:`/`blob:`，23 个 UI 图标文件名 + SVG 归入 `src/wallpaper-url.ts`（新增 `filenameIn` 规则，规则类型收成判别联合），于是 `combinedCount` 真的是原始捕获，ADR 0004 那句假话变真。
- **词表搬家**：Gallery tracking 成为独立上下文（CONTEXT.md 新增一节、CONTEXT-MAP 更新）；`isWallpaperFile` 从 `report/gallery.ts` 迁入 `wallpaper-url.ts`（之前它自己写了一份，与「唯一词汇表」矛盾）。
- **删除 TRASH.md**（本地、已过期、在 `.gitignore` 里）。

**纠错（重要）**：评审开头我拿**文件名前导数字**当官网编号，得出“官网编号到 1012、我们只有 937 个、75 个从未捕获”并写进了第一轮。拿到清单后实测：真实 id 空间是 `6..1012 去掉 {191,192,445,537,589,695}`，共 1001 条；而 1001 条里有 **625 条** filename 前导数字 ≠ id（id 6..20 的 title 甚至是 null）。量具错了，整条结论作废。

**验证**：
- 四件套全绿：`pnpm fmt:check` / `lint`（`--deny-warnings` 0/0）/ `typecheck` / `test`（45 passed，新增 `tests/gallery/*` 15 个用例）。
- **突变测试**（本仓先例）：打断 `parseGalleryList` 的完整性守卫、把 `newSinceLastRun` 写死 0、把 `missingFromDisk` 写成空数组 → 3 个用例精准变红，还原后全绿。
- **真跑**（`2026-09-15T08-48-00`）：`converged`、6 轮稳定、idle 55s、`networkCount` 483 / `domCount` 480 / **`combinedCount` 484**（上一轮 172——多出来的就是并轨后首次进入捕获的图标 URL）、`thumbnailsClicked` 75、discovery 297s。
  - `siteAssets` **34**（上一轮 7）：原来被 `shouldKeep` 悄悄丢掉的那批 UI 图标现在逐条可见（`/home/img/` 下的 pagenation / music / paperDetail / statement / mobile 等）。
  - download 450 全 skip / 0 failed；磁盘仍 1001 个文件且**全是 jpg/jpeg**（无杂项）。
  - `gallery.officialTotal` **1001**（来自接口），`firstRun: true` + `newSinceLastRun: null`；**`mirror.missingFromDisk` 0、`extraOnDisk` 0**——镜像与官方清单逐条一致。
  - `defects`：`siteAssetFalsePositive` 0、`gallerySourceUnavailable: false`、`mirrorGap` {missing:0,extra:0}、`discoveryLeak` 仍是良性的 `detail.html`。
  - **`discovery.coverage` = 0.4496**：单轮只覆盖官方清单的 45%，而接口是 100%/160ms——这就是 (C) 要的数据。
  - 状态文件 `images/.gallery-state.json` 落盘（9035 B，1001 个 id，6..1012）；旧的 `logs/gallery-state.json` 已删。
  - **Run parity 对账（对 `2026-09-15T05-15-31`）**：`discovery` +`coverage`；`gallery` −`previousOfficialTotal`/`updatedAt`/`runId`、+`newFiles`/`mirror`；`defects` +`siteAssetFalsePositive`/`gallerySourceUnavailable`/`mirrorGap`；`download`/`failures`/`siteAssets` 键集合不变。即：除了声明过的契约变化，没有别的变化。
- **双轴自审**（standards / spec 两个独立子 agent，提交后跑）报出 2 条 P1 + 6 条 P2，已全部处理：
  - P1（spec）：“id 集合永不自动遗忘”没做到——`mergeGalleryStats` 直接用当前清单覆盖 `ids`。已改为与上一轮求并集，并加用例（下架再上架的条目不会被重复报成新增）。
  - P1（spec）：Run parity 对账没进记录——上方已补。
  - P2：`officialNamesOf()` 收掉 `main.ts` 与 `gallery-state.ts` 两处重复的名单集合；`falsePositivesAmong()` 把原本写在 `main.ts` 里、没有被测试覆盖的误杀判据提成纯函数 + 用例；清单不可用时 `siteAssetFalsePositive` 由 `0` 改 `null`（“没检查”不等于“没问题”，与 `mirrorGap` 一致）；`finishRun` 的三个捕获参数收成 `CaptureAudit`；`describeRule` 补 `never` 穷尽守卫（否则将来加 rule kind 会往 run_meta 里写 `kind:undefined`）；`GalleryEntry.title` 删除（1001 条里 225 条为 null、625 条与 id 不符，不可信）；未被消费的 `pageSize` 选项去掉；`.gitignore` 里 TRASH.md 的规则删除；CONTEXT/CONTEXT-MAP 里的“何时取清单”表述改正（只取一次，在 discovery 阶段）。
  - 突变补测：把 id 集合改回覆盖、把误杀判据写死返回空数组 → 3 个用例精准变红，还原后全绿。
  - 迁移准确性核验：`git show main:scripts/run-discovery.js` 里那 23 个图标名与 `filenameIn` 的值集合**逐条相同**（无多无少）。
- 协议载荷复查：`scripts/run-discovery.js` 仍是裸 `async (page) => {...}` 表达式，`node --check` 通过、包一层括号能求值（前导分号坑的反证）。

**教训**：
- **代理指标的失效是静默的，而且会互相污染**：`officialTotal` 数文件 + 单调 `max`，于是“删了文件”和“杂项漏进 `images/`”都会让 delta 永久变 0 或虚高，而它名字里写着 official。选代理指标时先问：错误方向可不可见？
- **量具错了比结论错了更贵**：文件名前导数字与接口 id 是两套编号，我用前者推出了涉及 75 个“缺失”的结论。凡是要写进文档的数字，先用一个已知事实校准量具（这里是清单的总数）。
- **前提被证伪时，替代方案的成本结构会整体改变**：官方总数这个功能的前提是“单轮数不出总数”。一个匿名 POST 就能拿到全部，于是旧实现的全部复杂度（状态文件、单调 max、首轮反推）都是在为那个不存在的前提付费。
- **“没人需要用浏览器”这种事只有实测算数**：CDN 匿名 206、接口匿名 200，都是 30 秒 curl 能验的，而项目为此维护了 Playwright、会话、滚动稳定性循环，以及两条“协议载荷不许被格式化/lint”的约束。

---

### 2026-09-15 深夜 — 审计轨迹改为主线程同步写（logger.ts / ADR 0007）

**触因**：`2026-09-15T09-36-50` 那轮跑完退 0，JSONL 却只有 48 条、**没有 `run_report`**（末行是 17:40:57.770 的 `Official list: 1001 entries`），而 `images/.gallery-state.json` 的 `updatedAt`（17:41:03.118Z）证明它跑到了 step 6，磁盘与官方清单也逐条对得上。根因在 `src/logger.ts`：**两个 target 都放在 pino transport（worker 线程）里**，worker 一旦停摆，主线程继续往死通道里写、退出码仍是 0。worker 为什么停摆**始终未查明**。

**决策**（grill 两轮，第一轮 8 题 + 第二轮 6 题，全部按推荐）：
- **文件 sink 移出 worker**：`pino.destination({ dest, sync: true })` + `pino.multistream`，`pino-pretty` 也从 transport 改成主线程流。全仓只有 logger 用 worker（`src/` 里除 `logger.ts` 外只有 `download.ts` 引 `Logger` 类型），所以修完**进程里不再有 thread-stream**——不是「缓解」，是**消除该类故障**。否决「保留 transport + `logger.flush()`」：worker 已死则无从 flush，只能缩短窗口
- **文件 sink 保持更低的 level（`debug`）**：pino 的 multistream 是裸循环、逐流 `stream.write()` 且**无 try/catch**（`node_modules/pino/lib/multistream.js`），而 `add()` 会把流按 level 排序（`compareByLevel`）——**构造顺序是装饰不是机制**，真正让 Run log 先写的是它 level 最低；把文件 level 提到控制台之上就会反过来。控制台流抛异常会吃掉本该给文件的那条记录
- **不加 `fsync`**：本类故障是进程/worker 停摆，`sync: true`（写进内核缓冲）已覆盖；`fsync: true` 多防的是断电，而本轮 269 条记录每条都要付一次真 fsync。留给「断电也不能丢」的未来需求
- **不加事后回读自检**：sync 写失败会在调用点抛（实测：对只读 fd 写 → `EBADF` 从 `log.info()` 抛出），`main().catch` 已经会 `Fatal:` + 非零退出；回读只是在验证 pino 自身
- **不加测试缝**：`createLogger(logDir)` 签名不动（改签名会连带 `main.ts` 三处 `ReturnType<typeof createLogger>`），测试只打在「文件已落盘」这个可观测 seam 上
- **词表与文档**：CONTEXT.md 新增 **`Run log`**（Diagnostics 里一直缺「装 `run_meta`/`run_report` 的那个文件」这条词，而 `AGENTS.md`/`SKILL.md` 已在用 `the log tail`/`audit trail`/`log defect` 三个非正式说法）；ADR 0007 记录决策 + 否决项 + 事故数字 + 「根因未知但已被结构性排除」；`AGENTS.md` 加 Gotcha、架构树与测试树更新；`SKILL.md` 的「没有 `run_report`」陷阱**保留但改掉因果**（进程被杀一样会缺，操作步骤不变）

**验证**：
- TDD 先红后绿：`tests/logger.test.ts` 三个用例——①记录在 `logger.x()` 返回时就已落盘；②文件仍是裸 JSONL（一行一个带 pino 信封的 JSON 对象，ADR 0002 的契约）；③debug 记录同样进 Run log。**红得很彻底**：旧 transport 实现下连日志文件都还没建（读取报「wrote no Run log」），即「文件是否存在」本身都曾取决于 worker
- **突变测试有牙**：文件流 level `debug`→`info` → 只有③红；文件流换成 pretty 流 → ②③红；`sync: true`→`false` → ①红
- 四件套全绿：`pnpm fmt:check` / `lint`（`--deny-warnings` 0/0）/ `typecheck` / `test`（53 passed，基线 50 + 新增 3）
- **真跑**（`2026-09-15T10-01-39`，262s = `durationMs` 261553，10:01:39.841 → 10:06:01.394）：`run_report` **存在**，JSONL **269 条**（对照丢失那轮的 48 条），且尾部完整——`4. Extracting cookies...` 之后的下载记录、汇总与报告全部落盘，即「活过了最长的 `execSync` 段」；`converged: true`、6 轮稳定、`combinedCount` 214、`siteAssets` 34、`discovery.coverage` 0.1798；`gallery.officialTotal` 1001 / `newSinceLastRun` 0 / `firstRun` false / `mirror` {missing 0, extra 0}；download 180 全 skip / 0 failed（`successRate: 0` 是全 skip 语义）；`defects` 仅良性 `discoveryLeak`（页面自身 `detail.html`，接受不重跑）；磁盘仍 1001 个文件，状态文件 `runId` = 该轮
- **Run parity（对 `2026-09-15T08-48-00`，同代基线）**：`run_report` 的顶层 / `discovery` / `download` / `gallery` / `defects` / `siteAssets` / `failures` 键集合**逐字一致**，`run_meta` 配置快照逐字段相同（无配置漂移）。对 `2026-09-15T05-15-31` 的差异恰好是 ADR 0006 已声明的契约变化（`discovery`+`coverage`、`gallery`−`previousOfficialTotal`/`updatedAt`/`runId` +`newFiles`/`mirror`、`defects` +3 键），与本次改动无关

**教训**：
- **「报告缺失」的原话把未知根因写成了已知机制**：文档当时写「pino transport 的写侧可以停摆」，这句话本身没错，但它让人以为根因已明。修完必须把因果那半句一并改掉，否则下一个人会照它去查一个已经被拆掉的 worker
- **排错先分清「Run 失败」与「日志失败」**：退出码无法区分二者，`images/.gallery-state.json` 的 `runId`/`updatedAt` 是当时唯一能分开它们的独立证据（`SKILL.md` 的操作步骤因此保留）
- **测试只能打在你真能观察到的那个 seam 上**：pino-pretty 13 的「流」是直接写 **fd 1**（`buildSafeSonicBoom({ dest: opts.destination || 1 })`），**不经过 `process.stdout.write`**，所以「控制台只出 info+」这一半在单测里根本观察不到——原计划用 `vi.spyOn(process.stdout, 'write')` 是错的（跑出来是空数组）。改成「Run log 是裸 JSONL」既在同一 seam 上，又守住了 ADR 0002 的契约，比原来那条还有价值
- **同步写的失败是响的，这件事值得实测**：sonic-boom sync 路径把 `fs.writeSync` 的失败走 `emit('error')`，而 `buildSafeSonicBoom` 对非 EPIPE 无监听者时重新抛出 ⇒ 错误直接在 `logger.x()` 调用点抛出。所以「fail loudly」是**免费**的，不需要额外写错误处理
- **「为什么这样写」的断言必须能被一行源码证实**：我原先在注释/AGENTS.md/ADR 里都写「文件流排在 `multistream` 第一位」，而 pino 的 `add()` 是 `streams.unshift(dest_); streams.sort(compareByLevel)`——构造顺序根本不起作用，真正起作用的是文件 sink 的 level 更低。这是**自审（standards 轴）拿源码直接推翻**的：机制类断言不能凭直觉写，写完要去看那一行

---

## 已否决方案速查（改动前先看这里）

| 方案 | 否决原因 | 出处 |
|------|---------|------|
| NestJS / HTTP 框架模块化 | CLI 脚本项目无路由/API/DB，杀鸡用牛刀 | 2026-06-15 |
| 多站点框架（Scrapy 式）/ 工具库 | 单一抓取目标，简单优先 | 2026-06-15 |
| `extractNetworkImageUrls` 修复 | 2 张 vs DOM 172 张，不工作比删除更应删除 | 2026-06-17 |
| `waitForLoadState("networkidle")` 各处等待 | 懒加载页面不可靠：JS init 完即 idle，懒加载未必触发 | 2026-06-18 |
| 固定时间阈值的稳定判定 | 15s 在慢网系统性提前截断 | 2026-06-18 |
| 队列轮询 DOM 计数判稳定 | SPA 卸载已浏览元素，永不收敛 | 2026-06-14 / 架构基线 |
| run-code 用 console.log 汇报 | playwright-cli 吞 Node 侧 stdout | 2026-06-17 |
| 独立 report.json/.md | 与 JSONL run_report 双份事实源漂移 | ADR 0002 |
| ts-node ESM / bundler resolution | 与 ESM+tsx 比语义不纯 | ADR 0003 |
| skill Preflight 探测 session | 管线自管 session，探测必报 not open | 2026-09-03 |
| 测试与源文件同目录 / `src/**/__tests__/` | 「src = 产品代码」的边界在目录上不可见，且无配置层护栏 | 2026-09-15 |
| 保留 `.githooks` 作为钩子后端 | 两套钩子体系并存，`core.hooksPath` 还会让 simple-git-hooks 静默失效 | 2026-09-15 |
| 在同一轮里并入 oxfmt 全量重排 | 12 文件 +280/-180，其中不可测的 `run-discovery.js` 占 +189/-140，diff 淹没逻辑改动 | 2026-09-15 |
| 放宽 pnpm 供应链策略（`minimumReleaseAge`）以装当日最新版 | 该策略挡的是「投毒版本 24h 窗口」，正确做法是 pin 前一版 | 2026-09-15 |
| 继续用 npm | 与工作区兄弟仓、`pnpm/setup@v2` CI、pnpm 化的 lint-staged 形态都不一致 | 2026-09-15 |
| 在同一个轮次里对 `scripts/run-discovery.js` 做格式化 / 自动修 | 它是 playwright-cli 的协议载荷（`(\n<file>\n)(page);`），formatter 会在裸表达式前插 `;` → `SyntaxError`，crawl 直接抓不到任何东西 | 2026-09-15 |
| 直接复用 `sxzz/workflows` 的 `unit-test.yml` | 其 test job 无条件跑 `pnpm run build`，本仓无 build 脚本 | 2026-09-15 |
| 继续用「磁盘文件数 + 单调 max」当官方总数 | 分不清「站点没上新」和「我们丢了文件」，且一次删除或一次杂项漏进就让 delta 永久为 0 | 2026-09-15 |
| 用文件名前导数字当官网编号 | 1001 条里 625 条与真实 id 不符，id 6–20 连 title 都没有（实测） | 2026-09-15 |
| 结构化「画廊家族」判据（`/PICTURE/` + 数字开头） | 有权威清单后属于多余的猜测；判据越少越不会自己出错 | 2026-09-15 |
| 只用接口取总数、其余照旧 | 头号数字诚实了，delta 还是错的 | 2026-09-15 |
| 在 Discovery 的网络捕获里收 `application/json` 清单 | 把权威数字绑在一次未必发生的渲染上，且一个捕获里混两种 content-type | 2026-09-15 |
| 把 Run log 的文件 target 留在 pino transport（worker 线程），只补 `logger.flush()` + error handler | `2026-09-15T09-36-50` 那轮 worker 停摆后主线程静默续跑、退 0 且丢光 `run_report`；`flush()` 只能缩窗，已死的 worker 无从 flush | ADR 0007 |

## 验证规范（所有迭代通用）

- 三件套：`pnpm typecheck` → `pnpm test`（vitest）→ `pnpm lint`（oxlint，含 type-aware）；格式化改动加 `pnpm fmt:check`，且大范围重排要做 **AST 对比**（忽略 import 顺序与括号）证明“只改了空白”
- 纯工具链/纯移动类改动不真跑，但要在 PR 里写明「没跑」
- 行为验证：真跑 `pnpm save-wallpapers`，读 `logs/` 最新 JSONL 的 `run_report`（收敛 / 成功率 / 缺陷自动判定）
- 迁移类任务追加 **Run parity**：新旧 run_report 键集合 + download/defects/failures 深比较

## 开放问题

- ~~**捕获量持续下滑（972 → 502 → 21）**~~ **2026-09-04 定性，2026-09-15 修正：该结论只在当时成立。** 09-04 的读数是「官网资源被爬完」：磁盘 971 文件、页面仅存 15 个缩略图、URL 止于 `20260729/976` 批次。09-15 复盘发现官网 09-07 批次已上新 36 张（977–1012），`npm run save-wallpapers` 重跑即自动捕获（幂等：已有走 Content-hash skip，新增下载），磁盘 971→1007 文件 / 1001 张壁纸。**以后不再人工判定「是否全量」——看 `run_report.gallery.officialTotal` 与 `newSinceLastRun`。**
- ~~**过滤逻辑分两道**~~ **已解决（2026-09-15 晚）**：`scripts/run-discovery.js` 的 `shouldKeep` 只剩 `data:`/`blob:`（它们不是可抓取的 URL），23 个 UI 图标文件名与 SVG 判定归入 `src/wallpaper-url.ts`（新增 `filenameIn` 规则）。`combinedCount` 因此真的是原始捕获——真跑实测 172 → 484，多出来的就是以前被静默丢掉的图标 URL，它们现在出现在 `siteAssets`（7 → 34）。
- **(C) 整体坍缩成「接口客户端 + 下载器」**：清单接口已能一次给出全部 1001 个 `pictureUrl`（ADR 0006），CDN 匿名抽样 12/12 也是 206——也就是说浏览器、会话、滚动稳定性循环、cookie 提取、Site asset 过滤、甚至 `@playwright/cli` 这个全局依赖都不再是必需的。**立项门槛是 `discovery.coverage`**：真跑实测单轮只覆盖官方清单的 **45%**，而接口是 100%/160ms。先让它跑几轮取数，再单独开一轮 + 单独一份 ADR，不要在功能评审里顺手做掉。
- **清单接口的稳定性未验证**：未公开文档，`pageSize` 上限、WAF/限流、`collectionId` 是否会随新合集变化都未知。失败模式是响的（`gallerySourceUnavailable` defect + `officialTotal: null`），但 `pageSize: 2000` 一旦被服务端悄悄截断，`parseGalleryList` 会直接拒收而不是把缺的那半报成「新增」。
- **镜像缺口只报警、不自动补**：`missingFromDisk` 现在能把缺的条目列出来，而清单里带着它们的 URL——自动补下是可行的（且不受 `images/` 文件名不含批次日期的限制），留给后续一轮。
- ~~**oxfmt 全量重排待做**~~ **已完成（2026-09-15 晚）**：`oxfmt 0.67` + `.oxfmtrc.json`（`semi: false` / `singleQuote: true` / `arrowParens: avoid` / `printWidth: 100` / `endOfLine: lf` / `sortImports: true`），`pnpm fmt:check` 进 CI；`**/*.md` 暂不格式化，`scripts/run-discovery.js` 永久排除（见 Gotchas）。
- ~~**行尾政策待定**~~ **已解决（2026-09-15 晚）**：本仓一直存 LF，`git ls-files --eol` 报的 `i/lf` 是对的；`git cat-file` 的 CRLF 读数是量具故障。已加 `.gitattributes`（`* text=auto eol=lf`）把 Windows 工作区也钉到 LF，并用 `git checkout-index -a -f` 把工作区刷新为 LF。
- ~~**`autofix.yml` 未接**~~ **已接（2026-09-15 晚）**：`.github/workflows/autofix.yml` 在 PR 上跑 `pnpm lint:fix && pnpm fmt`，再由 `autofix-ci/action@v1.3.4` 把结果提交回 PR 分支（App 已由用户安装）。之所以手写而不是用 `sxzz/workflows` 的 autofix reusable：它的默认命令只有 `pnpm run lint --fix`（不含格式化），且与 `ci.yml` 的 setup 写法保持一致更好读。注意：机器人会往你的分支推提交，改完先 `git pull`，别用 `--force-with-lease` 把它的提交打掉。
- **CI 只跑 ubuntu + node 24**：本仓在 Windows 上开发（`--filename` 那段正是 Windows 专属坑），若想覆盖，加一个 `windows-latest` job 跑 `typecheck` + `test` 即可；单测是纯逻辑，跨平台收益有限。
- ~~**跑完但日志整段丢失（`run_report` 缺失、进程仍退 0）**~~ **已解决（2026-09-15 深夜，ADR 0007）**：Run log 的文件 sink 改成不经 worker 的同步 destination，`pino-pretty` 也从 transport 改成主线程流，于是进程里不再有 thread-stream——「worker 停摆后主线程静默写进死通道」这一类故障被**结构性消除**，不是缓解。**根因仍然未知**：worker 当初为什么停摆始终没查明，只是它再也无法让报告消失。若将来再出现缺失的 `run_report`，按 `SKILL.md` 的步骤用 `images/.gallery-state.json` 与官方清单分账，不要假定是同一个原因。
- ~~**慢网行为待验证**~~ **已验证：修复工作正常。** 2026-09-04 修复后实跑确认 waitForList 触发、滚动探测持续推进、收敛正常；21 张是官网无新资源的真实反映，与慢网修复预期相符。慢网下不再因 idle>45 冻结滚动。