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

## 验证规范（所有迭代通用）

- 三件套：`npx tsc --noEmit` → `npm test`（vitest）→ `npx eslint .`
- 行为验证：真跑 `npm run save-wallpapers`，读 `logs/` 最新 JSONL 的 `run_report`（收敛 / 成功率 / 缺陷自动判定）
- 迁移类任务追加 **Run parity**：新旧 run_report 键集合 + download/defects/failures 深比较

## 开放问题

- **捕获量峰值 607 vs 当前 442/502**：607 那次是"DOM 发现 607、网络仅 1 张"——可能对应网站当时不同的渲染策略（非虚拟滚动），至今未复现。后续跟踪（历史记录于 2026-06-18、2026-09-03）。