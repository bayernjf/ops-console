# 代码评审报告 — ops-console（2026-11-02）

> 评审方式：深度只读。未修改任何源码，未执行 git commit/push/checkout/restore。
> 工作区状态说明：任务发起时称"当前有未提交改动（src/islands/ApprovalList.tsx、src/layouts/ConsoleLayout.astro、src/pages/login.astro、src/styles/islands.css）"，但评审时 `git status` 实测为**干净工作区**——上述文件的改动已在 2026-11-02 22:11–22:12 以三个原子提交落库（`273301e` feat(login)、`ba66b69` fix(approvals)、`edf56dd` feat(layout)）。**评审基线 = HEAD `273301e`（dev 分支）**。评审期间仅运行验证门产生 gitignored 产物（`dist/`、`.astro/`），验证后 `git status --short` 复核仍为空。

## 一、仓库定位与规模概览

- **定位**：Tier0 产品族内部运营控制台（M8）。单进程 Astro 7 SSR（@astrojs/node standalone）+ React 19 交互岛；服务端聚合 zeus（3020）/commerce-os（3021）上游 API，只做聚合与鉴权透传，不持有业务规则；上游 bearer 仅服务端持有，浏览器零密钥。
- **技术栈**：Node 22（`engines >=22.12.0`）、Astro 7.2.10（锁定）、React 19、TypeScript strict（`strictNullChecks` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）、Vitest 2、ESLint 9 flat config。无 DB 层；运行态为 JSONL 文件（`data/`，gitignored）。
- **规模**：`src/` 87 文件、`tests/` 20 文件、`scripts/` 9 文件；src+scripts+tests 合计约 9.2k 行（含 CSS/sh）。
- **模块划分**（实测目录与 AGENTS.md 一致，另多 2026-10-31 新增的 traces 线）：
  - `src/middleware.ts`：会话校验 + 路由保护 + boot 启动通知调度器；
  - `src/server/`：`config`（fail-closed 环境配置）、`auth`/`session`（HMAC cookie）/`rbac`、`upstream/{http,zeus,commerce,types}`（薄透传客户端）、`approvals-service`/`commerce-ops-service`/`policy-service`/`dashboard-service`/`traces-service`（编排层）、`notify/`（轮询引擎 + 入站 webhook + JSONL 存储）、`sla.ts`（纯函数呈现）；
  - `src/pages/api/`：约 25 个 JSON 端点；`src/pages/app/`：11 个 SSR 页面；`src/islands/`：8 个 React 岛 + `src/components/AsyncState.tsx`；
  - `src/styles/tokens.css`：内嵌 console-ui 令牌块 + `tokens.lock` 哈希钉。
- **验证门**：`check:tokens` / `check`(astro check) / `lint` / `test`(vitest) / `build`，CI（`.github/workflows/ci.yml`）五步全串行执行，另有 4 个真实进程联调脚本（`verify-batch1/2/3.sh`、`verify-notify.sh`，需真实上游，本次未运行）。

## 二、结论摘要

整体质量**高于一般内部工具水平**：认证 fail-closed、RBAC 服务端强制、上游错误透传规范、测试 122 例全部真实断言且实测全绿、令牌同步机制经复核零漂移。**未发现 P0**（无可利用安全漏洞、无数据损坏风险、无线上中断路径——在本仓"本地运行、不部署现网"的既定范围内）。

- **P0：0 条**
- **P1：2 条** —— ① SameSite=Strict 会话 cookie 与核心"IM 通知卡片 → 深链接回控制台"流程冲突（被 CONTRACT.md §1 冻结，需决策层复评）；② 退款审批路由对非法 verdict 静默降级为 approve，"驳回"意图可能被执行为"批准并渠道退款"（与 approvals 路由的 400 校验不一致，钱的路径）。
- **P2：7 条** —— 上游调用无应用层超时；astro 7.2.10 锁定版本带 2 条 moderate 公告（受 Node 22.23.2 阻塞无法升级）；dev 依赖链 18 条漏洞（含 vitest/tinypool critical，仅开发面）；owner 可配 webhookUrl 无 scheme/host 校验；登录页网络失败无反馈且 429 被误显为"密码错误"；6 处写路由 `request.json()` 无 catch，非法 JSON 返回 500 而非 400；4 个操作岛 fetch 无 try/catch，网络失败即 unhandled rejection 且 busy 卡死、按钮永久禁用。
- **P3：16 条** —— 死代码×2、CI 用 `npm install`、README 测试计数过期、JSONL 无轮转且审计行 duplicate 恒 false、span 树递归无环防护、401 重定向丢 query、AsyncState loading 变体无人使用、失败态靠中文字符串匹配、SSR fail-closed 渲染模式不统一（错误面板与假空态并存）、窄屏三处溢出风险、RBAC 死断言、阈值表单无客户端数值校验等。

