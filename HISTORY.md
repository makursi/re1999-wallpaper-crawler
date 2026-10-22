# HISTORY — 项目沿革与决策记录

> **读法**（也写进 AGENTS.md）：改动任何管线之前，先扫一遍对应迭代的条目，避免重走已被否决的方案。本文只记**为什么现在长这样**；现状事实（命令、架构、陷阱、词表）以 AGENTS.md / 两个层的源码（`core/`、`web/`）/ CONTEXT.md 为准，不在此重复。`docs/adr/` 与更早的条目是**当日**的决策记录，里面引的路径按那天的树写，不随搬家回改。
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
- `verbatimModuleSyntax: true` 编译期拦截类型误导入；删 declaration/outDir/sourceMap，`noEmit: true`（爬虫无构建需求，tsx 直跑）
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
- **tsconfig**：删 `rootDir`（爬虫无 emit/build 脚本消费者，实际已废弃）+ `include` 加 `tests/**/*` 与 `vitest.config.ts`。两条失败模式均已实测：只加 include 不删 rootDir → `TS6059 not under rootDir`；不把测试加进 include → ESLint type-aware 报 `not found by the project service` 解析错误。`eslint.config.mjs` 无需改动
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
- **CI：手写 `.github/workflows/ci.yml`**（`pnpm/setup@v2` + `runtime: node@24` + `cache` + `require-lockfile`，跑 lint → typecheck → test）。否决直接用 `sxzz/workflows` 的 `unit-test.yml` reusable：其 test job 会无条件跑 `pnpm run build`，当时本仓（爬虫）无 build 脚本，绕过要传 `build: ''` 这种 hack；30 行手写 CI 更可控、可读。（**2026-10-18 限定**：这条只对爬虫成立；Console 的页面即本仓第一个构建产物，见 ADR 0011。）
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

### 2026-10-18 — Runbook Preflight：把沙箱升级写成管线事实（首调就要，不靠失败发现）

**触因**：两次抓取会话都在 Run 开始前撞同一堵墙，各自重付一遍。2026-10-08 会话跑 `pnpm save-wallpapers`，在 esbuild 的 service 里死于 `spawn EPERM`（3 次工具调用）；2026-10-18 会话先撞 pnpm 的工作区外 store 锁，再撞同一堵墙，中间还试了 `node node_modules/tsx/dist/cli.mjs src/main.ts` 当作端到端绕行——那正是它当时引用的 harness 规则明文禁止的「retry another way」（5 次调用外加一次审批往返）。子代理给这次绕行找到了自洽的读法，但那是运气，不是流程。

**测量**（就地核对源码与既有实测，本轮**未重跑**爬虫）：
- `src/main.ts` 的 5 处 `execSync`（约 L52 / 383 / 399 / 453 / 474）**全部** `{ stdio: 'pipe' }`，tsx 的 esbuild service 也以管道 spawn；受限沙箱模式禁止命名管道，于是两者都以 `spawn EPERM` 死。这是**结构性**的：需要管道的是管线自己的子进程，换启动器绕不开。
- pnpm 可能另需工作区外的 store 操作锁 `%LOCALAPPDATA%\pnpm-store-operation-locks\all-stores.lock`，失败码 `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`（os error 5，access denied）——锁在仓库之外，所以「工作区写权限」不够。
- **已证死路**：`node src/main.ts` 走 Node 原生类型擦除（Node 24.18 实测）报 `ERR_MODULE_NOT_FOUND: .../src/wallpaper-url.js`——源码用 `.js` 后缀 import 兄弟模块，Node 不改写为 `.ts`。ADR 0003 的「ESM + tsx」因此维持不变，不要再拿实验重开。
- 后台 job 包装器对已完成的 Run **不报退出**：浏览器孙进程继承了 stdout 管道，job 长时间停在 `running`，而 Run 早已退出。（Run 步骤归 #27；此处只记「为什么现状长这样」。）

**决策**：
- `SKILL.md` 的 Preflight 把升级改写成**这条管线的事实**，而非泛泛的沙箱提醒：Run 的首个命令就需要完整沙箱访问；两个原因各自点名（管道捕获 / 工作区外 store 锁）；附一句可直接用作审批理由的成品句子，并按用户来话的语言给出（审批理由是给人看的）；明说「开局就开口要」而不是「失败后发现」；点明已知绕行全部无效、不要再试。
- Preflight **不再要求 agent 检查机器是否空闲**——那不是 agent 能建立的判据。改为**请用户**在 Run 期间别碰鼠标键盘，于是 `_Done when_` 变成 agent 自己就能确认的三件事：playwright-cli 可用、已请用户让机器静置、升级请求已备好。
- 范围：只改 Preflight + 本文件。`AGENTS.md` 归 #28，runbook 的 Run 步骤与 Verify/Reference 归 #27/#28，一律不碰。
- 否决「换启动器 / 换运行时来规避升级」：管道需求在管线自己的子进程里，与启动方式无关；`node node_modules/tsx/dist/cli.mjs` 还是同一个 tsx；原生类型擦除已被实测证伪。
- **推迟（非否决）**「把子进程输出重定向到工作区文件、彻底消掉审批」（spec 列为 out of scope）：技术上可行，但会动 Discovery/Download 内部，需独立决策记录；本轮只做文档。

**验证**：这是文档改动，spec 的 Testing Decisions 明写**没有测试缝**——没有自动化检查能断言一句话改变了 agent 行为——因此不写测试、不跑 `tdd`；证据就是改后的措辞逐条对上验收标准。可跑的守护检查 `node_modules\.bin\oxlint.cmd --type-aware .`（16 files / 185 rules，0 warning 0 error）与 `node_modules\.bin\tsc.cmd --noEmit`（0 错误）均绿；Markdown 不经 oxfmt，无格式化项。管线代码零改动，行为不变。

**教训**：
- 环境类阻碍要分清「这次不巧」与「结构使然」：`spawn EPERM` 看着像沙箱配置问题，实际由管线自己的 `stdio: 'pipe'` 决定——一旦定位到结构，升级就从「碰运气」变成「开局申请」。
- 已测量过的死路必须落进文档，否则每次会话都会用工具调用重新量一遍：原生类型擦除那条写清失败码与原因之后，就没有下一次实验。
- 判据必须是 agent 能自己建立的东西：把「机器是否空闲」写进 `_Done when_`，等于把不可验证的前提当完成标准；改成「已向用户提出请求」后，这一步才真的能结束。

---

### 2026-10-19 — Console 独立成层：web/（spec #39 / 票 #40）

**触因**：仓库是两个程序挤在一棵树里：爬虫产出 Mirror，Console 供人看。Console 的服务散在爬虫的 `src/` 里，页面却另有 `web/`，于是「同一个程序的两半」隔两棵树；页面的构建配置、类型检查程序和构建产物又和爬虫的挤在仓根。代价每次访问都付：任何「这个文件属于哪个程序」的问题都只能读 import 回答，不能靠看。

**决策**（spec #39 的实现决定 1–14；本轮只做 Console 那一半，`core/` 在下一票）：
- **边界**：Console 独占 `web/` 一棵树 —— `web/server/`（服务 + 唯一入口 `console.ts`）、`web/api-types.ts`（页面与服务共享的类型契约，提到层根，因为把它留在服务目录里等于宣称它是服务的私事）、`web/src/`（页面）、`web/index.html`，以及只有页面需要的工具：`web/vite.config.ts`、`web/tsconfig.web.json`。
- **两个锚点，互不推导**：仓根锚点仍是 `PROJECT_ROOT`（Run 的 cwd，`.env`/`node_modules`/`images/`/`logs/` 的家），入点模块深度不变所以它仍解析到仓根；web 层锚点由 `web/server/console.ts` 自己推（`path.resolve(import.meta.dirname, '..')` = `web/`），只有它知道层根，且**不**从 `PROJECT_ROOT` 反推（spec 决定 7）。层的产物随层：`web/dist/`（构建页面）、`web/.console-cache/`（缩略图缓存，仍在 Mirror 之外，ADR 0010）；一个 Run 写的数据（`images/`、`logs/`）留仓根，因为两层都读。
- **命名**：拒 `crawler/` / `scraper/` —— 词表明确回避这两个词（本程序不跟随链接），与领域模型矛盾的目录名会误导此后每一次 grep。
- **`scripts/` 原地不动**：run-code 载荷的排除在两个工具配置里按字面路径钉死，目录名又被 discovery-loader 指名，三种静默失败换不来本轮任何收益 —— 记为开放问题，不是本轮解决。
- **类型程序按目录列**：Node 程序 `tsconfig.json` 显式含 `web/server/**/*` 与 `web/api-types.ts`（没有任何测试 import 的入口因此不会悄悄掉出检查），页面程序 `web/tsconfig.web.json` 只含 `web/src/**` + `api-types.ts`；`typecheck` 变成 `tsc --noEmit && vue-tsc -p web/tsconfig.web.json`。
- **构建指向层配置**：`vite.config.ts` 移到 `web/`（`root` = 层根，`outDir` = `web/dist`），启动命令、`build:web`、`dev:web` 三者一致地写 `--config web/vite.config.ts`；CI 的 bundle gate 仍构建页面。
- **测试镜像源**：`tests/console/**` → `tests/web/server/**`，两个不是测试的 helper（`run-fixtures.ts`、`test-image.ts`）随所服务的测试一起搬；`vitest.config.ts` 的收集模式不用改。

**验证**：
- 四件套 + 打包全绿（改动后实测）：`pnpm typecheck` 0；`pnpm lint` 65 files / 218 rules，0 warning 0 error；`pnpm fmt:check` 76 files clean；`pnpm test` **25 files / 268 tests passed**（与基线逐数相同 —— 这是「只搬家」的直接证据）；`pnpm build:web` → `web/dist/index.html` + hashed assets。
- **Console 冒烟（真跑，跑前删掉 `web/dist` 以逼出进程内构建）**：`pnpm console --no-open` → 自己构建页面 → `Console: http://127.0.0.1:8791/?token=…`；`GET /?token` **200** 且页面里 2 条资源 URL 被改写成带 token，改写后的资源 **200**；`GET /api/status?token` **200** 真实数据（`runId 2026-10-18T01-03-31`、`state idle`、`mirrorCount 1013`、`officialTotal 1010`、`verdict explained` —— 活的清单接口答了 1010）；`GET /api/status`（无 token）**403**；`GET /api/nope?token` **404**；`GET /api/thumbnail/<真文件名>` **200** 且缓存落在 `web/.console-cache/thumbnails/`，仓根同名路径**不存在**；杀进程后端口释放。
- 没跑抓取 Run：本轮不改爬虫任何路径假设，跑一轮证明不了这次改动（spec 的 Testing Decisions 明写如此，PR 里也要写明）。也没有新测试缝 —— 这轮没有行为可断言，四个门 + 一次真冒烟就是全部证据。

**教训**：
- **「纯搬家」也需要一个会响的证据**：单测、lint、typecheck 都拦不住路径写错（`web/.console-cache` 与 `.console-cache` 的差别没有任何断言覆盖），只有真发一次缩略图请求能拦。
- **锚点的价值在于它只有一个来源**：web 层根从入点模块深度推出，所以入口搬到哪层、层根就跟到哪；若改成从仓根 `join` 出来，布局一变就静默指错地方 —— 这正是 spec 把「两个锚点互不推导」写成决定的原因。

---

### 2026-10-19 — 爬虫收进 core/，布局落定（spec #39 / 票 #41）

**触因**：上一票把 Console 挪出去之后，原来那棵树里剩下的就是爬虫自己 —— 但它仍叫 `src/`，也就是「不是 Console 的地方」；仓根答不出「哪个目录是爬虫」。

**决策**：
- `src/` → `core/`，子目录名与内容一字不动；仓根恰好两个源目录（`core/`、`web/`），第三个 `scripts/` 只是协议载荷 + 提交护栏，不是层。
- 一切指路的地方同一改到位：Console 的 import（`../../core/**`）、三个命令（`tsx core/main.ts`、`tsx core/check-run.ts`、`tsx web/server/console.ts`）、Node 类型程序（`core/**/*`、`web/server/**/*`、`web/api-types.ts`、`web/vite.config.ts` 按目录列，入口没有测试 import 也不会掉出去）、测试树（`tests/core/**`、`tests/web/server/**`）及其 import。
- **入口点是这条改动里唯一不会自己喊出来的路径**：Console 的启动器把 `mainEntry` 指到 `path.join(projectRoot, 'core', 'main.ts')` —— 这个文件不存在时，四个门一个都不会红（子进程起不来时页面照样报「已开始」）。所以本轮**实测该文件存在**，不靠推断。
- 文档同步：AGENTS.md 的架构块改成「两层、两目录」（它在此之前甚至没提过 Console）、测试树按 `tests/core/**` 重画、CONTEXT-MAP 的所有权清单与「Where things live」表、docs/agents/domain.md 的树、runbook 的命令（`tsx core/check-run.ts`）。
- **就地改了 run-code 载荷里的一句注释**（`src/wallpaper-url.ts` → `core/wallpaper-url.ts`）。这是对 AGENTS.md「改这个载荷要用真跑验证」的**有意识例外**：改的是注释字节，载荷仍是裸 `async (page) => {…}` 表达式，于是验证方式是**协议同构的解析**（把文件按 `(\n<内容>\n)` 包进 `new Function`，与 playwright-cli 的包装一致），不是跑一轮爬虫 —— 本轮**没有跑抓取 Run**（票面明写），所以这条例外的边界留在这里。
- 否决「本轮一并搬 `scripts/`」与「在仓根引入第三棵共享目录」：前者是三种静默失败换名字好看，后者是给一个读者做共享层（Console 是 Run 产物的读者，不是第二个库消费者）。`scripts/` 的去留写成开放问题。
- **日期记录不回改**：`docs/adr/**` 与更早的 HISTORY 条目里引的旧路径（`src/**`、`tests/console/**`、根 `dist/`）保持原样 —— 它们是**那天的树**，spec 明令不重写日期记录。现状由 AGENTS.md 与两层的源码给出，两处「读法」句（HISTORY 开头、AGENTS.md 的 Project history 段）都改成这么说的，免得读者把 ADR 里引的路径当成现行权威。本轮另修掉三处**不是日期记录**的旧路径：CI 注释里的 `src/config.ts`、两条测试注释里的 `tests/console/**` 与 `tests/report/**`。

**验证**：
- 四件套 + 打包全绿：`pnpm typecheck` 0；`pnpm lint` 0 warning 0 error；`pnpm fmt:check` clean；`pnpm test` **25 files / 268 tests passed**（与搬 `web/` 那轮逐数相同 —— 只搬家，测试一行没改语义）；`pnpm build:web` → `web/dist/`。
- **入口点实测存在**：`core/main.ts` 在 `mainEntry` 指的那个路径上（实测 `True`），Console 的启动器因此不会静默指向一个不存在的文件。
- **Console 冒烟在最终树上重跑**：`pnpm console --no-open` 自己构建页面 → 页面 200 且 2 条资源 URL 带 token、改写后的资源 200、`/api/status?token` 200 真实数据（`runId 2026-10-18T01-03-31`、`mirrorCount 1013`、`officialTotal 1010`）、无 token 403、未知路由 404、缩略图 200 且缓存落在 `web/.console-cache/thumbnails/`、杀进程后端口释放。
- 协议载荷：`node --check scripts/run-discovery.js` 通过；按包装方式 `(\n<内容>\n)` 做 `new Function` 解析通过（若被格式化插了前导 `;`，这里就是 `SyntaxError`）。
- 没跑抓取 Run：爬虫的路径假设未变（`core/config.ts` 仍是一层深，`PROJECT_ROOT` 仍解析到仓根），跑一轮证明不了这次改动；PR 里写明。
- **双轴自审**（standards / spec 两个独立子 agent，提交后跑）确认「读起来就是一次搬家」（10 个爬虫文件逐字节相同、57 个 rename、零新增/删除），并报出已全部处理的问题：三处非日期记录的旧路径、AGENTS.md 的 `core/` 树漏了 `core/run-log-file.ts`（测试树里却列了它的测试）、`tsconfig.json` 的 `exclude` 还写着根 `dist`、夹具的 `distDir` 不像生产（少了 `web/` 一层）、`realThumbnailSource(webRoot)` 的参数已无区分作用（去掉，直接用模块级 `WEB_ROOT`）；**载荷那条规则本身也改了**：AGENTS.md 现在写的是「按载荷被消费的方式验证」（包装后解析），并保留「改到表达式本身就要真跑」的强要求 —— 上一轮版本把「任何改动都要真跑」写成铁律，而它拦不住注释这类改动，于是规则与实际做法不一致。