**最关键 3 条**：
1. （P1）退款审批路由 `verdict` 校验缺失：`body.verdict` 非 `'approve'|'reject'` 时静默当作 `'approve'` 执行（`src/pages/api/refunds/[id]/decision.ts:18`），而同语义的 approvals 路由有 400 校验（`src/pages/api/approvals/[id]/decision.ts:16-17`）——出错时偏向"批准并渠道打款"，方向不可逆，必须最先修。
2. （P1）SameSite=Strict 使通知深链接这一头号流程每次都要重新登录（`src/server/session.ts:63`、`src/pages/api/auth/login.ts:39`），与 CONTRACT 冻结项冲突，需明确取舍。
3. （P2）`callJson` 支持 `AbortSignal` 但全仓无人传入（`src/server/upstream/http.ts:24,52`），上游半挂时 SSR 页面与通知轮询出现分钟级盲区，且无任何超时日志。

## 三、逐条发现

### P1

**P1-1 通知深链接流程与 SameSite=Strict cookie 冲突，每次跨站点击都要重新手动登录**
- 位置：`src/pages/api/auth/login.ts:39`（`sameSite: 'strict'`）、`src/server/session.ts:63`（`SameSite=Strict`）、`CONTRACT.md:27`（合同原文冻结 Strict）、`src/server/notify/poller.ts:38-40`（deepLink 生成）。
- 证据：SameSite=Strict 下浏览器对**跨站顶层导航也不携带 cookie**。通知卡片的设计入口是从 IM（外部站点/webview）点 `http://…/app/approvals/:id`：请求无 cookie → 中间件 302 到 `/login?next=…`（`src/middleware.ts:50-51`）→ 用户必须重新输入账号密码。会话 12h 有效也无法被利用——每次从 IM 点链接都是跨站。`scripts/verify-batch1.sh` 的深链接验证是带 cookie 的 curl 直访，测不到该路径。
- 影响：T-M8-05（通知卡片+深链接，本仓头号卖点之一）的真实使用路径每次都要完整重新登录，运营响应时效与体验受损。
- 修复建议：决策层复评二选一——(a) 会话 cookie 改 `SameSite=Lax`（顶层 GET 导航带 cookie，深链接直达；本站所有写操作均为 `application/json` POST，跨站表单无法伪造 JSON Content-Type，CSRF 风险面基本不变），同步修订 CONTRACT.md §1；(b) 保留 Strict 并在 README/handoff 显式记录"IM 深链接需重新登录"为已知取舍。当前状态是合同与产品流程互相矛盾且无人登记。

**P1-2 退款审批路由对非法 verdict 静默降级为 approve，"驳回"意图可被执行为"批准并渠道退款"（第二轮新增）**
- 位置：`src/pages/api/refunds/[id]/decision.ts:18`（`verdict: body.verdict === 'approve' || body.verdict === 'reject' ? body.verdict : 'approve'`）。
- 证据：对照同语义路由 `src/pages/api/approvals/[id]/decision.ts:16-17`——非法 decision 一律 `throw badRequest`（400），而退款路由把任何非二值输入**静默当作 approve** 传入 `decideRefund`（`src/server/commerce-ops-service.ts:188-192`：先 `getRefund` 取 decisionId 再过 RBAC grade gate，approve 分支随后执行渠道真实退款）。同文件 `:13` 的 `request.json()` 无 catch 问题并入 P2-6。
- 影响：任何已授权角色的调用方 bug（拼错 `'reject'`、漏传 verdict、body 结构漂移）都会把"想驳回/未决"的退款执行为"批准并打款"——出错方向偏向资金流出且不可逆，200 响应与正常批准无异，无告警。RBAC 本身仍有效（grade gate 在 service 层），故这不是越权漏洞而是严重正确性缺陷，定 P1 非 P0。
- 修复建议：与 approvals 路由对齐——`verdict` 非二值时 `throw badRequest("body.verdict must be 'approve' or 'reject'")`；改动 5 行以内，需补一条"非法 verdict → 400"的路由级测试（现有 `tests/route-authz.test.ts` 同文件内即可加）。

### P2

**P2-1 上游调用无应用层超时，`AbortSignal` 通道形同虚设**
- 位置：`src/server/upstream/http.ts:24`（`signal?: AbortSignal`）、`:52`（透传 signal）；`src/server/upstream/zeus.ts`、`src/server/upstream/commerce.ts` 全部方法均未传 `signal`（全仓 grep `signal` 仅 http.ts 两处命中）。
- 证据：Node 22 全局 fetch（undici）无应用层总超时概念；headers/body 内部默认约 300s（版本相关，**未在仓内验证其确切值，标记为"未确认"**）。`poller.ts:145-153` 的 tick 有 `running` 重入守卫——一次 tick 卡住期间所有后续 tick 直接跳过，通知静默延迟；SSR 页面（如 `app/approvals/index.astro:12`）同步 await 上游，浏览器侧表现为长时间白屏加载。
- 影响：上游"半挂"（连接建立但不响应）时，看板/审批页分钟级无响应，通知引擎分钟级停转，且无任何日志（只有连接拒绝型错误才走 `http.ts:59-61` 的日志路径）。对一个以"挂起/超时主动告警"为使命的控制台，这是最需要可观测的失败模式。
- 修复建议：`callJson` 内建默认超时（如 `AbortSignal.timeout(10_000)`，可被 options.signal 覆盖），超时按传输失败归入 503 UPSTREAM_UNAVAILABLE；为 poller 的上游调用加同样的超时。

**P2-2 astro 锁定 7.2.10 带 2 条 moderate 安全公告，升级被 Node 版本阻塞**
- 位置：`package.json:27`（`"astro": "7.2.10"`）、`AGENTS.md:22`（自述 7.4 要求 Node ≥22.23.4，本机 22.23.2 不可用）。
- 证据：`npm audit --omit=dev` 实测输出——astro <=7.3.2：GHSA-98hj-9722-w3j8（JSX/MDX `<script>/<style>` 内容未转义 XSS）、GHSA-mpr7-6m5w-76rw（View Transitions CSS 注入），fix 需 astro@7.4.5。
- 影响评估：本仓不使用 MDX、不使用 View Transitions，页面数据经 Astro/React 默认转义插值渲染（grep 无 `set:html`/`dangerouslySetInnerHTML`），两条公告在当前代码路径下**实际不可利用**——属预防性债务而非现役漏洞。
- 修复建议：先升级本机/CI Node 至 ≥22.23.4，再升 astro 7.4.x 并复跑全部门禁；在 handoff 登记该阻塞以免遗忘。

**P2-3 开发依赖链 18 条已知漏洞（2 critical / 1 high / 15 moderate），vitest 2 线为 EOL 大修**
- 位置：`package.json:41`（`"vitest": "^2.1.0"`，实测安装 2.1.9）。
- 证据：`npm audit` 全量实测——critical：`tinypool`×2（worker options 原型链污染 gadget→RCE，GHSA-5gmw-xhrv-c9v3、GHSA-85c8-ppgw-ccpr）、`vitest`（@vitest/mocker 路径穿越/任意文件读、UI server 未鉴权代码注入）；high：`vite`（optimized deps `.map` 路径穿越、launch-editor NTLMv2 UNC 泄漏）；moderate：esbuild dev server、minimatch DoS、eslint 系。
- 影响评估：全部位于 **dev/测试面**，不进生产产物（`dist/` 内无 vitest/esbuild）；利用前提多为"运行不可信测试代码/不可信仓库/开 Vitest UI"，在本仓使用方式下风险低，但 critical 字样会长期污染任何接入 audit 门禁的流水线。
- 修复建议：规划 vitest 2→5（audit 自述 fix 为 vitest@5.0.5，breaking）与配套 vite 大版本升级；升级前在 CI 说明现状为已知 dev-only 债务。

**P2-4 通知 webhookUrl 运行时更新无 scheme/host 校验（owner-only 的无护栏外发通道）**
- 位置：`src/server/notify/index.ts:99-112`（`updateNotifyConfig` 只校验非空字符串）、`src/pages/api/notify/config.ts:29-33`（原样接收）。
- 证据：owner 可将 `webhookUrl` 改为任意 URL，poller 随即把含金额/intent/ruleId 的决策卡片 POST 过去（`poller.ts:63-83`）。对比 zeus 侧同类功能（handoff.md:109 记载其订阅接口"URL 限 http(s)"），本端无任何校验。
- 影响：非现役漏洞——需 owner 会话或凭据；但一旦 owner 会话被盗（XSS/凭据泄漏），攻击者可静默把全部审批情报外发到任意地址，也可作 SSRF 探针（内网 http 服务）。与仓内"凭据被盗后尽量减损"的整体姿态不一致。
- 修复建议：`updateNotifyConfig` 增加 `new URL()` 解析 + 仅允许 `http:`/`https:`；可选：拒绝 link-local/loopback 之外再提供显式 allowlist env。改动 10 行以内。

**P2-5 登录页网络层失败无用户反馈，429 限流被误显为"账号或密码错误"**
- 位置：`src/pages/login.astro:39-55`。
- 证据：`await fetch('/api/auth/login', …)` 无 try/catch——网络失败/服务端 5xx HTML 时 promise  rejection 未被处理（unhandled rejection），页面无任何提示；`res.ok` 为假的分支对 401 与 429（`login.ts:14-22` 的 RATE_LIMITED）一律渲染"登录失败：账号或密码错误"，被限流用户会反复重试正确密码。
- 影响：失败模式误导 + 控制台告警噪音。内部工具频次低，故 P2 下沿。
- 修复建议：catch 网络错误显示"网络异常"；按 `res.status` 区分 401/429/其他，429 显示限流文案。