**教训**：
- **不会失败的那一处才要特意验**：`mainEntry` 指错时没有任何门会红（页面照报「已开始」），所以它需要一次显式的存在性检查，而不是指望四个门兜底。
- 违反一条写在文档里的规则（「改载荷要真跑」）时，唯一站得住的做法是把**替代证据和它的适用边界**一起写进记录，而不是悄悄绕过或假装没违规。

---

### 2026-10-19 — 中文优先的本地壁纸图鉴:改名、双语、设计系统、字体(spec #43 / 票 #44–#49)

**触因**:仓库有两个受众、两个入口。agent 那一半(两条命令 + runbook + 日志契约)英文、有文档、有测试;人那一半——一个命令起本地页面看 Mirror——**53 条可见文案全是英文、0 条中文**,入口叫 `console`(与浏览器 devtools 撞名)且 README 从头到尾没提过它;页面没有设计系统(4 个 scoped style、`system-ui`、无配色、无图标),守着 1013 张美术作品,却长得像默认 HTML。

**决策**(spec #43 的实现决定 + 六张票各自的验收标准):
- **命名**:`console` → **`webui`**,终端 banner 改 `WebUI: <url>`,一切指路的地方(AGENTS.md 命令表、CONTEXT-MAP、README 新增的一节)同一改到位;**领域词 Console 与内部文件名不动**——ADR 0012 取代 ADR 0008 的命名条款,0008 作为当天的记录不回改。
- **语言边界**:页面文案、`document.title`、`<html lang>`、`webui` 的终端输出用中文;标识符、注释、commit message、`run_report` 字段名与日志契约保持英文;文档正文保持英文,只有**词表变双语条目**(Wallpaper 壁纸 / Mirror 镜像 / Run 运行 / Run log 运行日志 / Gallery list 官方清单 / Site asset 站点资源 / Orphaned Run 孤儿运行 / Coverage 覆盖率 / Mirror gap 镜像缺口 / Console 本地控制台)。
- **i18n**:自建**类型化字典**(52 key × 2 语言;`satisfies Record<MessageKey, string>` 让漏翻与多翻都成为编译错误),默认 `zh-CN`,切换存 `localStorage`,不用 `?lang=`;服务端**只出 code + 参数**(`run-busy`/`orphaned-run`/`missing-prerequisite`、四个前置条件 code、结构化 verdict 原因)——服务端英文散文归零,文案只有一个来源。
- **设计系统**:UnoCSS + `presetWind4` + 语义 token(**暗色唯一**)+ `reka-ui` 只给行为 + Phosphor 构建期内联;取 high-end 的视觉语言、**拒其落地页教条**(宏观留白、全页 scroll reveal)。ADR 0013 记录了对 **Onu UI** 的实测否决(npm 停在 1.1.5 / 2024-11-10;preset 锁 `@unocss/preset-mini ^0.64`,与 unocss 66 装出第二份 core;wind4 重写只在未发布的 main;文档域名 DNS 不解析;无 i18n 层)。
- **视觉与信息架构**:浮起玻璃药丸导航(blur 只出现在固定层)、**5 列 masonry 当主角**、Run 与孤儿面板进侧栏抽屉、全屏 80% 黑取景器 + 圆角控制药丸、氛围由 CSS 复刻(琥珀辉光 + 3% 噪点,**不搬任何素材**)、动效走自定义曲线且 `prefers-reduced-motion` 在一处坍缩。
- **字体**:三个 OFL 角色(思源宋体标题/导航、Playfair 拉丁展示、Geist 数字 tabular)+ 系统黑体正文;`@fontsource` 进 `node_modules`、产物落 gitignore 的 `web/dist`,**仓库零字体字节**;MiSans / HarmonyOS Sans / 阿里巴巴普惠体 / 商业展示体 / 官网自己的字体文件全部排除(ADR 0015)。
- **砌墙必须有真纵横比**:masonry 要知道每张图的像素尺寸,而"等图片加载后再排"会让整面墙在读者光标下重排——于是服务端新增 `web/server/image-sizes.ts`(注入式读数 + 进程内记忆 + 并发 8;实测 1013 张顺序读 5.0s、并发 1.2s),前端 `web/src/masonry.ts` 只做"进最矮一列"这一个决策,并因此可单测。

**验证**(真跑,不是构建产物):
- 五门:`pnpm fmt:check` **87 文件**、`pnpm lint` 76 文件 / 218 规则 **0 warning 0 error**、`tsc` + `vue-tsc` 0、`pnpm test` **28 文件 / 301 tests**(基线 268)、`pnpm build:web` 成功。
- 浏览器(真服务 + 真镜像 1013 个文件):默认中文;切 English 后 `title=Wallpaper Gallery`、`lang=en`、`localStorage.webui.locale=en` 且刷新仍在;**5 列 masonry**、tile 按真实纵横比且 1013 张全渲染;取景器 `role=dialog` + **`aria-modal=true`** + 焦点进浮层,**Esc 关闭后焦点回到被点的那一张**(`activeIndex=40`、`sameTile=true`);抽屉里 run id、结论、已解释原因、官方/下载数字、缺陷行、开始运行全在。
- **CSS 内嵌资源 403(本轮唯一"只有真跑能看见"的缺陷)**:五个门全绿、测试全绿、**截图看着也对**(Windows 的衬线回退链让真字体与假字体肉眼几乎一样),但请求日志 **16 条 woff2 全是 403**、`document.fonts` 已加载面数 **0**。根因:`sendPage` 只改写 HTML 里的资源 URL,而 CSS 里的 `url()` 不继承样式表自己的查询串。修复让样式表在出口处也被改写——顺带发现 fragment 必须排最后(`#tile?token=…` 会被浏览器整个丢掉)。修后:woff2 全 200、已加载面数 6–7、中文衬线 `check()` 为 true。
- **两个"报了但没做到"的缺陷同样只有浏览器抓得到**:焦点不返回触发元素、`aria-modal` 缺失;修法是把 tile 变成真正的 `DialogTrigger`,并在内容上明写 `aria-modal`(reka-ui 不写)。另有一个纯视觉缺陷:100% 缩放下,被 `transform` 提升为堆叠上下文的图片会压住控制药丸,加 `z-10` 解决。

**教训**:
- **构建绿 ≠ 页面对**。本轮最贵的缺陷穿过了五个门、穿过了 301 个测试、还穿过了截图——因为回退链让眼睛也判不出来。凡涉及"资源地址 × 访问守卫"的组合,证据必须是**请求日志与运行时状态**,不是产物与截图。
- **"看着对"是最危险的证据**。同一次比对里,衬线回退与真字体在截图上几乎一致;分得开它们的是 `document.fonts` 与网络列表。
- **环境会改形状,但不能改标准**。本轮前半程在一个 `pnpm`/`tsx`/`oxfmt` 全被拒的沙箱里,量出的替代命令(直连 `node_modules\.bin`、`vite/vitest` 加 `--configLoader native`、`--pool=threads`)让 implementer 仍然跑得完 TDD 与四件套;而"确实没跑过的门"写进了 PR 与提交信息,不假装跑过。沙箱放开后立刻用真 `pnpm` 复跑一遍,结果一致——这一步不是形式。
- **派出去的 agent 会中断、会失败、会把没做到的事写成做到**。本轮一次被中断、一次 failed、一处"焦点返回"报成已实现而实测不成立。**能验收的只有流程里的实测证据,不是 agent 的结语**;接手前先量现场(那次 16 个未提交改动其实已经是全绿的),比重派一次便宜得多。
- **没有截图能证明的那部分,要抽成纯函数**。masonry 排错列在任何截图里都不显形(每列看上去都正常),所以那个决策被单独抽出来并单测;而焦点返回与 `aria-modal` 只能靠浏览器 `eval` 断言。

### 2026-10-20 — Discovery script 副本只物化一次,且永不删除（#51 / #52 / #53 / #54）

**触因**：每次 Run 都把 `scripts/run-discovery.js` 替换哈希后写到仓根 `__run_script.js`，跑完再 `unlink`。代价不在速度上：实测 9.8 KB 写+删 **0.8 ms**，而一次 Run 是 **250–425 s**（写文件占 0.0002%）。真实代价是三条卫生问题——`__run_script.js` 不在 `.gitignore` 里，Run 全程 `git status` 是脏的；Ctrl-C／崩溃／900 s 超时跳过 `unlink`，留下没人敢删的 9.8 KB 未跟踪文件；内容其实完全由 `run-discovery.js` + `PAGE_HASH` 常量决定，于是每次都写一遍同样的字节再删掉，而那个 `unlink` 自己又是一个被静默吞掉的失败点。

**决策**：
- 副本落到 `.run-cache/run-discovery.generated.js`：仓内、`.gitignore` 一行、**固定名**。否决内容哈希名：Console 已串行化 Run，"并发不互相覆盖"不是理由，"只有一份、一眼能找到"才是收益。
- **内容相同就不写、永不删除**。平台没有"只写一次"的原语，但"相同就跳过"等价，且删掉 `unlink` 顺带消掉一个失败分支。
- `discovery-loader.ts` 成为接缝：`materializeDiscoveryScript()` 返回 `{ path, written, sha256 }`，目录／载荷／哈希均可注入；`main.ts` 只说"给我一个能跑的路径"，不再知道缓存的存在。
- 物化提到**开浏览器之前**：载荷读不出来或目录不可写，现在毫秒级 Fatal，而不是 Chrome 起来、导航完成之后。
- Run 日志补身份：`run_meta.config.DISCOVERY_SCRIPT_SHA`（12 位）回答"这跑用的是哪版载荷"；独立 `type: "discovery_script"` 记录带 `{ path, written }` 回答"这次写没写"——事件不属于配置，故不并进 `run_meta`。第三个 `type` 对读取侧惰性：只有 `run_report` 带字面量 schema，其余记录被 `parseRunReport` 跳过。
- 排除理由只写一处（`.gitignore`）。实测两个 walker 都尊重它（只忽略 `.run-cache/` 时 `oxfmt --check .` 报 "all matched files may have been excluded by ignore rules"、`oxlint .` 报 0 files），而**显式点名**的路径仍会被格式化——所以"内容比较"带来的自愈不是装饰，它兜住了"有人手滑点名"这一种情形。
- 术语不加：`CONTEXT.md` 只保留 Discovery script；副本是物化它的实现细节。ADR 也不加：挪目录是几十行的事，"难以回退"这条不成立，理由记在本文。

**验证**：
- `tests/core/discovery-loader.test.ts` **7 tests**：首次写（并断言返回路径是绝对路径、文件名固定、目录就是注入的那个）、同内容不写（mtime 拨到 2020 再比，避开同毫秒假阴性；并断言 sha 不变）、载荷变化重写、**页面哈希变化重写**、外部改坏后自愈、目录自建、sha256 与独立算出的字面量一致。
- `parseRunReport` 那条"在邻居中找出报告"的测试现在把 `type: "discovery_script"` 作为邻居带进去——第三个记录类型不改判定，有测试兜着。
- 门：`tsc --noEmit` 0、`oxlint --type-aware .` 77 文件 **0 warning 0 error**、`oxfmt --check` 通过、`git push` 触发的真 pre-push（`pnpm typecheck && pnpm test`）**29 文件 / 308 tests** 通过。
- **真跑两轮**（先删 `.run-cache/`）：Run `2026-10-20T02-11-11` → `written: true`、`DISCOVERY_SCRIPT_SHA 759052340cbc`、converged、6 轮、`combinedCount` 589、5m44s、official 1010 / +0 new / 555 skip / 0 failed；紧接着 Run `2026-10-20T02-26-48` → **同 sha**、`written: false`、`combinedCount` 259、4m09s、0 failed，而副本的 mtime 仍是 `10:11:11`——第二跑确实没碰文件。Run 期间与之后 `git status` 干净，仓根无任何残留。
- 环境注记：受限沙箱里 `pnpm`（store 锁）、提交钩子（`sh.exe` 信号管道）、`oxfmt` 对 `.vue`、以及 `execSync(stdio:'pipe')` 全被 EPERM 挡住，所以那些轮次用直连 `node_modules\.bin`、`vitest --pool=threads`、以及一次性提权补跑；四个提交因此用了 `--no-verify`，PR 里写明，真实的 pre-push 门已在 push 时跑过。

**教训**：
- **先量再争**。"效率太低"在量之前不成立（0.8 ms vs 250–425 s）；把 9.8 KB 的写盘当性能问题，会去改错的东西。真正的杠杆是十次 `npx` 冷启动（≈6 s），那属于另一个决定（把 `@playwright/cli` 变成依赖），本轮明确不做。
- **根因要说到能指导修复的那一层**。"这是 cmd.exe 的错"会推出"那就不用 shell"；但 Windows 上 `.cmd` 不能无 shell 启动（`spawnSync('npx.cmd', …, {shell:false})` → `EINVAL`，CVE-2024-27980），真正的替代方案要解析全局安装路径——比这个修复本身更脆。留着文件是对的，要修的是它的卫生。
- **约束要实测，不要读文档推断**。`--filename` 的允许根（outputDir 或 cwd）以及 `skillMode: true` 绕过它，都是读 bundle 读出来的；`%TEMP%` 今天能用、明天可能不能，正是否决它的唯一理由。
- **测试不能依赖本机的 `.env`**。新测试一旦（哪怕间接）import 到 `core/config.ts`——它在模块加载时就用 zod 校验环境——CI 上没有 `.env`，整个测试文件在导入阶段就 `ZodError`：本机 308 绿、CI 直接红。修法是 `vi.hoisted` 里先补上必需变量，让测试只依赖自己注入的东西。下一条碰 `config` 的测试照抄这一段。

---

### 2026-10-20 — WebUI 成为唯一的人类入口：`core:run` 顶替 `save-wallpapers`，Run log 改名 `run-<runId>`，无 `.env` 也能打开页面（spec #56 / 票 #57–#62）

**触因**：仓库同时摆着两个入口，而新用户最先碰到的是错的那个。README 的 quick start 收在 `pnpm save-wallpapers` —— 一条名字像给用户看的终端命令，真正起页面的 `pnpm webui` 反而被放在后面，当成「看 Mirror」的附件。更糟的是，没写过 `.env` 的机器上 `webui` 根本到不了页面：Console 的入口静态 import 了在模块加载时就解析环境的 config 模块，于是全新 clone 的第一个人看到的是 Zod 堆栈，而不是页面；而「缺 `.env`」这个 Console 本来会命名的前置条件，只在点「开始运行」时才检查，页面起不来时那个按钮也不存在。还有一处命名渗漏：因为脚本按用户任务命名，Run log 的文件名 —— 被 `check-run`、Console、测试和 README 硬编码读取的契约 —— 变成了 `save-wallpapers-<runId>.jsonl`，删脚本也会把这个名字留在每个用户可见的面上。

**决策**：
- **一个人类入口，命令线归 agent**：README 只教 `pnpm webui`（安装 → 一条命令 → 页面），`core:run` 与 `check-run` 是 agent 的接口，只写进 AGENTS.md 的命令表与 save-images runbook，不写进 README。`check-run` 的名字、文件、输出与退出码一律不动。ADR 0016 记录这个安排；它取代 ADR 0012 的命名条款（三个名字变成 `core:run` / `check-run` / `webui`），0008 与 0012 作为当日记录不回改。
- **删脚本**：`save-wallpapers` 从 `package.json` 删除，`core:run`（`tsx core/main.ts`）顶替，**不留别名**——理由与 ADR 0012 删 `console` 时相同：两个名字重建这次要消掉的歧义。Console 的启动器本来就直接 spawn tsx 入口，所以删脚本不动任何运行时行为。
- **日志名中性化**：写侧出 `logs/run-<runId>.jsonl`；读侧永久接受旧前缀 `save-wallpapers-<runId>.jsonl`（旧文件是历史事实，不是过渡态——没有一份日志被改名、重写或删除，ADR 0007 的审计轨道因此完整）。最新 Run 的挑选**按 `runId` 排序，而不是整个文件名**：跨前缀的朴素字符串比较会把每个 `save-wallpapers-…` 排在每个 `run-…` 之后（`s` > `r`），昨天的旧日志就会压过今天的新日志。一个共享谓词 `logRunIdOf`（在纯层 `core/report/run-log.ts`，`runId` 为 `null` 即「不是 Run log」）同时服务选取、判定里的 log→Run 识别和测试夹具；`check-run` 的「无日志」行不再点名已删除的脚本。
- **无 `.env` 也能启动**：配置 schema 只有一个家 `core/config-read.ts`；`core/config.ts` 仍在模块加载时严格 parse 并导出管线用的常量，所以 Run 的 fail-fast 原样保留，Console 用的是同一 schema 的**非抛出读**。没有可用文件（缺失、不可解析、缺必需键）时，页面照开、墙照渲染、Gallery list 退化为「未读」（`null`，绝不是空列表，也不对不存在的 URL 发请求），Run 面板用两种语言给出 setup notice：仓根建 `.env`，粘贴那两行站点常量。
- **`runConfigAvailable` 每次 status 请求现读**：它走的就是 start 拒绝时那条 `env-file` 谓词——一个读取器、一套全 schema（含带默认值的键），一次 `.env` 文件读，无 `PATH` 扫描、无注册表查询——所以环境提示与点击路径不可能给出不同答案。这**有意取代** spec 早先「boot fact」的写法：一次性读出的提示在用户建好文件后永不清除，比每次多读一个文件更糟；本轮唯一一处「实现之后改口径」就记在 ADR 0016 的 Considered options 里。
- **Console 零写**：不写 `.env`、不写 Mirror、不写 Run log，仓根不因它多一个文件。页面负责说明，用户负责创建。
- **文档同一轮改到位**：README 重写成页面优先的用户指南，AGENTS.md 命令表、CONTEXT-MAP 的 Console 关系句、CONTEXT.md 的 Console 定义、runbook 的命令与日志名全部同轮更新；`core/config-read.ts` 补进 AGENTS.md 架构树与 CONTEXT-MAP 的「Where things live」。否决方案同步进下表，免得下一轮重新提议。

**验证**：
- 五门（最终树，直连 `node_modules\.bin`）：`vitest run` **30 文件 / 335 tests 通过**（基线 308；两次评审后的修复补了 7 个测试——文件判定 5、前置条件 2——并删掉 1 个只测死代码的）；`tsc --noEmit` 与 `vue-tsc --noEmit -p web/tsconfig.web.json` 0；`oxlint --type-aware .` **0 warning 0 error**；`oxfmt --check` clean。
- **评审后的两处真修复**（同轮，`fix/review-findings`）：其一，`/api/status` 的 `runConfigAvailable` 与 start 的 `env-file` 拒绝改走同一个**全 schema** 文件读（`core/config-read.ts` 的 `readProjectConfig`），此前 `prerequisites.ts` 自留两键 schema，于是 `BATCH_SIZE=abc` 的 `.env` 会「报告可用 → 允许开始 → Run 自己 import 时抛 ZodError」；其二，Console 不再在启动时把 `.env` 灌进 `process.env`（dotenv 不覆盖），否则启动时写错的键会永久遮蔽后来改对的文件。手动证明（同一进程、同一 token、端口 8811）：`BATCH_SIZE=abc` 时 status 报 `false`，把同一份文件改成 `4` 后**不重启**即报 `true`，而 Gallery 端点仍按 ADR 0016 保持启动时的 `null`。
- **手动真服务，无 `.env`**（本分支 #57/#60 的实测）：`webui --no-open` 起得来、页面 200、`/api/status` 返回 `runConfigAvailable: false`、Run 面板两种语言都显示 setup notice；点「开始运行」返回 `412 missing-prerequisite`，缺项里点名 `env-file`；创建 `.env` 后下一次 status 读回到 `true`，提示随之消失。Console 进程没有在仓根写任何文件。
- **混合前缀**（单测覆盖）：`tests/core/run-log-file.test.ts` 在同一目录放一份旧前缀与一份新前缀，断言挑选跟着 `runId` 走而不是前缀；`tests/core/report/run-log.test.ts` 断言两种前缀都算 Run log、`.bak` 与无关 `.jsonl` 不算；`check-run` 的「无日志」行在源码里不再出现旧脚本名（这一行没有测试断言）。
- **setup notice 的字典覆盖**：`tests/web/src/i18n/messages.test.ts` 断言两种语言都带那两行站点常量原文、并且句子里点名 `.env`，字典完整性测试继续枚举所有 code。
- 没跑抓取 Run：本轮只改名字与启动路径，管线行为零改动，跑一轮证明不了这次改动（spec 的 Testing Decisions 明写如此）。本轮（#62）是纯文档票，证据即上面这些数与被改动文件的逐条对照；提交用 `--no-verify`，钩子里的三道检查（`node scripts/check-branch.mjs`、`oxlint --type-aware .`、`oxfmt --check`）按手跑。

**教训**：
- **文档也是契约，而它不会自己喊**。改命令名与日志名时，测试、类型和 lint 都不会因为 README、runbook、HISTORY 的验证规范、AGENTS 的架构树过期而变红；这次把验收标准直接写成「过时名字不能活在日期记录之外」，比逐处记忆可靠。
- **「便宜的事实」要按读者的体验排序**。`runConfigAvailable` 按 boot 读一次在逻辑上成立，在体验上却是一条永不清除的提示；改成每请求一次文件读、并与拒绝共用同一个谓词之后，「提示与点击不可能不一致」才是结构性的。
- **「现在可用吗」只能有一个答案**。同一个 `.env` 被两套 schema 判过（start 用两键、启动用全 schema）时，用户看到的是「报告可用 → 点开始 → Run 抛 ZodError」；而 Console 启动时把 `.env` 灌进 `process.env`（dotenv 不覆盖）会让**后来改对的文件永远被启动时的旧值遮蔽**。这两件事都不是逻辑错误，是「同一个问题有了第二个答案」的两次化身。
- **日志名跟着领域词走，不跟着命令走**。`save-wallpapers` 被删的那一刻，旧日志名就成了对一个不存在命令的引用；`run-` 只承载 Run，命令以后再改也拖不动日志名。
- **兼容要写成「历史事实」而不是「过渡期」**。两个前缀永久可读，于是没有人需要决定旧日志何时过期，也没有人需要给它们改名——过期日期本身才是将来要维护的东西。

### 2026-10-20 — Web 层模块化：页面三桶 + 一个状态源，Console 的 HTTP 表面交给路由器（spec #68 / 票 #69–#73）

**触因**：两层都在靠累积长大。页面是平的：五个单文件组件、一个 masonry 函数和一个 token 辅助并排，文件名是唯一能说明「这是哪一类文件」的东西，而三个不同的东西混在同一批文件里——只出标记的、带响应式状态与生命周期的（状态读取、轮询 timer、查看器开关）、无状态纯函数。更实的两处：`/api/status` 被读了两遍（导航读 `mirrorCount`、抽屉自己再读一份并轮询），同一个事实在屏幕上有两个副本，提示与判定可能互相矛盾；页面还手抄了一份 crawler 的图片扩展名清单，漂移的症状是每个 tile 一次注定 400 的缩略图请求。服务侧则是 748 行手写传输：路由、token/Host/Origin 守卫、四种响应、页面与样式表的 token 改写、端口回退全在一个文件里，加一条路由要改一段很长的 handler 链，而每条路由都重写一遍自己的 method 判断、响应头与 404/405 文案。

**决策**：
- **页面三桶，一条规则**：有响应式状态或生命周期 → `composables/`；无状态纯函数 → `lib/`；只出标记 → `components/`。**不按特性分层**——一面墙 + 一个抽屉，`features/gallery`、`features/run` 的目录数会超过它组织的代码。命名扁平加前缀（`Wall*`、`Run*`、`Console*`），不进子目录。
- **一个状态源**：`useConsoleStatus()` 是模块级单例——挂载读一次、只在 Run 进行中 5 秒轮询、一个失败值。导航与 Run 面板从此同源，**具名行为变化 1：导航的 Mirror 计数开始跟随轮询**（此前冻结在挂载那一刻），在 PR 描述里写明。
- **契约拥有「能不能显示」**：每个 gallery 行多一个由服务算出的 `viewable`（在盘 + 文件名属于 Wallpaper URL 集），页面不再声明任何扩展名。**具名行为变化 2**：非图片的 Mirror 额外文件不再产生注定 400 的请求。判定跨契约、服务、页面三层，跟着 `buildGalleryView` 的既有单测走。
- **框架只做分派**：hono `4.13.13` + `@hono/node-server` `2.1.5` 接管 method+path 分派与 URL 解析；守卫、四种响应形状、样式表 `url()` 改写、端口回退**仍是我们的**。响应头由 `http/respond.ts` 手写——框架默认序列化写的是它自己的变体（`c.json` 连 charset 都不写），而页面测试断言的是逐字节字符串。传输契约移到 `http/deps.ts`，但由 `server.ts` 原样转出，**换骨架自己的提交没有改动任何一个经 socket 驱动服务的测试文件**——这是这次重构最强的完成信号。
- **405 要用 `app.all` 注册，不是 `app.get`**：路由器按方法匹配，`app.get` 注册的路由收到 POST 会落到 notFound 的 404，`expectMethod` 永远不执行。改成 `app.all(path, expectMethod(...), handler)` 后 405 + `allow` 头恢复。
- **ADR 0017 + 文档同轮**：框架进入 Console 的边界、被否决的四个替代（express / fastify / srvx / 只加静态帮手），以及一句把 `HISTORY` 里 2026-06-15 那条「否决 HTTP 框架」限定回去——那条针对的是无路由/无 API/无 DB 的爬虫命令行，不是这个表面。

**验证**（integration 分支，五门）：
- `oxfmt --check` clean；`oxlint --type-aware .` **0 warning 0 error**；`tsc --noEmit` 与 `vue-tsc --noEmit -p web/tsconfig.web.json` 0；`vitest run` **32 文件 / 344 tests 通过**（基线 335，新增 `poll` 4 条、`withToken` 4 条，契约与路由测试改期望值）；`vite build` 成功。
- **经 socket 驱动服务的五个测试文件**（`server`、`gallery-route`、`run-api`、`run-cleanup`、`thumbnail-route`）在换骨架的提交里 **0 改动**，却覆盖了守卫、403/404/405、逐字节响应头、页面与样式表改写、缩略图 500、端口回退——换骨架的全部证明都在这里面。**#70 的契约变更改过其中一个**（`gallery-route.test.ts` 的整包体断言加上了 `viewable`）：那是契约变更该付的代价，不属于换骨架这一步。两件事在同一条票链上，但不是同一个改动——文档里把两者写成一句「六个文件 0 改动」是错的，这条是复核时抓出来的。
- **真服务冒烟**（端口 8897）：页面 200 且两条资源 URL 带 token；JS `200 text/javascript; charset=utf-8` + `immutable` + `nosniff`；CSS 里 **109 个 `url()` 引用全部带 token**，字体 `200 font/woff2`、无 token 时 `403`；`/api/status` 200（idle，mirror 1013）；`/api/gallery` 200（1055 行，1013 可显示）；无 token 403；未知路由 404；错方法 405 + `allow: GET`；`/assets/%2e%2e%2f…` 404；`/api/thumbnail/..` 404（URL 归一化后不再属于该路由）；`%2e%2e%2fpackage.json` 400；真缩略图 200 `image/jpeg` 22 940 字节；原图 200。端口占用时第二个实例报「端口 8897 被占用,改用 3785」并正常应答。
- **方法行为的保真**（端口 8893，复核后补测）：`HEAD /` 与 `HEAD /assets/*` 仍是 **404**、`POST /` 与 `POST /assets/*` 仍是 **404**、`HEAD /api/status` 仍是 **405 + allow: GET**——路由器默认把 HEAD 当 GET 派发，若不显式判方法，页面这条会悄悄从 404 变成 200，那就成了第三处未命名的行为变化。

**教训**：
- **「测试是契约」在重构里是真的有牙**。把驱动服务的测试设成「换骨架时不能改」，等于把「同样的答案、不同的形状」变成可执行的判据；这类门禁里只要有一个需要动测试，就说明形状变了，而不是说明测试过时。
- **框架的默认值不是中立的**。选型阶段查过 `c.json` 不写 charset，实测才发现还有 405 与路由方法匹配这一层：`app.get` 注册让错误方法静默变成 404。响应头与状态码必须自己产出，这一条在文档里被写成规矩，而不是被当成实现细节。
- **共享 `node_modules` 的 worktree 会被包管理器反复重装**（`verify-deps-before-run` + junction），install 时还会把 `.bin` 弄丢；并行 worktree 的成本不在 git，在这棵树。
- **文档漂移要写进文档**：官方站点已经在讲 hono v5，而钉住的是 4.x；`hostname` 选项只存在于类型声明里。两条都写进 ADR 0017 的 Consequences，免得下一个人拿网站当准绳。

---

### 2026-10-21 — Discovery 坍缩成官网清单：浏览器、会话、run-code 载荷整条退役（#76 / ADR 0018）

**触因**：09-15 晚记下的 (C)「整体坍缩成接口客户端 + 下载器」终于满足了自己的立项门槛。门槛就是 `discovery.coverage`：单轮实测覆盖官网清单 **0.1798 / 0.4496 / 29.7%**，而清单接口一次给出全部 **1001** 条、约 **160 ms**、无需任何会话。这个数字不是性能问题，是产品问题——第一次点「开始抓取」的玩家只会跑一次，而那一轮只拿到清单的一小半。

**决策**：
- **Discovery 就是清单请求**。`core/gallery/gallery-source.ts` 仍是这个请求的唯一实现（不重写），新增 `core/discovery/discovery.ts` 把一份清单变成一轮 Run 的 Discovery：URL 集 = 全部 `pictureUrl`（去重），报告字段由它计算并有单测。`fetchGalleryList` 失败时 URL 集为空、`coverage: null`，报告照写、退出码不改——那是缺陷，不是「瘦一轮」。
- **整条浏览器路径删除**：清会话、开浏览器、`run-code` 载荷、滚动稳定性循环、DOM 合并、cookie 提取全部退役；`scripts/run-discovery.js`、`core/discovery/discovery-loader.ts`、`tests/core/discovery-loader.test.ts`、`.run-cache/` 一并删除，两个工具配置里对载荷的排除也删掉。
- **配置收缩，层结构不动**：`PAGE_PATH`、`SESSION_NAME`、`PLAYWRIGHT_CONFIG` 移出 schema（page hash 从来不是键）。分层读取、优先级、`data/user.env` 都归 #78，本轮不碰。旧的 `.env` 仍能通过校验：zod 忽略未知键；新装只需 `BASE_ORIGIN` 一行，i18n 的 setup 文案与 README 同步成一行。
- **前置条件只剩两个**：`playwright-cli` 与 `chrome`（含注册表 App Paths 检查）删除，`PrerequisiteCode` 变为 `env-file` / `tsx-entry`；孤儿清理不再关闭浏览器会话（已无会话可关），只撤回日志的声明。
- **Download 不再带 cookie**：`extractCookies` 与 `Cookie` 头删除，403 重试与完整浏览器头保留（那是 CDN 的头部策略，不是鉴权）。HTTP 客户端改为可注入，契约第一次有了自己的测试；`Referer` 从页面 URL 改为站点 origin（页面已不存在）。
- **报告形状一个键都不删，语义重指**：`coverage` 读清单时为 1、读不到为 null；`converged` = 清单是否回答；`networkCount`/`combinedCount`/`discoveryDurationMs` = 清单响应自己的计数与耗时；`stableRounds`/`totalIdleSec`/`domCount`/`thumbnailsClicked` 恒为 0；`siteAssets` 与 `discoveryLeak` 保留但恒空；`siteAssetFalsePositive` 在读清单时是 `{count: 0, urls: []}`、读不到时才是 `null`——**不能**因为「没有丢东西」就写 `null`，那是「未检查」的既有含义，而且 run-log 读取器把它与 `mirrorGap` 的 null 绑定，写错会让每一份新报告被整份拒收、每轮都判缺陷。`emptyResult` 现在等价于「清单没读到」。三态语义与 `check-run` 退出码不变。
- **ADR 0018 同轮**：记录坍缩、已满足的门槛、被驳回的替代（保留浏览器捕获作回退 / 双源 / 删报告键 / `siteAssetFalsePositive: null` / 留着载荷不调用 / 留着 cookie），以及报告契约的决定。

**验证**：
- 四件套（sandbox 直跑二进制）：`tsc --noEmit` 0、`vue-tsc --noEmit -p web/tsconfig.web.json` 0、`oxlint --type-aware .` **0 warning 0 error**、`vitest run` **37 文件 / 384 tests 通过**。格式化对 `.ts`/`.json` 用 `oxfmt --threads=1`（`.vue` 在本沙箱无法 spawn，未改）。
- 新增测试：`tests/core/discovery/discovery.test.ts` 6 条（URL 集、计数器、清单不可用、空审计、规则不再过滤清单、重复 URL 去重）；`tests/core/download/download.test.ts` 7 条（无 `Cookie`、403 重试带全头、非 403 不重试、已存在跳过、失败携带 `retried`、相对 URL、批内继续）；`tests/core/report/list-run-report.test.ts` 2 条——把 discovery → `buildRunReport` → JSONL → `parseRunReport` → `assessRun` 串起来，证明读取器的 null 不变式仍成立、干净轮仍是 `clean`、清单不可用仍是 `defect`。
- **没有真跑**：一轮真下载约 2 GB，本沙箱明确不跑。因此未证明的是站点行为与跨轮稳定性：连续两轮真实运行的条目数一致（票的稳定性验收），以及 `pageSize: 2000` 是否被服务端悄悄截断（`parseGalleryList` 会拒收短于 total 的响应，不会把缺的一半报成新增）。

**教训**：
- **门槛指标达到之日，就是它失去意义之日**。`coverage` 存在的唯一理由是回答「还要不要爬页面」；URL 集等于清单后它恒为 1。把它继续当测量值打印，会让人以为它还可能下降；把「测量」改成「契约里的常量」必须在 ADR 里明说，而不是悄悄写死。
- **「保持报告形状」比「保留字段」更细**。字段保住了，含义也会咬人：`siteAssetFalsePositive` 的 `null` 早就有「清单不可用、未检查」的含义，且被 run-log 读取器与 `mirrorGap` 绑定。按「没东西可过滤」写成 `null`，新报告会整份不可读、每轮判缺陷——这不是类型错误，单测也只在跑整条 round trip 时才抓得到。
- **删协议载荷要删它的边角**：载荷、loader、`.run-cache/` 之外，还有两个工具配置里的路径排除、AGENTS 里的 gotchas、runbook 的 preflight 与读取陷阱。只删主文件会留下指向不存在文件的规则与描述。
- **注入 HTTP 客户端让「去掉 cookie」第一次可证**：测试直接断言请求头里没有 `Cookie`、403 第二次请求带全 `Sec-Fetch-*`，比真跑更能定位；但站点侧的稳定性仍只有真跑能证，别把单测当站点的保证。

---

### 2026-10-21 — 用户数据搬进 data 目录：镜像、Run log、缩略图缓存与数据版本闸（#80 / ADR 0019）

**触因**：便携包的更新故事是「整体替换 `app\`」，而用户的东西当时住在程序目录里——仓根的 `images/`、`logs/`，以及 `web/.console-cache/`。替换 `app\`（或重新 clone）与丢掉这些是同一个动作。更隐蔽的失败是「静默忽略」：旧程序遇到新版本写下的状态文件会 `safeParse` 成 `null`，把 Run 当成首轮，页面上出现「官网 1010 / 本地 0」，用户只看到「这软件坏了」。

**决策**：
- **数据目录是一个注入的根**：源码树解析 `<repo>/data`，包由启动器用 `RE1999_DATA_ROOT` 指向 `<install>/data`（与 `app/` 平级，`core/app-root.ts` #78 已提供）。`core/data-layout.ts` 是唯一命名 `<data>/images`、`<data>/logs`、`<data>/cache/thumbnails`、`<data>/layout.json` 的模块；`IMAGES_DIR` 仍可配置，但相对数据根解析。
- **缩略图缓存搬出程序目录**，但仍不在 Mirror 内：`<data>/cache` 是 `<data>/images` 的兄弟，ADR 0010 的算术前提不变；缓存本可丢弃，但留着就等于每次更新白掉 1000+ 张。
- **版本标记 + 拒绝启动**：`layout.json` 写 `{"version": 1}`。更高或无法识别的版本在**任何写入之前**拒绝，中文说明点名标记文件与两个版本号；`images/.gallery-state.json` 的 `version: 1` 原样随镜像移动、原样读取，没有重新解释。
- **前向迁移只做同卷 rename，且幂等**：首次启动（Run、`check-run`、Console 三处入口）识别旧位置并逐个改名，然后写标记；目标已存在就拒绝并给出手工合并步骤（不猜、不并、不覆盖）；跨盘拒绝并说明先手动移动（不静默复制，避免复制到一半失败）。中断的迁移下一次启动接着做，已经写好的标记让第二次启动不碰任何文件。
- **「程序永不删除数据」用测试证明**：`tests/core/data-layout.test.ts` 在临时树上覆盖迁移、冲突、跨卷、更高版本；`tests/core/data-cycle-survival.test.ts` 跑一轮 Run 的整条数据层（logger、Mirror mkdir、下载、Gallery state 写入与读取），断言迁移前存在的每个文件仍在、逐字节相同（Gallery state 是允许改写的状态文件，只要求仍在）；`tests/web/server/data-survival.test.ts` 用真实 socket 驱动 Console 的 status / gallery / image / thumbnail 与被拒绝的 start，断言同一件事。真仓的 2.1 GB `images/` 全程未被测试读写。
- **文档与 ADR 同轮**：ADR 0019 记录布局、标记、迁移与「不删除」；ADR 0016 的「Console 不向仓根写任何东西」字面被取代（现在会创建 `<data>/layout.json`），但其约束本意更强：程序不写自己的程序目录，用户数据在更新替换的目录之外。AGENTS 架构树、`data/user.env` 路径、`.gitignore` 与 runbook 的读取路径同步。

**验证**：
- 四件套（sandbox 直跑二进制）：`tsc --noEmit` 0、`vue-tsc --noEmit -p web/tsconfig.web.json` 0、`oxlint --type-aware .` 0 warning 0 error、`vitest run` **40 文件 / 409 tests 通过**；改动过的 `.ts`/`.json` 用 `oxfmt --threads=1`（`.vue` 在本沙箱无法 spawn，未改）。
- 新增测试 25 条：`data-layout.test.ts` 21（路径来自数据根、缓存不在 Mirror 内、标记读取、更高/未知版本拒绝且数据逐字节不变、旧布局 rename、自定义镜像/日志名、幂等、目标冲突、跨卷、更高标记不动任何文件）；两条 survival 测试各 1（Run 数据层与 Console socket 周期）；`config-read.test.ts` 的 `siteConfig` 改为数据根下的镜像/日志/缓存并新增 1 条「数据不在程序目录」断言；`console-config.test.ts` 新增 1 条路径断言（原 3 条改写）。
- **没有真跑**：迁移会移动真仓的 2.1 GB `images/`，这是本票明令禁止的操作；所有迁移与周期证据都来自 `%TEMP%` 下的临时安装。

**教训**：
- **「不要删」是一条可以被行为测试证明的约束**。只写注释或只 code review 都挡不住未来某个 `rm -rf`；把「迁移前快照 ⊆ 迁移后快照且逐字节相同」写成断言，才让下一个人删数据时先看到红灯。
- **静默忽略是数据布局里最危险的失败**。版本标记的价值不在「记录版本」，而在把「不认识」从默认分支变成拒绝分支；拒绝必须发生在第一次 mkdir 之前，否则「原数据不动」就只是句口号。
- **迁移与更新是两种不同的写**。rename 同卷幂等，复制+删除不是；把跨卷明确设成拒绝分支，比写一个「自动复制」再追加失败回滚要诚实得多。

### 2026-10-21 — 程序以构建产物运行：两个 ESM 入口、预构建页面、去掉 tsx 与首启 Vite（#84 / spec #75）

**触因**：便携包（#75）要发的是一棵树，里面只有 `node.exe`、`sharp` 和程序本身。而当时的程序有三处只在源码树里成立：`pnpm webui` 是 `tsx web/server/console.ts`；Console 启动 Run 走的是 `node <tsx CLI 入口> <core/main.ts>` 这个 argv；首启缺页面时用 Vite 当场编译（`ensureBundle`）。三样都要在用户机器上出现转译器/打包器——正是「拿到 zip 的人不该装开发工具」要消灭的东西。

**决策**：
- **`build/` 就是程序**：`server.js`（bundled `web/server/console.ts`）、`run.js`（bundled `core/main.ts`）、`package.json`（`type: module` + 版本）、`web/dist/`（Vite 产物原样拷入）。这棵树同时是一个完整的应用根：`node build/server.js` 就地找到 `.env`、页面与 Run 入口。gitignore 掉，`pnpm webui` 改成 `cd build && node server.js`。
- **除 `sharp` 外全部打进 bundle**：`hono`、`@hono/node-server`、`pino`、`pino-pretty`、`undici`、`zod`、`dotenv` 及其传递依赖共 27 个包进两个文件。`sharp` 是原生插件，`await import('sharp')` 的调用点不变，包随树发布（#86）。这份「只有一个外部」不是声明而是断言：`scripts/bundle-externals.ts` 读 esbuild 的 metafile，任何没被允许的 external 都让 `pnpm build` 以非零码退出并点名是哪个包、哪个产物。
- **一个 `define`**：`RE1999_VERSION` = `package.json` 的 `version`，`core/version.ts` 里那个 `typeof` 兜底缝因此第一次真正被填上；树里的 `package.json` 只是自描述与源码运行的 fallback。
- **ESM bundle 的 CJS banner**：两个产物顶部都有 `const require = createRequire(import.meta.url)`。esbuild 把 CJS 依赖的 `require` 内联成自己的 shim，而 ESM 输出里没有 `require`；第一版没有 banner，构建产物在 `import` 第一行就死于 `dotenv` 的 `Dynamic require of "fs"`——typecheck、lint、全部测试却都是绿的。
- **Run 的启动只用 Node**：launcher argv 变成 `[<appRoot>/run.js]`，`tsxEntry`/`mainEntry` 两个依赖删掉；`tsx-entry` 前置条件连同它的 i18n 文案一起退役（`PREREQUISITE_CODES` 只剩 `env-file`），而不是留一个永远为假的检查。
- **首启不再编译**：`ensureBundle` 删除。页面与 Run 入口都是构建产物，缺任何一个在绑定端口之前就拒绝启动并点名文件（`web/server/build-artifacts.ts`，中文说明指向 `pnpm build`），因此「页面打开是空白 / 点运行毫无反应」两类故障在构建或打包阶段就暴露。
- **应用根仍是显式输入**：`RE1999_APP_ROOT` / `RE1999_DATA_ROOT` 一字未改，重新用打包后的入口验证（spec 的「打包会坍缩目录结构」那条）。Console 把 `runEntryPath(appRoot)` 交给子进程，子进程的 cwd 与 `RE1999_APP_ROOT` 都指向同一个根。
- **开发期才需要 `tsx`/`vite`**：`pnpm build` 自身是 `tsx scripts/build.ts`，`core:run` / `check-run` 仍是源码入口（面向 agent，不进用户包，spec #75 明说）；`dev:web` 的 Vite dev server 保留。运行期一个都不需要。

**验证**：
- `pnpm build`：页面 112 个文件、`server.js` 923 KiB、`run.js` 2124 KiB、外部依赖只有 `sharp`、打出 27 个已打包的包名。
- **真的启动构建产物**：把 `build/` 拷到 `%TEMP%` 下（仓库之外，没有 `node_modules`、没有 `.ts`、没有 tsx/vite），写一份 `.env`，`RE1999_APP_ROOT`/`RE1999_DATA_ROOT` 指向它，`node server.js --port 0 --no-open` 起来后：`GET /api/status` → `200`，`{"version":"1.0.0",…,"officialTotal":1052,"listAvailable":true,"runConfigAvailable":true,…}`；`GET /` 返回带 token 的 `index.html`。
- **Console→Run 的整条链**：同一棵树、`BASE_ORIGIN=http://127.0.0.1:9`（死端口，避免真下 2 GB）下 `POST /api/run` → `202 {"started":true}` → 构建后的 Console 用 `process.execPath` 拉起 `run.js` → 写出 `run-2026-10-21T11-20-15.jsonl`（`run_meta` + `run_report`）→ `/api/status` 把该报告读回来（`reportPresent: true`、`defects.gallerySourceUnavailable: true`）。单独跑 `node run.js` 退出码 0。
- 删掉 `web/dist` 后再启动：三行中文拒绝 + 退出码 1。
- 四件套：`tsc --noEmit` 0、`vue-tsc` 0、`oxlint --type-aware .` 0 warning 0 error、`vitest run` **43 文件 / 466 tests**；`oxfmt` 重排。
- **没有真跑完整 Run**：一次完整 Run 约 2 GB，本沙箱不跑；Run 的下载段（`undici`）与真实站点清单之外的路径仍未在构建产物上验证。CI 也还没跑 `pnpm build`（发布流水线归 #88）。

**教训**：
- **类型检查、lint、单测全绿，和「这个 bundle 能 import 起来」是两件事**。CJS 互操作 banner 这一类失败只在真启动时出现；打包类改动的最低验证标准必须是「把产物挪到一个干净目录并真的运行它」。
- **构建期的断言要用构建器自己的数据**。esbuild 的 metafile 直接给出每个产物的 external 与 input，比事后 grep 产物文本诚实得多；「只有一个原生依赖」因此是构建的门，而不是文档里的句子。
- **删掉一个前置检查，要接住它原本挡住的那种失败**。`tsx-entry` 挡的是「spawn 一个不存在的入口，点下去什么都没发生」；删了它就必须有别的机制（构建产物闸）挡住同一个后果，否则只是把 ENOENT 藏得更深。

### 2026-10-21 — 单实例与启动器：一个程序、一个服务、一个窗口（#82 / #85 / ADR 0020）

**触因**：便携包的全部界面就是「双击一个文件」（#75）。此前第二次双击会起第二个服务：端口被占就静默换端口、再开一个浏览器标签，于是两个进程写同一个 Run log 目录，而用户以为只有一个程序。另一半是停止语义——页面按 ADR 0016 没有停止控件，停止必须由那个可见窗口承担：标题说明「关闭即停止」，窗口保持打开，关掉它才是停止。

**决策**：
- **运行记录 + 探活，而不是锁**：服务绑定端口后把「本次实际绑定的端口 + 本次随机 token」写进 `<data>/instance.json`；每次启动先读它、用记录里的 token 打 `GET /api/instance`（1.5s 超时）。200 且 body 是 `{ok:true}` 才说明写记录的那个服务还在答——该路由和其他路由一样过 token 守卫，所以旧 token 会被 403，记录里保存的 URL 不会跨重启成为永久凭据。记录缺失/不可读/连接被拒/超时/token 不符，一律「正常启动」。干净退出时只有仍拥有该记录（token + pid 一致）的那次启动会删除它。
- **探活专用路由，不复用 `/api/status`**：status 是页面的轮询，可能顺带请求官网清单；探活一慢就会被读成「没有服务」，正好起了第二个。
- **记录在 `listen` 之后、更新检查之前发布**：等待更新检查的 await 在离线时能占满 3 秒，那段窗口里第二次双击必须能看到记录；因此 `deps.updateNotice` 改为绑定端口后再赋值，页面首读若正好落在检查完成前只是「这次没有更新提示」，下一次轮询会带上。
- **启动器 `packaging/启动.bat` 纯 ASCII、零逻辑**：`cd /d "%~dp0app"`、两个根变量、`app\node.exe app\server.js`、`if errorlevel 1 pause`。编码结论是**实测**的（见验证），所以中文只由程序打印：窗口标题（`process.title`，Windows 上是 Unicode 的 SetConsoleTitle）、启动时的「关闭这个窗口就是停止程序」、Run 开始时的「抓取已开始:下载期间请不要关闭这个窗口」、以及 Mark-of-the-Web 的中文解除步骤。
- **首启与安装指针**：`data\` 仍由 `core/data-layout.ts` 创建并写版本标记；程序每次启动把安装根 `<install>` 写进 `%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json`（文件夹可能被改名/移动，更新器 #87 需要「用户实际在跑的那一份」）。只有 `<install>\app` 与 `<install>\data` 平级这种包布局才写，源码树 `pnpm webui` 不碰 AppData。
- **Mark-of-the-Web 是提示，不是拒绝**：浏览器下载的 zip 被解压后，`Zone.Identifier` 流会复制到每个文件；启动时检查本次要运行的文件（`app\node.exe`、`server.js`、`run.js`、页面入口），命中就打印中文解除步骤并继续。解压后的树通常照样能跑，把一句可执行说明换成一次拒绝是更糟的支持面。
- **`.gitattributes` 给 `*.bat` 开 `-text`**：cmd.exe 的标签/goto 解析依赖 CRLF，仓库其余部分的 LF 规则不能套到启动器上。

**验证**：
- **编码（真窗口，非推断）**：在 `%TEMP%\编码 测试` 下用四种保存方式各写一个含「中文测试：关闭窗口即停止」的 `.bat`，用 `PrintWindow` 截取真实控制台窗口：UTF-8 无 BOM → 窗口里是乱码；UTF-8 + `chcp 65001` → 显示正确（但仅限无 BOM，且系统消息变英文）；UTF-8 **带 BOM** → `'锘緻echo' 不是内部或外部命令`，`@echo off` 失效；GBK → 本机正确。同一台机器的同一控制台用 Node 打印同一句中文 → 正确。结论：中文进程序，脚本保持 ASCII。
- **启动器端到端**：把 `build/` + `node.exe` + `启动.bat` 组成 `%TEMP%\壁纸 程序\`（含中文与空格），双击 `.bat`：窗口标题为「re1999 壁纸下载器 - 关闭这个窗口就是停止」，窗口内容为「关闭这个窗口就是停止程序。抓取和下载期间请不要关闭。」+ `WebUI: http://127.0.0.1:8791/?token=…`；`data\`（`layout.json` + `instance.json`）与 `install.json` 均被创建，指针里是中文路径。
- **第二次双击**：退出码 0，窗口只打印「程序已在运行:…」两行，`instance.json` 逐字节未变，node 进程数仍为 1，`/api/status` 200、页面 200 且带 token 重写。
- **关窗口即停止**：对真实窗口发 WM_CLOSE 后 node 进程与端口都消失；再次双击时旧记录因端口无人应答而被判过期，新服务带着新 token 起来并重写记录。
- **Run 期间提示**：`BASE_ORIGIN=http://127.0.0.1:9`（死端口，避免真下 2 GB）下点开始，窗口依次打印「抓取已开始:下载期间请不要关闭这个窗口。」与 Run 自己的 pino 输出，Run log 正常落盘并如实报缺陷。
- **标记检查**：给 `run.js` 与页面入口写上真实的 `:Zone.Identifier` 流，窗口打印中文解除步骤并点名这两个文件。
- 四件套：`pnpm fmt:check` 0、`oxlint --type-aware .` 0 warning 0 error、`pnpm typecheck` 0、`vitest run` **47 文件 / 499 tests**；`pnpm build` 正常（页 112 文件、`server.js` 932 KiB、`run.js` 2124 KiB、外部依赖仍只有 `sharp`）。
- **没有真跑完整 Run**：下载段没有在包布局上跑；本轮只证明「启动器 → 服务 → 点开始 → 子进程起来并写日志」这条链。

**教训**：
- **编码是「保存方式」的属性，不是语言的属性**。同一个中文句子，四种存法在同一台机器上得到三种显示结果；`chcp 65001` 只在其前置条件成立时正确，而 BOM 会把第一行整行变成一个命令。判断这个问题的唯一可靠方式是**真窗口 + 真实截图**，不是读文档也不是读字节猜显示。
- **探测不能依赖被保护对象的慢路径**。单实例探活若复用 `/api/status`，站点慢就会把「服务在忙」误判成「服务不在」，于是这次修复本身造出它要防的第二个进程。
- **「脚本不含逻辑」会把检查挪进程序，也会留下一个边界**：`node.exe` 自己被系统拦住时 Node 根本不会运行，任何中文都无法打印；`pause` 至少让系统消息留在屏幕上。这条边界写进 ADR 与 AGENTS，而不是假装覆盖了。
- **窗口关闭不是干净退出**。控制台关闭是 OS 终止，`exit` 处理器不跑，记录必然留下；所以「过期」只能在读取时用探活证明，不能靠「文件还在就说明服务还在」。

### 2026-10-21 — 更新器：换掉 `app\`，`data\` 一个字节都不碰（#87 / spec #75）

**触因**：便携包的更新故事是「下载新 zip、解压、双击 `更新.bat`」，而这句话只有在「用户的图、日志和配置不在被替换的那个目录里」时才成立（ADR 0019 已经把数据搬到 `data\`）。剩下的是动作本身：程序目录要被整体换掉，旧的要留作回退点，而用户可能早就把文件夹改了名或搬了盘。更危险的是这会是全仓库唯一一个**删除用户可见目录**的模块——「不碰 `data\`」必须是代码里的闸，不是文档里的句子。

**决策**：
- **先定位，再动手**：`%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json`（#85 每次启动重写）是默认地址；拖到 `更新.bat` 上的路径优先，并且接受三种拖法（旧 `启动.bat`、整个安装文件夹、`app\` 本身）。`data\` 只被 `stat`，从不被打开、改名、复制或删除。
- **校验全部放在第一次改名之前**：包根不能就是安装根（用户把新 zip 解压到了旧安装里，只有一个 `app\`）；目标必须存在；目标必须同时有 `app\` 与 `data\`；新包的 `app\` 必须齐全（`server.js`/`run.js`/`update.js`/`node.exe`/`web/dist/index.html`）。每一条都有自己的中文说法与「怎么办」。
- **运行中的服务是拒绝，不是风险**：Windows 允许重命名正在运行的 exe，但不允许删除；此时换目录只会留下半新半旧的树。判断直接复用 #82 的探活（记录里的端口 + token，1.5s），拒绝信息里带上那个页面的 URL，告诉用户关掉窗口（关窗口就是停止）。
- **复制新 `app\`，不重命名源包**：下载目录和安装目录经常不同卷，`rename` 会 `EXDEV`；复制也让用户解压出来的那份保持完整，失败可以原地重试。
- **顺序与回滚**：清掉上一代 `app.old` → `app` 改名 `app.old`（原子）→ 复制新 `app\` 到位。复制失败时删除写了一半的 `app\`（只此一处，且路径由 `programTreePath` 校验）→ 把 `app.old` 改回 `app\`。回滚本身失败时不谎称成功：直接说明旧程序完整地在 `app.old\`，请手动改名。
- **只保留一代回退点**：下一次更新覆盖 `app.old\`，从不清更多代；不做跨次自动回滚（一次临时错误静默降级一个跑得好的版本，比「更新失败」更糟），回退是用户确认后的手动动作。
- **`programTreePath(installRoot, name)` 是唯一的递归删除入口**：只接受 `app` / `app.old` 两个名字，解析结果必须是安装根的直属子目录；`data`、`..`、绝对路径、其他名字一律抛错。这条闸比任何注释都可靠，因为它把「不删数据目录」变成了一次路径解析的失败。
- **更新器是构建产物**：逻辑在 `web/server/updater.ts`（真文件系统可测），窗口对话在 `web/server/update-entry.ts`，两者打成 `app\update.js`（`scripts/build.ts` 的第三个入口）。`packaging/更新.bat` 与启动器同形：纯 ASCII、CRLF、零逻辑，只做 `cd` 与 exec。
- **`"%~dp0."` 的尾点**：`%~dp0` 永远以 `\` 结尾，而 Windows 命令行里 `"C:\path\"` 的反斜杠会转义右引号；加一个 `.` 让引号正常闭合，`path.resolve` 再把它消掉。
- **成功也不闪退**：`update-entry.ts` 打印结果后等回车（`stdin` 不是 TTY 时不等待），这样「双击→看结果」不需要 `.bat` 里多一行逻辑；失败仍由 `.bat` 的 `pause` 接住。

**验证**：
- `tests/web/server/updater.test.ts`（14 个）在临时安装上跑真实文件系统：`data\` 以「相对路径 → SHA-256」比较，包含 `layout.json`、`instance.json`、`.gallery-state.json`、缩略图缓存与 `user.env`；覆盖成功、指针缺失/失效、拖拽失效安装、目标不存在、缺 `app\`/`data\`、同根、包不完整、真实 socket 上的「程序正在运行」拒绝、拷贝中途失败回滚、连续两次更新后 `app.old` 只有一代、旁边用户自己的文件夹不被动、`programTreePath` 的拒绝集。
- **两个真制品端到端**：`pnpm package` 出 `v1.0.0.zip`；把 `package.json` 临时改成 `1.0.1` 再 `pnpm package` 出 `v1.0.1.zip`（随后还原，`git diff package.json` 为空）。解压到临时目录、手工造 `data\`（6 个文件）、写指针，然后**用 cmd 执行真正的 `更新.bat`**：v1.0.0 → v1.0.1 退出码 0、0.5 s；把安装文件夹改名为 `我的 壁纸工具` 后拖旧 `启动.bat` 到 v1.0.0 的 `更新.bat`：1.0.1 → 1.0.0 退出码 0；两次之后 `data\` 的 6 个文件哈希逐一不变，`app\` 与 `app.old\` 各 240 个文件 / 117.5 MB，`node.exe` 92,534,088 字节且哈希与各自源包一致。第三次在真实监听端口上放一个应答 `/api/instance` 的服务：退出码 1、窗口打印拒绝与页面 URL、`app\` 与 `data\` 均未改动。
- **杀软实测**：本机只有 Windows Defender（`SecurityCenter2` 仅列它），实时保护、行为监控、IOAV、按访问保护全开（`AMRunningMode: Normal`，引擎 1.1.26090.9 / 签名 1.461.118.0），无第三方产品。两次真实更新各 0.5–0.6 s 完成，逐文件哈希校验通过；更新后 `Get-MpThreatDetection` 为 0，Defender 事件日志在窗口期内只有 1150/1151 两个健康事件，**没有** 1006/1007/1116/1117 之类的检测或处置事件。无法观察的部分：其他机器与其他杀软、云端延迟判定（数分钟后才处置）、以及真实交互窗口里的双击（本轮用 `cmd /c` + 重定向 stdin，`.bat` 本身的行为一致）。
- 四件套：`pnpm fmt:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿；`pnpm package` 正常，归档含 `更新.bat` 与 `app/update.js`。

**教训**：
- **「中途失败」在单卷上造不出来**。`fs.cpSync` 在同一块盘上要么成功要么立刻抛错；要证明回滚，只能把「复制」这一个操作变成可注入的故障点，但断言必须落在真实文件系统上（回滚后的 `app\`、消失的 `app.old\`、逐字节不变的 `data\`）。把注入点缩到最小，并写明它为什么存在。
- **`%~dp0` 的尾反斜杠会吃掉自己的右引号**。`"%~dp0"` 在 Windows 命令行里不是「带引号的目录」，而是「转义了右引号的字符串」；`"%~dp0."` 才是。这个坑在纯 ASCII 脚本里看不出来，只在 Node 收到的 argv 里现形。
- **中文注释也会让 `.bat` 变成非 ASCII**。注释里写「见 启动.bat」六个汉字，就足以让 1293 字节的脚本出现 6 个非 ASCII 字节——而 `.bat` 的编码规则只认「整份文件」；验证脚本必须逐字节数 `>127` 的个数，而不是看 `Get-Content` 的显示。

### 2026-10-22 — 页面有了出口、运行面板只剩四行、墙就是镜像（spec #93 / 票 #94–#98，v1.0.1）

**触因**：1.0.0 的页面把玩家真正会问的三件事埋在了别的东西下面。

- **「抓全了吗?」** 头一行写的是「官方清单有 1013 条;镜像有 1002 个文件。」,要玩家自己减；更糟的是本地只要留着一张下架旧图，`officialTotal > mirrorCount` 这条续抓判断就永远不成立——12 张缺失也照样显示"完整"。
- **「怎么停?」** 唯一的停止是关掉那个黑色窗口（ADR 0016 / 0020："页面没有停止控件"）。关掉浏览器标签看起来像停止，下载却还在跑：一个看着像程序的页面却关不掉它，教给玩家的是错的模型。
- **「为什么还让我配置?」** 玩家照提示建好 `.env`，提示还在——页面只在启动时读一次 status，之后只在 Run 期间轮询；文案还叫"仓库根目录"，便携包里没有这个目录。

**决策**：

- **页面拥有一个退出，且只有退出**（ADR 0022 推翻 ADR 0016 / 0020 的同一句，其余条款不动）。让这次反转诚实的是八条条件，不是那个按钮：① 它是退出，不是停 Run / 暂停，所以没有"停 Run 但留服务"；② 确认规则字面上就是终端的 `stopDecision`，页面只把服务的 `409` 呈现出来，不自己判断何时问；③ 判断住在 `run-control.ts`（`exitDecisionOf` + `createExitController`），生命周期住在 composition root；④ `202` 先写出、再定时 shutdown，且第二次点击不会排第二次；⑤ 所有权是句柄不是镜像名，只杀本 Console 拉起的树；⑥ 所有玩家可见中文出自 Node，启动器窗口在成功与失败两条路上都留着；⑦ `exit-confirm-required` 进 `web/api-types.ts` 的词表，两种语言都有人话；⑧ 页面仍然不自己启动任何东西，退出后停掉轮询、变成一张通知。
- **被否决的**：保留"页面无停止控件"（实测的失败就是关标签以为停了）；"停 Run 但留服务"（ADR 0009：终端的 Run 没有句柄，这个控件只能半停，还会留一个空转的页面）；让页面按自己最后一次 status 判断要不要问（那就是第二条规则，而且它可能已经过期）；按镜像名杀或只杀服务进程（Windows 上父进程死了子进程照活）；内联 shutdown 靠响应 flush（socket 可能先关掉，`202` 会变成断连）；把中文放进 `启动.bat`（ADR 0020 的实测结论）；成功退出立刻关窗（最后一行中文就是"什么停了"的证据）；重写 ADR 0016 / 0020（它们是当日决策，只被取代一个条款）。
- **墙就是镜像**：行集 = 清单里、名字是 Wallpaper、文件真在盘上的条目（保持清单顺序）+ 盘上多出来的 Wallpaper；行模型丢掉 `state` 与 `viewable`，`GALLERY_ROW_STATES`、`ConsoleGalleryRowState` 与那套 copy 一起退役，页面不再判断"这张能不能显示"，也就永远不为一个不在的文件请求缩略图。**缺口仍是集合运算**：`mirrorGap` 的两个数由服务端算，绝不从行里反推——一旦从行反推，"本地多出的旧图"就会把缺失数抵消成 0，正是这次要修的那个谎。头一行 `官方清单 N · 已下载 N · 缺失 N`（有旧图再补 `· 本地多出 N`，清单没读到就是"官方清单未读到"），墙头和面板读同一个 `galleryFiguresOf`，两个地方不可能一个说 1001 一个说 1013。
- **一次读**：整页只读一次 `/api/gallery`（`composables/useGallery.ts`），墙和面板共用一个快照；两次读就是两个答案。
- **续抓判断改看缺口的 `missing`**（`lib/wall-state.ts` 的 `wallBandOf`），不再比较官方总数与镜像数；"还剩多少"就是同一个数（`facts.missing`），"已下载"就是 `facts.downloaded`（数字行的补数），头一行与续抓控件因此不可能各说一套。
- **运行面板只剩四行**：一句结论、`成功 N · 失败 N`（失败为 0 时不印）、与墙头同一行数字、最多一句问题话，另加开始控件；孤儿清理仍是有动作的那个状态，压成一句 + 一个按钮。问题话的优先级钉在 `lib/run-panel.ts`：报告缺失 → 报告读不懂 → 空文件 → 持续失败 → 连不上官网 → 空结果 → 缺口 → 结论自己的原因。退役的是 Run id、时间戳、六个 Discovery 数、成功率、重试救援率、九行缺陷与 `reasons:` 子句——它们没有一个回答"这次成没成"。
- **设置提示自清**：只留两行（为什么不能开始 + 要写的那一行），文件名说成"程序旁边"的那个 `.env`。窗口重新获得焦点、抽屉打开各重读一次 status，用的还是 start 的 `env-file` 拒绝那一个谓词；照提示建好文件，切回页面就没了，不用刷新。
- **版本 1.0.1**（ADR 0021 的 PATCH：修，不新增配置键也不动数据布局）。#92（`chore(ci): drop an input the setup action does not have`，删掉 `pnpm/setup@v2` 不存在的 `require-lockfile` 输入，三个工作流行为不变）随这一版发出，对玩家不可见，所以它只在本文留这一句，**不进 CHANGELOG**。

**验证**：

- `pnpm build`：`version 1.0.1`，页面 112 个文件，`server.js` 935 KiB、`run.js` 2127 KiB、`update.js` 17 KiB，外部依赖仍只有 `sharp`，打进 bundle 的 25 个包。
- **构建树搬到仓库之外真启动**（`%TEMP%\re1999-smoke\app` + 同级 `data\`，`packaging/site.env` → `app\.env`，这棵树里没有 `node_modules`、没有 `.ts`、没有 tsx/vite）：`GET /api/status` → `200`，`{"version":"1.0.1",…,"runConfigAvailable":true}`。
- **空闲退出**：`POST /api/exit {"confirm":false}` → `202 {"exiting":true}`，窗口打印「服务已停止。」「程序已退出。」，退出码 0，`data\instance.json` 被清掉，**再启动一次照常**（同一棵树，第二次 `200` + `1.0.1`）。
- **Run 在飞时先问**：服务起来**之后**再往 `data\logs\` 写一条 `run-2026-10-22T11-45-00.jsonl`（只有 `run_meta`、没有 `run_report`、mtime 是现在）→ `{"confirm":false}` → `409 {"exiting":false,"refusal":{"code":"exit-confirm-required","missing":[]}}`；`{"confirm":true}` → `202`，窗口只打印「本 WebUI 没有启动那个运行:只有服务停止,它可能还在继续写入。」+ 服务已停止 + 程序已退出，退出码 0，**Run log 逐字节未动**（ADR 0009）。
- **孤儿日志与新一次启动**：第三次启动看到那条日志已是 `orphaned`（启动时就在的未完成日志），status 照常、退出不需要确认（`202`）、退出码 0、记录不残留——中断过的 Run 不挡下一次双击。
- **启动器字节**：`packaging/启动.bat` 1768 字节、`>127` 的字节 0 个、38 个 CRLF 且裸 LF 为 0、成功路径以无条件 `pause` + `exit /b 0` 结尾（失败路径仍是 `pause` + `exit /b 1`）。
- 四件套：`pnpm typecheck` 0、`pnpm test` **59 文件 / 643 tests**、`pnpm lint` 0 warning 0 error、`pnpm fmt:check` 通过（`pnpm fmt` 先跑）。
- **没有做的**：真下 2 GB 的完整 Run；真实双击窗口（本轮是 `node server.js --no-open --port 0`，窗口字符串由同一份 composition root 打印）；smoke 树里没放 `sharp`（status 与 exit 都不经过缩略图）——发布前的人工双击仍要按 AGENTS.md 的发布流程在干净 Windows 上做一遍。

**教训**：

- **状态的前提是事实，不是文件的形状**。"未完成 + mtime 新"有两种读法：启动时就在的是孤儿（不需要确认），启动之后才写进来的才是活着的 Run（要确认）。冒烟要在服务起来**之后**写那条日志才拿得到 `409`，写在启动前只会得到 `202`——第一版探针正是这么写错的，若不是断言了 `409` 就会被一个假绿放过。
- **门禁全绿不等于"页面能退出"**。composition root 的每一步（杀树、关服务、删记录、退 0、中文）都只在真启动里成立，#84 的教训这一轮又付了一次：这类改动的最低验证标准永远是"把产物搬到仓库之外真跑一遍"，而且必须点那个 HTTP 路径，不是读代码。
- **`202` 必须比 shutdown 先落地**。答案写在关闭之前（50 ms 定时器），否则页面等来的是断连——测试能断言状态码，是因为那一次回答真的写进了 socket。
- **退出不是删除**。ADR 0009 一个字没改：Run log 一个字节不动，被中断的 Run 是下次启动要清理的孤儿记录，不是一种退出状态。
- **诚实只能用玩家相信的那个动作来买**。页面要停就必须能停掉整个程序；一个只停 Run 的按钮会留下一个轮询空转的页面，那只是把旧谎话换个说法。

---

### 2026-10-22 — 发布说明统一模板：七节、无开场、零人称（spec #101 / 票 #102–#105）

**触因**：Release 正文是从 `CHANGELOG.md` 原样截出来的（#88），但形状没定。1.0.0 是开场段加「你的文件在哪 / 怎么更新 / 关于版权」，1.0.1 是另一段开场加「可以从页面退出 / 运行面板只剩四行」。玩家在 Releases 页找不到「改了什么」的边界，也找不到「装哪个文件」；每版都要重抄的部分（下载 zip、解压、双击 `启动.bat`、包名）只能靠记性，抄成上一版包名时没有任何东西会拦。

**决策**：

- **七节固定顺序**：新增 / 变更 / 修复 / 破坏性变更 / 安装 / 升级说明 / 下载文件，只用 `###`（`## ` 会截断小节）。新增、变更、修复至少一节；安装与下载文件每版都在；破坏性变更与升级说明只在适用时出现，**永不写「无」**。正文第一行就是第一个 `###`，不写开场白；每条动词开头，正文零人称代词（你、您、我、我们、咱们、它、它们、他、她、大家、各位）。
- **模板的唯一家是 `CHANGELOG.md` 头部**，紧挨现有的截取规则，字面模板是代码块。`scripts/release-notes.ts` 的 `checkTemplate(body, version)` 是它的可执行一半：CLI 在写出任何东西之前调用，失败指名版本与行号；标题集合从同一模块导出，测试把它与头部模板块的 `###` 行逐条比对；`pnpm test` 还校验仓库当前版本那一节——bump 版本号就得同时把那一节写合规，否则打 tag 之前就红。
- **回改两版**：1.0.0 的「你的文件在哪 / 怎么更新 / 关于版权」删除（README 与包内 `使用说明.txt` 承担），两节按模板重写；两个已发布正文用 `gh release edit --notes-file` 原地替换，附件、tag、发布状态一个字没动。理由：一份形状一致的存档比 1.0.0/1.0.1 当时那几句原话更值。
- **术语**：`CONTEXT.md` → Distribution 增「Release notes（发布说明）」，「Artifact（制品）」的 `_Avoid_` 增 `下载文件` / `assets`——发布页的下载文件是那个包，制品是包里的构建产物。ADR 0023 记权衡与被否决项。
- **不升版本、不写新小节**：这轮对玩家不可见（照 #92 的先例，只在本文留一段）。
- **被否决的**：保留散文、只把模板写进文档（正文就是 changelog 那一节，文档里的模板若文件不照做就是没人执行的规则）；由脚本按版本号自动拼装「安装」「下载文件」（正文就不再是维护者写的那一节，读正文得读代码）；每版单独一个 Release 正文文件（同一次发布两份记录，#88 的「只写一遍」随第二份死掉）；保留 `## What's Changed` 外壳（`## ` 会截断小节，且「安装」语义上不是变更）；用规则检查祈使语气（机器判不了语气）。

**验证**：

- `pnpm test` 59 文件 / 656 tests（新增 13 条：合规通过、正文含 `## ` 行、未知标题、乱序、重复、空节、无变更节、开场白、下载文件写错版本、代词、`其他` 不误伤、仓库当前版本、头部文档与实现一致）。
- **CLI 真跑**：把 1.0.1 的 `### 修复` 临时改成 `### 修复bug` → 退出码 1，stderr 打印「1.0.1 … 第 12 行 … 模板是 新增 / 变更 / …」；改回 → 退出码 0，正文 25 行。
- **发布页**：两个正文与 changelog 对应小节逐字符相等；`v1.0.1` 与 `v1.0.0` 各仍只有一个 zip，`draft=false`、`prerelease=false`。
- 四件套：`pnpm typecheck` 0、`pnpm lint` 0 warning 0 error、`pnpm fmt:check` 通过、`pnpm test` 656 绿。

**教训**：

- **模板的第一条规则就是它自己的敌人**：`## What's Changed` 是二级标题，写进正文会让截取函数当场把这一节截成空——「文档里好看」和「流水线能跑」在标题层级上是同一件事。
- **能自动守住的只有形状**（标题集合 / 顺序 / 空节 / 包名 / 代词词表），语气守不住：正则分不出「精简运行面板：只留四行」和一句关于面板的叙述。这条限制写在 ADR 里，而不是让门禁显得比它更强。
- **代词词表要留后门**：`其他` / `其它` / `迷你` / `自我` 里都含代词字符，不先剥掉就会把正常句子判成违规。

### 2026-10-22 — 迭代循环还清债务：产物在 CI 里启动、worktree 第一遍能跑、决策离开会话就落纸（spec #107 / 票 #108–#113）

**触因**：这一轮改的是产出改动的循环，不是玩家看见的东西。18 个会话、929 步、1,330 次工具调用交出一份正确的改动，同时把同样三笔债原样付了一遍——它们都不是判断失误，所以再小心也修不掉。

- **构建树从没在 CI 里启动过。** `build/` 就是程序——便携包发它，`pnpm webui` 跑它——而 ESM 打包 CommonJS 依赖必须靠 `createRequire` 横幅，这类失败 typecheck、lint 和一千条测试全数放行。CI 只构建页面包，三个程序入口第一次编译、第一次启动都发生在打 tag 时。唯一抓得住它的检查住在维护者桌面上：一份 git 忽略、机器本地的临时脚本，一张票里手写、另一张票里重写，其中一次重写带了个 token bug，只有真跑才现形。
- **worktree 是另一台半坏的机器。** 它的 `node_modules` 是指向父检出的 junction，pnpm 12 的运行前安装拒绝写穿它：一次 fan-out 里 `pnpm <script>` 以 `workspace hoist directory is not a real directory` 失败 53 次，随后又警告「node_modules 可能与 lockfile 不同步」——把读者指向错误的问题。六个实现 agent 各自发明了同一条 120 字符的 `npm_config_*` 前缀并贴到每条命令上；真正解释原因的那句话只存在于一个 agent 勾过的提示里。
- **设计会话什么也不留下。** 同一个问题十二分钟内被重新打开三次，每次重读同样的八个文件、以同样的资料堆收尾；两条后续设计线程得出一致建议，然后没有 issue、没有计划、没有分支。决策在有人写代码之前没有落脚点。
- **数字解析不到 ADR。** 23 个 ADR 没有索引，一天里 agent 猜错三个文件名（`0016`、`0014`、`0022`）——决策的主题无法从编号推出来。
- **常驻的 steering 文件是查找结果的缓存。** 每轮 385 个非空行 / 34.5 KB，其中 118 行 Gotcha 只有打包、构建与 Run log 的工作才需要，另有一段复述格式化器自己的配置。

**决策**：

- **一次维护迭代还清五笔。** 玩家看不到任何变化：不升版本、不写 changelog 小节、便携包里不多一个文件；发布工作流、包布局、更新器与玩家文案一个字没动。整轮只落这一条 `HISTORY.md`，随下一次有话可说的发布一起走。
- **每个 PR 都证明 Console 能启动。** `pnpm smoke:boot`（`scripts/smoke-boot.ts`）把构建树（默认 `build/`）拷进临时根并生成并列的 `app` / `data`，用 OS 分配端口、抑制浏览器启动程序，只经页面自己的 API 驱动：地址里带的 boot token、`/api/status` 报告的版本必须等于构建注入的 `RE1999_VERSION`、磁盘上 `instance.json` 的端口 / token / pid 必须是这次启动的、`/api/exit` 必须答 `202` 再退 0 并清掉记录。同一脚本把 `run.js` 删掉跑第二遍，要求启动前的非零拒绝；再把 `update.js` 放在没有安装指针的临时根上跑第三遍，要求中文拒绝并非零退出——更新器 bundle 因此也证明能加载。它不读 `.env`、不开浏览器、不跑真 Run；唯一的出站请求是 Console 自己那次有界的更新检查（3 秒，永不致命），脚本没有把它关掉。CI 在既有 required check 里加两步（`pnpm build`、`pnpm smoke:boot`），不新增 job：**三个入口都编译，启动的是 Console**，`run.js` 编译后并不执行。
- **worktree 第一遍就能跑 `pnpm`。** `pnpm-workspace.yaml` 写 `verifyDepsBeforeRun: false`，注释点名 junction 与那 53 次失败；它替下的检查——lockfile 与 manifest 不一致——仍在真正执行它的地方：CI 的 frozen install。这是设置，不是要靠 agent 记住的仪式。
- **设计会话留下一条笔记。** `docs/notes/` 一题一文件，四段固定：问题、已定分支、开放分支、被否决分支及理由；约定写在 `docs/agents/design-notes.md`，与 issue-tracker、domain 指针并列。grilling skill 加同一条完成判据，让约定有触发而不只有家；skill 住在仓库之外，这是本轮唯一没有本仓门禁的一步。
- **编号解析到 ADR。** `docs/adr/README.md` 一行一条（编号 + slug + 一句话决策，升序），从 steering 文件指向；`tests/docs/adr-index.test.ts` 用真实目录双向守它——每个 ADR 文件有一行，每一行指向存在的文件——否则索引就是下一个会腐烂的东西。它不是从 ADR 正文生成的：那行是摘要，生成器要么抄标题，要么诱使正文长出第二种格式。
- **常驻文件只留第一条命令需要的。** 包管理器版本策略与 build allow-list 留下（它们会在第一次安装时咬人），`createRequire` 横幅、启动器 ASCII、手册编码、行尾规则、同步 Run log 与钩子段落搬到 `docs/agents/branch-reference.md`，由一个以分支名开头的指针指向；格式化器规则不再复述，`.oxfmtrc.json` 是唯一出处。命令表加三行：满足 edit guard 的 `read`、沙箱下跑一次性脚本的写文件方式、这台机器上真有的搜索。
- **失去消费者的词表让 CI 变红。** `tests/web/src/i18n/vocabulary-guard.test.ts` 从契约源（`web/api-types.ts` 的导出运行时元组）取名单，要求每条要么被字典测试枚举、要么在 `EXEMPT_VOCABULARIES` 里带一行理由；它断言的是豁免而不是缺席——删元组与删文案因此是两次有意的编辑。

**验证**：

- `pnpm smoke:boot`：17 条 `ok`——地址带 boot token、`/api/status` 200、页面报告构建注入的 `1.0.1`（staged `package.json` 的版本被改写成 `0.0.0-smoke`，所以这个数只能来自 define）、`instance.json` 存在且形状 / 端口 / token / pid 全对、`/api/exit` 202 且 `exiting: true`、进程退 0 并清掉记录；删掉 `run.js` 的树退非零、不打印地址、拒绝里点名缺失路径；没有安装指针时 `update.js` 退非零并打印中文拒绝。
- `pnpm build`：`version 1.0.1`，页面 112 个文件，`server.js` 935 KiB、`run.js` 2127 KiB、`update.js` 17 KiB，外部依赖仍只有 `sharp`，打进 bundle 的 26 个包。
- 合并后的最终树上四件套：`pnpm typecheck` 0、`pnpm test` **61 文件 / 672 tests**、`pnpm lint` 0 warning 0 error（165 files / 218 rules）、`pnpm fmt:check` 通过（176 files）。
- steering 文件：385 个非空行 / 34,560 字节（34.5 KB）→ 329 个非空行 / 31,964 字节（32.0 KB），Gotcha 段 118 行 → 33 行，另开 99 行 / 5,649 字节的 `docs/agents/branch-reference.md`；ADR 索引 23 行对 23 个文件。
- **两件没能本地证明的。** worktree 设置：一次安静的探针（新 worktree、junctioned `node_modules`、强制依赖检查、改过的 manifest）没有复现失败，所以它的证明是下一次 fan-out 的日志里不出现任何 `installing dependencies` 行；若设置不生效，退路是每个 worktree 建好后跑一次 `pnpm install --ignore-scripts`。grilling skill 的完成判据：skill 住在仓库之外，本仓没有任何门禁能覆盖它，只能靠这条记录。
- **没有做的**：Windows 专属面（两个 `.bat`、更新器的真实换目录、junction 布局、手册渲染）仍由真机手验，启动脚本自己的注释写明了这个边界；跑一次完整 Run 不在本轮范围。

**教训**：

- **门禁全绿不等于产物能启动。** typecheck、lint 与测试从不加载 `build/`；`createRequire` 横幅只在真启动时被调用。#84 的教训这一轮被写成每个 PR 的两步，而不是又一句提醒。
- **被复述五遍的坑仍会复发，除非它住进工具。** `npm_config_*` 前缀被六个 agent 各自发明，说明写进提示等于没写；`verifyDepsBeforeRun: false` 是唯一不靠记性的形态。
- **算不出来的东西要落纸。** 同一个问题重启三次就是同一份资料重读三次；一条带「已定 / 开放 / 否决」的笔记把这次探索变成下次的输入。笔记没有门禁，只能靠下一个读者从它出发——这一篇本身就是这么被检验的。
- **索引要自带守卫。** 23 个 ADR 没有索引时，猜错三个文件名是正常行为；一行一条加一个双向测试之后，新增 ADR 不带行就红。
- **测试只断言它真读到的。** 词表守卫从契约源码取名单，不做第二份手抄；启动冒烟断言「删产物必须拒绝」，不抄那句中文拒绝——重复一句文案会锁死一句本可以改的话。

---

## 已否决方案速查（改动前先看这里）

| 方案 | 否决原因 | 出处 |
|------|---------|------|
| 把源包的新 `app\` 直接 `rename` 进安装目录（而不是复制） | 下载目录与安装目录常不同卷，跨卷 rename 会 `EXDEV`；复制还让解压出来的包保持完整，失败可原地重试 | 2026-10-21 / #87 |
| 发现程序在运行也照常更新 | Windows 允许重命名运行中的 exe 却删不掉；结果是一棵半新半旧的树，比拒绝更糟。先让用户关窗口（#82 的记录正好能回答「谁在跑」） | 2026-10-21 / #87 |
| 跨次自动回滚：下次启动发现新版本起不来就把 `app.old` 换回去 | 一次临时错误会静默降级一个跑得好好的版本；回退是用户确认后的手动动作（spec「更新器」） | 2026-10-21 / #87 |
| 在 `更新.bat` 里写 `ren` / `move` / 判断 | 无法单测、无法回滚、也无法打印中文；逻辑必须进 `app\update.js`，脚本只做工作目录切换与 exec | 2026-10-21 / #87 |
| 更新前先删掉整个 `app\` 再复制新目录 | 删除与复制之间的任何失败都让用户彻底没有程序；先改名留回退点，失败时改名回来是原子的 | 2026-10-21 / #87 |
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
| 直接复用 `sxzz/workflows` 的 `unit-test.yml` | 其 test job 无条件跑 `pnpm run build`；当时本仓（爬虫）无 build 脚本——2026-10-18 起 Console 的页面是本仓第一个构建产物（ADR 0011） | 2026-09-15 |
| 继续用「磁盘文件数 + 单调 max」当官方总数 | 分不清「站点没上新」和「我们丢了文件」，且一次删除或一次杂项漏进就让 delta 永久为 0 | 2026-09-15 |
| 用文件名前导数字当官网编号 | 1001 条里 625 条与真实 id 不符，id 6–20 连 title 都没有（实测） | 2026-09-15 |
| 结构化「画廊家族」判据（`/PICTURE/` + 数字开头） | 有权威清单后属于多余的猜测；判据越少越不会自己出错 | 2026-09-15 |
| 只用接口取总数、其余照旧 | 头号数字诚实了，delta 还是错的 | 2026-09-15 |
| 在 Discovery 的网络捕获里收 `application/json` 清单 | 把权威数字绑在一次未必发生的渲染上，且一个捕获里混两种 content-type | 2026-09-15 |
| 把 Run log 的文件 target 留在 pino transport（worker 线程），只补 `logger.flush()` + error handler | `2026-09-15T09-36-50` 那轮 worker 停摆后主线程静默续跑、退 0 且丢光 `run_report`；`flush()` 只能缩窗，已死的 worker 无从 flush | ADR 0007 |
| 用 Node 原生类型擦除（`node src/main.ts`）替代 tsx | 源码以 `.js` 后缀 import 兄弟模块，Node 不改写为 `.ts`，模块解析直接失败（Node 24.18 实测 `ERR_MODULE_NOT_FOUND`） | 2026-10-18 |
| 换启动器（如 `node node_modules/tsx/dist/cli.mjs`）规避受限沙箱的命名管道限制 | 需要管道的是管线自己的子进程（`playwright-cli` + esbuild service），换启动方式绕不开；且属明令禁止的「retry another way」 | 2026-10-18 |
| 把爬虫目录命名为 `crawler/` / `scraper/` | 词表明确回避这两个词（本程序不跟随链接），与领域模型矛盾的目录名会误导此后每一次 grep | 2026-10-19 |
| 本轮一并搬 `scripts/`（或重新钉它的载荷排除方式） | run-code 载荷的排除在两个工具配置里按**字面路径**钉死、目录名又被 discovery-loader 指名——三种静默失败换一个好看点的名字 | 2026-10-19 |
| 在仓根给两层引入第三棵「共享」目录 | Console 是 Run 产物的读者，不是第二个库消费者；给一个读者做共享层是白买的抽象 | 2026-10-19 |
| `console` 名字保留、只补文档 | 名字本身就是问题：读起来像浏览器 devtools 的 console | 2026-10-19 / ADR 0012 |
| 改名时保留 `console` 兼容别名 | 仓库外没人敲它；两个名字重建了这次要消掉的歧义 | 2026-10-19 / ADR 0012 |
| 连领域词 Console 与内部文件名一起改 | 词被日期化的 ADR 与词表引用，而没人敲目录名 | 2026-10-19 / ADR 0012 |
| 引入 Onu UI 组件库 | npm 停在 2024-11-10；preset 锁 `@unocss/preset-mini ^0.64`，与 unocss 66 会装出第二份 core；wind4 重写未发版；文档域名不解析；无 i18n | 2026-10-19 / ADR 0013 |
| 用 `vue-i18n` 承担两种语言 | 几十条文案不值得一个运行时与构建插件；类型化字典让漏翻成为编译错误 | 2026-10-19 / ADR 0014 |
| 服务端按 `Accept-Language` 返回中文文案 | 文案会有两个来源，切语言还要再请求；改成只出 code + 参数 | 2026-10-19 / ADR 0014 |
| 把 CJK 字体二进制提交进仓库 / 用 MiSans、HarmonyOS Sans、商业展示体 | 仓库不背字体字节（改为 devDependency，产物进 gitignore）；后者授权不允许再分发或无法一手核实 | 2026-10-19 / ADR 0015 |
| 让 tile 等图片加载后再排 masonry | 整面墙会在读者光标下重排；改为服务端给出真实像素尺寸 | 2026-10-19 / #48 |
| 为「CSS 内嵌资源」放宽守卫（允许无 token 取 `/assets/*.woff2`） | 守卫退化成两套凭据；改为样式表在出口处带上调用者的 token | 2026-10-19 / fix |
| 把 Discovery script 副本放 `%TEMP%` | 合法性只靠 playwright-cli 硬编码 `skillMode: true` 绕过 `--filename` 的允许根检查；换版本就可能变成 `File access denied`，而失败发生在 Run 的第 2 步（浏览器已开） | 2026-10-20 / #51 |
| 内联 `code` 取代 `--filename` | 协议支持且实测可达（多行 + `#"/%&\|< >^` 原样到达），但 shell-less 启动只能点名全局 `@playwright/cli` 的 JS 入口（`npx.cmd` 无 shell → `EINVAL`），脆；而它省的 ~600 ms/次另属一题 | 2026-10-20 / #51 |
| 去掉哈希注入，让 `--filename` 直接指向 `scripts/run-discovery.js` | 要改协议载荷、把单一来源的 `PAGE_HASH` 复制成两处，且只能靠真跑验证 | 2026-10-20 / #51 |
| 固定名副本 + 原子写（tmp + rename） | Run 已串行化、"内容不同才写"把窗口压到微秒；rename 反而把刚去掉的临时文件搅回来 | 2026-10-20 / #51 |
| 保留 `save-wallpapers`（旧名，或给 `core:run` 加兼容别名） | 旧名本身是给用户看的命令名；两个名字重建这次要消掉的歧义（与 ADR 0012 删 `console` 同一理由） | 2026-10-20 / #58 / ADR 0016 |
| README 同时教两个入口（终端一条、页面一条） | 新用户最先看到的是错的那个门；人类入口只留 WebUI，命令线归 agent | 2026-10-20 / #56 / #61 / ADR 0016 |
| 让页面代写 `.env` | 往仓根写文件是 Console 从未有过的所有权；由页面说明、用户创建，start 的 `env-file` 拒绝承担教学 | 2026-10-20 / #57 / ADR 0016 |
| ~~现在给页面加停止按钮~~ **已被 ADR 0022 / #93 取代（2026-10-22）**：页面确实有了一个控件，但它是**退出**（停掉整个程序），不是停 Run；确认规则仍是终端的 `stopDecision`。原否决理由（整棵进程树的停止没有诚实的 HTTP 表示）成立，所以这个控件只做它能诚实做到的那件事 | 2026-10-20 / #56 / ADR 0009，见 ADR 0022 |
| 让 Run log 的名字跟着命令走（`save-wallpapers-…` 或 `core-run-…`） | 命令会改名，日志名不该绑在一个会变的命令上；`run-` 只承载 Run，旧前缀永久可读 | 2026-10-20 / #59 / ADR 0016 |
| 每次 status 请求重推 Gallery list 端点（让新建 `.env` 免重启生效） | 端点属于注入的配置，list source 只构建一次并带自己的读取缓存；每请求重推等于每请求重建数据源，status 与 gallery 行还可能读成两份。代价已写进 README：新建 `.env` 后要重启 WebUI 才读站点清单 | 2026-10-20 / #57 / #62 |
| 把 `runConfigAvailable` 当 boot fact 只读一次 | 页面开着时创建 `.env`，提示永不清除；改为每 status 读一次文件（无 PATH 扫描、无注册表查询），且与 start 的拒绝同谓词 | 2026-10-20 / #60 / ADR 0016 |
| 让路由器默认序列化产出响应（`c.json`、默认 404/405 文案） | 默认头与页面测试断言的逐字节字符串不同（`application/json` 无 charset），404/405 文案与 `allow` 头也会跟着变 | 2026-10-20 / #72 / ADR 0017 |
| 用 `serveStatic` 一类静态帮手产静态资源 | 只做路径→字节流，不能把 token 写进 CSS 的 `url()`；实测 16 个 webfont 会全部 403 | 2026-10-20 / #72 / ADR 0017 |
| 用 express 5 / fastify 5 / srvx | express 的 `res.send` 模型诱导把领域判断塞进 handler；fastify 的 schema/插件体系大于需求；srvx 1.0 太新 | 2026-10-20 / #72 / ADR 0017 |
| 页面按特性分目录（`features/gallery`、`features/run`） | 一面墙 + 一个抽屉，目录数会超过它组织的代码 | 2026-10-20 / #69 |
| 让页面继续自己判断 tile 能不能显示 | 与 `core/wallpaper-url.ts` 的扩展名清单是手抄副本，漂移的症状是每个 tile 一次注定 400 的请求 | 2026-10-20 / #70 |
| 引入 vue-query / swrv / @vueuse/core 做页面数据层 | 两个 GET + 一个 5 秒轮询，库带来缓存键/重试/invalidate 语义却换不掉那 30 行；页面不为两个函数背一个包 | 2026-10-20 / #69 |
| 清单失败时回退到浏览器捕获 | 一轮 Run 里两套 URL 集就是 ADR 0002 否决过的重复表示；而且捕获到的只是一小半画廊，不叫回退。清单失败就响亮地报缺陷（`gallerySourceUnavailable` + `emptyResult`），不下载任何东西 | 2026-10-21 / #76 / ADR 0018 |
| 保留浏览器捕获、同时把清单当第二个真源 | 同一个理由，而且它会把全局 CLI 与 Chrome 两个前置条件留下来，只为产出一个没人该据此行动的数字 | 2026-10-21 / #76 / ADR 0018 |
| 删掉报告里不再变化的键（`siteAssets`、`stableRounds`、`discoveryLeak`…） | `check-run`、`web/api-types.ts`、Console 与 run-log 读取器都消费这个形状，读取器还会拒收缺键的报告；票的验收就是格式不动。诚实的常量比契约版本便宜 | 2026-10-21 / #76 / ADR 0018 |
| 因为「没有丢东西」就把 `siteAssetFalsePositive` 写成 `null` | `null` 在这个块里的既有含义是「清单不可用、未检查」，且 run-log 读取器把它与 `mirrorGap` 的 null 绑定；写错会让每份新报告整份不可读、每轮判缺陷。读清单时用 `{count: 0, urls: []}` | 2026-10-21 / #76 / ADR 0018 |
| 删掉 `scripts/run-discovery.js` 但保留 loader / `.run-cache/` | 它们只为 `run-code` 存在；留着会继续维护两个工具排除项和一个根目录，还诱导别人把爬取恢复回来。连引用一起删 | 2026-10-21 / #76 / ADR 0018 |
| 保留 cookie 头以防万一 | CDN 与清单都匿名可用（2026-09-15 的 12/12 抽样），会话是 Run 已不再拥有的状态；Download 的第一个单测就断言请求里没有 `Cookie`，403 重试保留 | 2026-10-21 / #76 / ADR 0018 |
| 把用户数据留在程序目录，只用文档叮嘱「别删」 | 便携包的更新是整体替换 `app/`；文档拦不住被替换掉的 `images/` | 2026-10-21 / #80 / ADR 0019 |
| 缩略图缓存继续留在 `web/.console-cache/` | 可丢弃不等于值得丢：每次更新白掉 1000+ 张，首次打开重新变慢；移出后仍在 Mirror 之外 | 2026-10-21 / #80 / ADR 0019 |
| 旧数据用「复制后删除」或跨卷自动复制 | 复制可能中途失败，随后的删除把失败变成数据丢失；同卷 rename 在失败时原样保留旧目录 | 2026-10-21 / #80 / ADR 0019 |
| 旧目录与新目标同时存在时自动合并 | 两边都可能是 Mirror，静默并集会让 `mirrorGap` 变成合并动作的产物；改为拒绝并给手工步骤 | 2026-10-21 / #80 / ADR 0019 |
| 遇到更高/未知 `layout.json` 就回退默认值继续启动 | 这正是「官网 1010 / 本地 0」的静默失败；版本不认识就在第一次写入前拒绝 | 2026-10-21 / #80 / ADR 0019 |
| Console 继续用 tsx 启动 Run，只在打包时换成另一个入口 | 两套启动路径意味着开发期永远测不到发布形态；「页面能开、点运行就崩」正是 #84 要消灭的故障 | 2026-10-21 / #84 |
| 保留 `ensureBundle`：缺页面时首启现场用 Vite 编译 | 用户机器上就出现了打包器及其原生绑定，且首次点击要等构建；页面是构建产物，缺了就该在构建/打包阶段响 | 2026-10-21 / #84 |
| 把 `pino`/`undici`/`hono` 留成外部依赖、随包带 `node_modules` | 便携包承诺只有 `node.exe` + `sharp`；随包 `node_modules` 等于把解析规则、平台二进制和体积一起带进去 | 2026-10-21 / #84 |
| 把 `tsx-entry` 前置检查改名为 `run-entry` 保留 | 它检查的 `node_modules/tsx` 在打包树里永远不存在；而「缺 `run.js`」是构建/打包错误，属于启动时的构建产物闸，不是每次点运行都要查一遍的运行期前置条件 | 2026-10-21 / #84 |
| 构建产物继续写在 `web/dist`（与源码混居），只把入口放进仓根 | 应用根必须是显式输入，而源码树里遍地 `.ts`——「从产物运行」就无从演示，也无法阻止运行期解析到源码 | 2026-10-21 / #84 |
| 用 `RE1999_APP_ROOT=build` 前缀跑 `pnpm webui` | 跨平台 shell 里给 npm script 设环境变量要额外依赖（`cross-env`）；`cd build && node server.js` 在 cmd 与 sh 里都成立，且与包的启动器同形 | 2026-10-21 / #84 |
| 让 `.bat` 自己打印中文（UTF-8 无 BOM / `chcp 65001` / GBK / 带 BOM） | 真窗口实测四种结果：无 BOM 乱码；`chcp 65001` 只在无 BOM 时正确且把系统消息变英文；带 BOM 时第一行变成 `'锘緻echo'` 这条命令；GBK 只在本机正确。中文改由 Node 打印 | 2026-10-21 / #85 / ADR 0020 |
| 用 `/api/status` 做单实例探活 | status 是页面轮询，可能顺带请求官网清单；探测一慢就被读成「没有服务」，反而起了第二个 | 2026-10-21 / #82 / ADR 0020 |
| 把运行时记录写进程序目录（`app\instance.json`） | 更新是整体替换 `app\`；运行时状态属于 `data\` | 2026-10-21 / #82 / ADR 0020 |
| 用独占锁文件代替探活 | 锁同样需要过期判定（崩溃留下的锁），而它只能证明「有人写过文件」；探活问的是「服务真的在答吗、token 对不对」 | 2026-10-21 / #82 / ADR 0020 |
| 启动器里创建 `data\`、写安装指针、检查 `Zone.Identifier` | 每件事都要一个判断和中文，正是 `.bat` 不可靠的部分；挪进程序后还能被单测与真跑覆盖 | 2026-10-21 / #85 / ADR 0020 |
| 发现 Mark-of-the-Web 就拒绝启动 | 解压后的树通常照样能跑；把一句可执行说明换成一次拒绝是更糟的支持面 | 2026-10-21 / #85 / ADR 0020 |
| ~~给页面补一个停止按钮，让「关窗口」不再是唯一停止方式~~ **已被 ADR 0022 / #93 取代（2026-10-22）**：页面现在有 Exit，关窗口与它都是停止；但"页面拥有停止控件"的边界没变——停 Run 单独一个控件仍然不做，因为它需要一个 ADR 0009 拒绝的句柄。原否决理由只对"停止按钮"成立 | 2026-10-21 / #85 / ADR 0020，见 ADR 0022 |
| 保留叙事散文、只把模板写进文档 | 正文就是 changelog 那一节；文档里的模板若文件不照做，就是一条没人执行的规则，漂移正是这轮要结束的东西 | 2026-10-22 / #101 / ADR 0023 |
| 由脚本按版本号自动拼装「安装」「下载文件」 | 正文就不再是维护者写的那一节，changelog 也不再显示 Release 说什么；读正文得读代码 | 2026-10-22 / #101 / ADR 0023 |
| 每版单独一个 Release 正文文件 | 同一次发布两份记录，「只写一遍」的不变式（#88）随第二份死掉 | 2026-10-22 / #101 / ADR 0023 |
| 保留 `## What's Changed` 外壳 | `## ` 会截断小节；而且「安装」语义上不是变更 | 2026-10-22 / #101 / ADR 0023 |
| 用规则检查祈使语气 | 机器判不了语气，能守住的只有代词词表与标题形状 | 2026-10-22 / #101 / ADR 0023 |
| 给 steering 文件每个链接做存在性测试 | 链接能解析不等于读者会打开它；这次量到的失败是 agent 从不打开分支文档，验证只能是行为性的（下一次 fan-out 能否经指针找到打包规则）。链接测试会把散文的形状钉死，却在真正的触发失败时照样绿 | 2026-10-22 / spec #107 / docs/notes/iteration-loop.md |
| 从 ADR 正文或 frontmatter 生成索引 | 那行的一句话是摘要，生成器要么抄标题、要么诱使 ADR 长出第二种格式；索引会从查找表变成决策的第二份副本 | 2026-10-22 / spec #107 / docs/notes/iteration-loop.md |
| 把词表守卫并进 ADR 索引测试 | 两者读不同的对象（`docs/adr/` 的 Markdown 对 `web/api-types.ts` 的导出元组）、为不同原因失败；一个测试两条不变式会让红的意义含糊，并让一条躲在另一条后面腐烂 | 2026-10-22 / spec #107 / docs/notes/iteration-loop.md |
| 把启动检查写成单测 | 它要真实进程、真实 socket 与临时应用根；降低一层就丢掉它唯一测的东西——打包与启动的接缝（既有 socket 测试就是先例：驱动真实监听器，不 mock 传输） | 2026-10-22 / spec #107 / docs/notes/iteration-loop.md |
| 为启动检查新增第二个 CI job | 分支保护只认一个 required check，第二个 job 得先加进保护设置；两步放进现有检查零成本，也不新增 required check | 2026-10-22 / spec #107 / docs/notes/iteration-loop.md |

## 验证规范（所有迭代通用）

- 三件套：`pnpm typecheck` → `pnpm test`（vitest）→ `pnpm lint`（oxlint，含 type-aware）；格式化改动加 `pnpm fmt:check`，且大范围重排要做 **AST 对比**（忽略 import 顺序与括号）证明“只改了空白”
- 纯工具链/纯移动类改动不真跑，但要在 PR 里写明「没跑」
- 行为验证：真跑 `pnpm core:run`，读 `data/logs/` 最新 JSONL 的 `run_report`（收敛 / 成功率 / 缺陷自动判定）
- 构建/打包类改动：`pnpm build` 之后**必须把 `build/` 挪到仓库之外真启动一次**（`/api/status` 有响应、`POST /api/run` 能写出 Run log），类型检查与单测对这一类失败不敏感（#84）
- 迁移类任务追加 **Run parity**：新旧 run_report 键集合 + download/defects/failures 深比较

## 开放问题

- ~~**`scripts/` 该不该属于某一层（2026-10-19 记录）**~~ **已解决（2026-10-21）**：#76 删除了 run-code 协议载荷，`scripts/` 只剩提交护栏 `check-branch.mjs`，「协议载荷与工具」那棵第三棵树随之消失；两个工具配置里对载荷的排除也一并移除。

- ~~**捕获量持续下滑（972 → 502 → 21）**~~ **2026-09-04 定性，2026-09-15 修正：该结论只在当时成立。** 09-04 的读数是「官网资源被爬完」：磁盘 971 文件、页面仅存 15 个缩略图、URL 止于 `20260729/976` 批次。09-15 复盘发现官网 09-07 批次已上新 36 张（977–1012），`npm run save-wallpapers` 重跑即自动捕获（幂等：已有走 Content-hash skip，新增下载），磁盘 971→1007 文件 / 1001 张壁纸。**以后不再人工判定「是否全量」——看 `run_report.gallery.officialTotal` 与 `newSinceLastRun`。**
- ~~**过滤逻辑分两道**~~ **已解决（2026-09-15 晚）**：`scripts/run-discovery.js` 的 `shouldKeep` 只剩 `data:`/`blob:`（它们不是可抓取的 URL），23 个 UI 图标文件名与 SVG 判定归入 `src/wallpaper-url.ts`（新增 `filenameIn` 规则）。`combinedCount` 因此真的是原始捕获——真跑实测 172 → 484，多出来的就是以前被静默丢掉的图标 URL，它们现在出现在 `siteAssets`（7 → 34）。
- ~~**(C) 整体坍缩成「接口客户端 + 下载器」**~~ **已完成（2026-10-21，#76 / ADR 0018）**：门槛 `discovery.coverage` 的实测值 0.1798 / 0.4496 / 29.7% 与清单的 1001 条 / 160 ms 一起作为证据，浏览器、会话、滚动稳定性循环、cookie 提取、Site asset 过滤、`@playwright/cli` 与 Chrome 全部退出运行期。`coverage` 保留在报告里、恒为 1（读不到清单时为 null），作为那道门槛的存档。
- **单轮覆盖全清单的跨轮稳定性未验证（2026-10-21 记录）**：票的验收要求「连续两轮真实运行证明条目数不随机波动」，而一轮真下载约 2 GB，本沙箱不跑。逻辑上 URL 集逐条来自清单、无随机性，但站点侧是否稳定（`pageSize` 被截断、WAF、合集变化）只有真跑能证；首轮真跑后应对比两轮 `gallery.officialTotal` 与 `discovery.combinedCount`。
- **清单接口的稳定性未验证**：未公开文档，`pageSize` 上限、WAF/限流、`collectionId` 是否会随新合集变化都未知。失败模式是响的（`gallerySourceUnavailable` defect + `officialTotal: null`），但 `pageSize: 2000` 一旦被服务端悄悄截断，`parseGalleryList` 会直接拒收而不是把缺的那半报成「新增」。
- **镜像缺口只报警、不自动补**：`missingFromDisk` 现在能把缺的条目列出来，而清单里带着它们的 URL——自动补下是可行的（且不受 `data/images/` 文件名不含批次日期的限制），留给后续一轮。
- ~~**oxfmt 全量重排待做**~~ **已完成（2026-09-15 晚）**：`oxfmt 0.67` + `.oxfmtrc.json`（`semi: false` / `singleQuote: true` / `arrowParens: avoid` / `printWidth: 100` / `endOfLine: lf` / `sortImports: true`），`pnpm fmt:check` 进 CI；`**/*.md` 暂不格式化。原先对 `scripts/run-discovery.js` 的永久排除随 #76 删除该载荷一并移除。
- ~~**行尾政策待定**~~ **已解决（2026-09-15 晚）**：本仓一直存 LF，`git ls-files --eol` 报的 `i/lf` 是对的；`git cat-file` 的 CRLF 读数是量具故障。已加 `.gitattributes`（`* text=auto eol=lf`）把 Windows 工作区也钉到 LF，并用 `git checkout-index -a -f` 把工作区刷新为 LF。
- ~~**`autofix.yml` 未接**~~ **已接（2026-09-15 晚）**：`.github/workflows/autofix.yml` 在 PR 上跑 `pnpm lint:fix && pnpm fmt`，再由 `autofix-ci/action@v1.3.4` 把结果提交回 PR 分支（App 已由用户安装）。之所以手写而不是用 `sxzz/workflows` 的 autofix reusable：它的默认命令只有 `pnpm run lint --fix`（不含格式化），且与 `ci.yml` 的 setup 写法保持一致更好读。注意：机器人会往你的分支推提交，改完先 `git pull`，别用 `--force-with-lease` 把它的提交打掉。
- **CI 只跑 ubuntu + node 24**：本仓在 Windows 上开发（#76 之前还有 `--filename` 那段 Windows 专属坑，现在已随载荷删除），若想覆盖，加一个 `windows-latest` job 跑 `typecheck` + `test` 即可；单测是纯逻辑，跨平台收益有限。
- ~~**跑完但日志整段丢失（`run_report` 缺失、进程仍退 0）**~~ **已解决（2026-09-15 深夜，ADR 0007）**：Run log 的文件 sink 改成不经 worker 的同步 destination，`pino-pretty` 也从 transport 改成主线程流，于是进程里不再有 thread-stream——「worker 停摆后主线程静默写进死通道」这一类故障被**结构性消除**，不是缓解。**根因仍然未知**：worker 当初为什么停摆始终没查明，只是它再也无法让报告消失。若将来再出现缺失的 `run_report`，按 `SKILL.md` 的步骤用 `data/images/.gallery-state.json` 与官方清单分账，不要假定是同一个原因。
- ~~**慢网行为待验证**~~ **已验证：修复工作正常。** 2026-09-04 修复后实跑确认 waitForList 触发、滚动探测持续推进、收敛正常；21 张是官网无新资源的真实反映，与慢网修复预期相符。慢网下不再因 idle>45 冻结滚动。
- **本机动态端口区间与 fetch 的 blocked ports 重叠（2026-10-22 记录，本机）**：这台机器的 `netsh int ipv4 show dynamicport tcp` 报 1024–15000，其中包含 fetch 判为 `bad port` 的端口（实测 3659）；用 0 端口监听、再由 fetch 驱动的检查因此出现过 `fetch failed` / `bad port`，单独重跑换了端口就过。Linux CI 的区间从 49152 起，不撞；启动检查为此对 0 端口做两次重试。看到这个错先查端口，不要先怀疑被测代码。