**P2-6 六个写路由 `request.json()` 无 catch，非法 JSON body 返回 500 INTERNAL_ERROR 而非 400（第二轮新增）**
- 位置：`src/pages/api/orders/import.ts:10`、`refunds/index.ts:22`、`inventory/index.ts:19`、`products/index.ts:19`、`listings/index.ts:14`、`refunds/[id]/decision.ts:13`。
- 证据：以上六处均为 `await request.json()` 裸调用；非法 JSON 抛 `SyntaxError`，被路由外层 try/catch 捕获后落入 `toErrorResponse` 的兜底分支（`src/server/endpoint-json.ts:36-37`）→ 500 `INTERNAL_ERROR` + 服务端 `console.error`。对照仓内正确示范：`policy/thresholds.ts:15,20`（`.catch(() => null)` + `badRequest('JSON body required')`）、`approvals/[id]/decision.ts:15`、`auth/login.ts:9`。
- 影响：客户端错误（坏 JSON）被报成服务端故障——调用方按 5xx 重试放大无效流量，错误监控/告警被污染，且与同仓其他路由的 400 契约不一致。
- 修复建议：六处统一改为 `.catch(() => null)` + null 检查抛 `badRequest`；可加一条参数化路由测试覆盖六个端点。

**P2-7 四个操作岛 fetch 无 try/catch：网络失败即 unhandled rejection，且 busy 不复位、按钮永久卡死（第二轮新增）**
- 位置：`src/islands/RefundOps.tsx:26,52`（`setBusy(true)` 在 `:24,:50`，`setBusy(false)` 在 `:45,:63`——fetch 层 reject 时永远执行不到）、`InventoryOps.tsx:18`（busy 对 `:17/:29`）、`OrdersOps.tsx:17`（busy 对 `:16/:30`）、`ProductOps.tsx:45-53`（`post()` 无 catch，三个调用点 `:72,:87,:111` 也均无 try/catch）。
- 证据：同仓对照组 `ApprovalActions.tsx:32-53`、`PolicyThresholds.tsx:42-62` 均有完整 try/catch/finally——八个岛两套错误处理范式并存。断网或 fetch 层 reject 时：promise 裸 reject（浏览器 unhandled rejection 告警）、用户无任何提示、`busy` 停留 `true` 使提交按钮永久 disabled，只能刷新页面恢复。
- 影响：一次网络抖动即可让退款/库存/拉单/上架操作面板变砖；与 P2-5 登录页同属"传输层失败无反馈"家族，但这里多了状态卡死的附加损害。
- 修复建议：四个岛统一包 try/catch/finally（照抄 `PolicyThresholds.tsx:42-62` 范式），catch 中显示"网络异常，请重试"并置失败态，finally 复位 busy。

### P3

1. **死代码**：`src/pages/login.astro:4` frontmatter `const next = …` 从未使用（`astro check` 实测 hint ts(6133)）；`src/server/session.ts:62-64` `setSessionCookie` 全仓无调用（登录路由直接用 Astro `cookies.set`）。建议删除以免读者误以为存在两条 cookie 路径。
2. **CI 用 `npm install` 而非 `npm ci`**（`.github/workflows/ci.yml` "Install dependencies" 步）：不按 lockfile 严格复现，与仓内"依赖变更必须同步 lockfile"的约定不一致。
3. **README 状态过期**：`README.md:67` 仍写"Vitest 40/40"，实测 19 文件 122 用例；README 全文未提 `/app/traces` 与 `verify-batch3.sh`。`AGENTS.md` 目录树（:41-46）同样未列 traces 页面/端点/`sla.ts`/`login-throttle.ts`。
4. **入站审计日志 duplicate 字段恒为 false**：`src/server/notify/inbound.ts:172-177` 落盘行硬编码 `duplicate: false`，`record()` 返回的真实 duplicate 只体现在 HTTP 响应里，JSONL 审计失真。
5. **两个 JSONL 存储无轮转、无界增长**：`notify/store.ts:63`、`notify/inbound.ts:120` 每次 upsert/record 追加一行（含重复投递与重试状态更新），长期运行文件单调变大；重启 load 全量回放（`store.ts:28-45`）随之变慢。当前规模无实际影响，属 housekeeping。
6. **TraceExplorer span 树递归无环防护**：`src/islands/TraceExplorer.tsx:63-80` `flattenTree` 按 `parentSpanId` 递归，若上游返回环形引用将栈溢出使整页崩溃。数据源为可信 zeus，故仅健壮性项；建议迭代+visited 集合。
7. **401 重定向丢失 query**：`ApprovalList.tsx:51`、`TraceExplorer.tsx:159` 用 `window.location.pathname` 拼 `next`，不含 `search`，trace 过滤条件在重新登录后丢失。
8. **登录节流仅按 peer 维度**：`login-throttle.ts` 无账号级计数，分布式爆破（多 IP）不受 10 次/15 分钟约束。两固定账号 + 强密码 + 内网定位下可接受，登记为已知权衡。
9. **请求体无大小限制**：`login.ts:9`、`decision-webhook.ts:28` 等 `request.json()/text()` 全量读入内存，无显式 body limit（依赖 Node 默认行为，**未确认**其上限）。公网暴露的入站 webhook 端点尤其值得加限制。
10. **node_modules 状态漂移**：`npm ls --depth=0` 报 `@img/sharp-wasm32@0.35.5 extraneous`（package-lock.json 中有 4 处引用记录但 npm 判定当前安装树 extraneous）；不影响构建，提示本地曾手工装包，建议下次 `npm ci` 重置。
11. **AsyncState 的 loading 变体无任何消费方（死变体，第二轮新增）**：`src/components/AsyncState.tsx` 提供 `loading`/`loadingText`/Spinner 三件套，但全仓仅 `ApprovalList.tsx:104,107` 与 `TraceExplorer.tsx:303,307` 使用 error/empty 两种变体（grep `AsyncState` 全部命中无一传 loading）；刷新期间唯一加载指示是按钮文案"刷新中…"。要么接线 loading，要么删除变体以免读者误以为有加载态保障。两个列表岛的 error/empty 分离正确（empty 有 `!error` 守卫），未发现"catch 吞错冒充空态"。
12. **失败态靠中文字符串匹配判定（第二轮新增）**：`RefundOps.tsx:105`、`InventoryOps.tsx:49`、`OrdersOps.tsx:46`、`ProductOps.tsx:166` 用 `msg.includes('失败')` 同时决定样式类与 ARIA role（alert/status）——成功文案若含"失败"二字（如"已跳过失败单 N 条"）会被误标 `role=alert`；`ProductOps.tsx:62` 本有结构化 `createFail` 布尔态，同文件两套范式并存。建议统一改为结构化布尔失败态。
13. **SSR fail-closed 渲染模式不统一，错误面板与"假空态"并存（第二轮新增）**：`traces/index.astro:34-40` 为互斥渲染（错误时不挂岛，最严谨）；`approvals/index.astro:20-26` 错误面板 + 以空数组挂岛（`:14` 注释自述由岛二次拉取呈现错误，属刻意设计，但首帧会闪现"暂无待审批决策"空文案）；`orders/index.astro:24-30`、`refunds/index.astro:26-29`、`products/index.astro:23-25`、`content/index.astro:28` 在上游失败时**同时**渲染错误面板与"暂无订单/暂无退款单"等空态文案——空数据来自 catch 初始化的空数组，值班人可能误读为"真的没有单"。建议统一为 traces 的互斥模式。
14. **窄屏（≤390px）溢出风险三处（第二轮新增，静态推断未实机验证）**：(a) `notifications/index.astro:145` `.config-grid { grid-template-columns: repeat(4, minmax(140px, 1fr)) }`——四列最小约 560px+gap，≤~600px 视口横向溢出，文件内无媒体查询；(b) `403.astro:17` `.wrap { width: 420px }` 固定宽且无媒体查询，390px 视口溢出约 30px；(c) `dashboard/index.astro:79`（4 列）、`products/[id].astro:44`、`orders/[id].astro:44`、`approvals/[id].astro:142`（3 列）栅格均无 ≤768px 断点，390px 下单列仅约 85px，金额数值挤压换行。已确认的良性项：外壳 220px 侧栏 ≤768px 坍缩单列（`ConsoleLayout.astro:59,89-90`）、登录卡 ≤480px 转流体（`login.astro:60,70-72`，390px 已覆盖）、数据表有 `.table-wrap` 横向滚动兜底（`islands.css:112`）、`islands.css:184` 有 ≤768px 调整段、`.content` 流体 `max-width:1280px`（`ConsoleLayout.astro:84`）。
15. **RBAC 死断言与两个仅登录可读的 GET（第二轮新增）**：`canManageChannelAccounts`（`src/server/rbac.ts:24`）全仓零调用（grep 仅定义处命中）；`channel-accounts/index.ts`（GET）、`content/index.ts`、`content/[id].ts`（GET）无角色门槛，operator 即可读渠道账号清单与内容投影。当前两角色均可写商品/上架（`commerce-ops-service.ts:28` `canDoControlledAction` 覆盖），信息敏感度低，登记 P3；若未来引入只读角色需先补这道门。
16. **阈值表单无客户端数值校验（第二轮新增，服务端 400 兜底仅 UX 损失）**：`PolicyThresholds.tsx:44-45` `Number(d1Max)` 对非数字输入产出 `NaN`，`JSON.stringify(NaN)` 序列化为 `null`，服务端 `policy/thresholds.ts:21-22` `typeof` 校验拦下返回 400——已确认无静默清空阈值的写路径，但用户看到的是技术性 400 文案而非表单级提示。

### 复核后确认无问题（列举重点排查项，防误报）

- **会话安全**：HMAC-SHA256 签名 + `timingSafeEqual`（`session.ts:35`）、12h TTL、HttpOnly/SameSite/条件 Secure（`login.ts:36-42`）、篡改/过期/错密钥均有测试（`tests/session-rbac.test.ts`）。
- **认证 fail-closed**：`config.ts:18-27` requiredSecret 无默认值；`predev/prestart` 门禁 + boot 姿态日志有子进程级测试（`tests/boot-gate.test.ts` 3 例实测 exit code）。
- **RBAC**：中间件 401/302 → 路由层再查 → service 层先取 grade 再 `canApprove` 才触写（`approvals-service.ts:106-109`、`commerce-ops-service.ts:34-45`），approver/actor 一律注入会话用户名；operator D3/阈值 403 有路由级测试（`tests/route-authz.test.ts`）。
- **密钥边界**：实测 `grep` `dist/client/` 对 `.env` 全部占位密钥值与 `OPS_SESSION_SECRET/ZEUS_INTERNAL_TOKEN/COMMERCE_API_TOKEN` 变量名**零命中**；`.env` 权限 600 且 gitignored；`.env.example` 纯占位。
- **注入/XSS**：全仓无 `dangerouslySetInnerHTML`/`set:html`/DOM 直写；React/Astro 默认转义覆盖所有上游数据渲染；URL 参数全部 `URLSearchParams`/`encodeURIComponent`。
- **开放重定向**：`safe-next.ts:10-15` 拒绝 `//`、`/\`、绝对 URL，6 例测试覆盖。
- **SSRF（入站方向）**：无用户可控 URL 透传给 fetch 的路径（上游 baseUrl 全来自服务端 env）。
- **入站 webhook**：对原始 body 验签（不重序列化）+ 常量时间比较 + delivery-id 幂等（内存+磁盘回放）+ 未配 secret 503 fail-closed（`inbound.ts:150-159`），测试覆盖坏签名 401/重播 duplicate。
- **上游错误处理**：统一 `{error:{code,message,retryable}}`；传输失败 503 且不泄漏内部 base URL（`http.ts:56-61` 有回归测试 `route-authz.test.ts`）；4xx/5xx 原样透传。
- **轮询重入**：`poller.ts:98-106` 同步守卫防重叠 tick 重复投递，handoff 记载该缺陷已修且有回归用例（`tests/notify.test.ts`）。
- **SSR 与岛屿 fail-closed（第二轮复核）**：抽查 `dashboard/index.astro:9-14`、`orders/index.astro:11-21`、`traces/index.astro:15-21`、`products/inventory/content/refunds` 各页 frontmatter——上游抛错（含非法 JSON 走 `callJson` 透传分支）一律 catch 后显式渲染"上游不可达"面板，**不存在编造数据路径**；呈现不统一问题见 P3-13。岛侧：`ApprovalList`/`TraceExplorer` 的 fetch 均有 catch 并接 AsyncState error（fail-closed），四个操作岛缺陷见 P2-7。
- **权限边界零遗漏（第二轮复核）**：全部 29 个 API 路由文件逐一核对——公开白名单仅 `/login`、`/healthz`（精确匹配）与 `/api/auth/login`、`/api/inbound/zeus/decision-webhook`（前缀匹配，`src/middleware.ts:6-11`），其余一切路由先过中间件会话校验（API 401 / 页面 302，`:48-52`）；会话之上的角色门槛：`traces` owner-only（`traces/index.ts:15-16`）、`notify/config` PUT 与 `notify/test` owner-only、`policy/thresholds` owner-only（service 层强制）、写操作经 `canDoControlledAction`+grade gate（`commerce-ops-service.ts:28,34-45`）。仅登录即可读的 GET 为 `notify/deliveries`、`policy`（注释自述 any signed-in role）、`channel-accounts`、`content/*`（登记 P3-15）。页面侧 `/app/*` 全部经中间件，`403.astro` 为静态页。
- **输入处理与 IDOR（第二轮复核）**：trace/审批/退款/内容 ID 在上游客户端全部 `encodeURIComponent` 拼路径（`zeus.ts:61,70,76`、`commerce.ts:44,61,80,90,104,107,115`），无路径穿越面；`traces-service` 对过滤参数做 ISO 时间戳/成本上下限/limit 上限校验后逐字透传 zeus（`traces/index.ts:9-26`、服务端 docstring 自述校验口径）；所有详情类端点在 service 层对请求 ID 调 `getDecision`/`getRefund` 做存在性检查并注入会话用户名作 actor，无横向越权通道（IDOR 面=任意已认证角色可读任意决策，与仓内两角色共享工作台的设计一致）。
- **令牌同步**：见下节。

## 四、设计令牌 / 组件共享机制复核（vs console-ui）

复核方法：独立重算哈希、逐字节比对、实测 checker。

| 检查项 | 结果 | 证据 |
|---|---|---|
| 本仓内嵌块哈希 == `tokens.lock` | ✅ | 两者均为 `646cdcaf12e76322397f929b8ae4d9f35958529cfa97803747d9cf62e237c6f8`（独立 node 脚本重算，`src/styles/tokens.css:2-33`、`tokens.lock:1`） |
| 内嵌块 == console-ui  canonical `:root` 块（归一化后逐字节） | ✅ | 同一脚本对比 `/Users/jiangfeng/000mycodes/console-ui/tokens.css` 提取块，normalized bytes 完全一致（含本次 AA bump 的 `--ink-faint: #748894`，`tokens.css:24`） |
| checker 字节一致 | ✅ | `cmp scripts/check-tokens.mjs ../console-ui/scripts/check-tokens.mjs` 无输出（与 console-ui 侧结论一致） |
| `npm run check:tokens` 实测 | ✅ exit 0 | 输出 `tokens ok: …/src/styles/tokens.css` |
| CI 接线 | ✅ | `.github/workflows/ci.yml` 含 "Design tokens in sync" 步，在 typecheck 之前 |
| eslint 豁免 | ✅ 合理 | `eslint.config.js:5` 忽略 `scripts/check-tokens.mjs`（生成物，commit `7f82a28` 自述） |

**机制可靠性评估**：同步链路为"console-ui `sync.mjs` 推送 → 消费仓内嵌块 + lock 哈希钉 → 消费仓 CI 校验哈希"。防手滑有效：任何对内嵌块的手工改动都会导致哈希失配、CI 红。已知弱点（均非当前缺陷，登记备查）：(a) lock 与块可被同一次提交成对篡改——哈希校验防事故不防故意；(b) 漂移发现是"被动"的，依赖消费仓 CI 运行；console-ui 侧 `sync.mjs --check` 可主动巡检但无调度。(c) `check-tokens.mjs` 的错误提示指向 `node ../console-ui/scripts/sync.mjs`，路径正确；commit `a60cef0` 信息中写的 `node scripts/sync.mjs` 是在 console-ui 仓内执行的语境，不算文档错误，但易误读。

**组件共享**：`AsyncState`（`src/components/AsyncState.tsx`）为跨仓约定一致的"同款变体"（注释自述与 model-hub/atlas 同契约），islands.css 中 async-state 段有 `@bayjf/console-ui: async-state` 标记，但**该 CSS 段不在哈希校验范围内**——组件级共享目前靠注释约定，无机制保障，三个仓的 AsyncState 可能各自漂移（本次未跨仓 diff 组件实现，标记"未确认"）。

## 五、其余维度结论

**架构与模块边界**：pages → api routes → service → upstream client 四层清晰且单向；service 层纯 TS 无 HTTP 依赖，路由均为薄包装；CONTRACT.md 冻结接口且与实现逐条对得上（抽查 §1 cookie 属性、§3.3 重试 5/15/45s=`webhook.ts:12`、§6 traces 逐字透传）。`middleware.ts:29-33` 模块级副作用（boot 日志 + 启动调度器）依赖"Astro 构建期不执行该模块"这一隐式假设——已实测 `npm run build` 无任何 env 变量时成功，假设当前成立，但属脆弱点，升级 Astro 大版本时需复验。

**数据模型与迁移一致性**：本仓无数据库、无迁移层（符合"不建用户表/不建本地存储"的设计）。持久态仅两个 JSONL（notify 投递记录、入站事件日志），键设计与重启幂等均有测试。问题仅为无界增长（见 P3-5）。

**错误处理与失败模式**：服务端错误映射集中（`endpoint-json.ts`），未知异常 500 不泄内部；SSR 页面上游失败即显式 fail-closed 面板，岛内有 AsyncState 三态 + `role=alert/status`。第二轮深化后确认的缺口清单：登录页（P2-5）、上游超时（P2-1）、六个写路由非法 JSON 走 500（P2-6）、四个操作岛无 try/catch 致 busy 卡死（P2-7）、SSR 错误面板与假空态并存（P3-13）、失败态字符串匹配（P3-12）、AsyncState loading 死变体（P3-11）。测试中对预期错误日志均做 mock，输出干净（实测验证）。

**测试覆盖与真实性**：19 文件 122 例全部真实断言——契约级测试起 `node:http` 假上游走真实 fetch 网络路径（非函数 mock）；boot 门禁用真实子进程断言 exit code；中间件测试直接驱动 `onRequest`；岛测试用 @testing-library 断言 role/aria 与查询串。无形同虚设的测试（抽查 `middleware.test.ts`、`login-throttle.test.ts`、`session-rbac.test.ts`、`notify.test.ts` 名单与断言密度一致）。CI（`.github/workflows/ci.yml`）实际执行五门：`npm install`（见 P3-2）→ `check:tokens`（真实字节级哈希校验且先于 typecheck 挂线）→ typecheck → lint → test → build，全部 push/PR 触发。缺口：无 e2e/浏览器级门（P1-1 的跨站 cookie 行为、P2-7 的 busy 卡死、P3-14 的窄屏均无自动守卫）；无覆盖率工具配置（package.json 无 coverage 脚本），无法量化；`verify-*.sh` 真实联调脚本本次未运行（需 3020/3021 真实上游，超出只读评审范围，标记"未确认其当前可用性"）。

**性能**：未见明显热点。SSR 每页实时打上游（无缓存）是实时性优先的设计选择；客户端主 chunk 212,836 B（React 运行时+岛框架，实测 `dist/client/_astro/client.Cd-EeyjT.js`），各岛 3–8 KB 独立 chunk；`NotifyStore.upsert` 的 `findIndex` O(n) 与通知页 `slice(0,100)` 在当前数据量级无影响；轮询 20s/tab 无 visibility 暂停，负载可忽略。

## 六、验证门实际执行结果

全部命令在 `/Users/jiangfeng/000mycodes/ops-console` 于普通沙箱内一次通过，未触发权限拒绝，无需降级或重试。

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `npm run check:tokens` | 0 | `tokens ok: …/src/styles/tokens.css` |
| `npm run lint` | 0 | 无输出（0 error / 0 warning） |
| `npm run check`（astro check） | 0 | `Result (109 files): 0 errors, 0 warnings, 3 hints`（hints：login.astro 死变量 + notify.test.ts 两个可 async 化提示） |
| `npm test`（vitest run） | 0 | `Test Files 19 passed (19) / Tests 122 passed (122)`，19.45s |
| `npm run build`（astro build） | 0 | `Server built in 4.43s / Complete!`；vite 警告若干（`esbuild`→`oxc`、`optimizeDeps.esbuildOptions`→`rolldownOptions` 弃用提示，来自 @astrojs/react 插件，非本仓代码） |
| `npm audit --omit=dev` | 0 | 1 moderate（astro，见 P2-2） |
| `npm audit`（全量） | 0 | 18 条（15 moderate / 1 high / 2 critical，均 dev 面，见 P2-3） |
| `grep` 密钥值/变量名扫描 `dist/client/` | 1（零命中） | 对 `.env` 全部占位密钥与三个 token 变量名均无匹配 |
| `git status --short`（验证后复核） | 0 | 空输出，工作区保持干净 |

未运行项及原因：`scripts/verify-batch1/2/3.sh`、`verify-notify.sh` 需要 3020/3021 端口真实 zeus/commerce 进程，属联调验收而非静态验证门，本次评审未启动上游（避免对邻仓进程状态的依赖）；其最近一次记录在案的结果见 handoff.md（batch1 PASS=29、batch2 PASS=21、batch3 PASS=11），**当前可用性未确认**。

## 七、修复优先级建议

1. **本周内（P1）**：① 修退款 verdict 校验（P1-2，约 5 行 + 1 条路由测试，钱的路径最优先）；② 决策 SameSite Strict vs Lax（P1-1）。若选 Lax：改 `login.ts:39` 一处 + CONTRACT.md §1 措辞 + 补一条跨站导航带 cookie 的说明；若选保留 Strict：在 README 与通知页文案登记"IM 深链接需重新登录"。
2. **下个迭代（P2）**：① `callJson` 加默认超时（P2-1，约 15 行含测试）；② 四个操作岛统一 try/catch/finally（P2-7）；③ 六处 `request.json()` 补 catch 归 400（P2-6）；④ webhookUrl scheme 校验（P2-4，约 10 行）；⑤ 登录页错误分支与 catch（P2-5）；⑥ 升级 Node ≥22.23.4 → astro 7.4.x（P2-2）；⑦ 排期 vitest 2→5 大版本（P2-3）。
3. **随手清理（P3）**：删两处死代码与 `canManageChannelAccounts` 死断言（或补接线）；CI 改 `npm ci`；README 状态行与 AGENTS.md 目录树更新到 traces/122 例；inbound 审计行写真实 duplicate；401 重定向带 search；四岛失败态改结构化布尔；SSR 错误页统一为 traces 互斥模式；notifications 配置栅格与 403 页补窄屏断点；AsyncState loading 变体接线或删除；阈值表单加数字输入校验。JSONL 轮转、span 树环防护、body 大小限制可在下一次触及对应模块时顺带做。
