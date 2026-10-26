# ops-console · handoff

> 规则：完成项及时登记；缺口分"内核缺口（需回到 zeus/commerce 做）"与"外部验收项"。

## 2026-10-24 方向决策（owner 拍板，覆盖原 hint 的 React SPA 形态）
- 形态：**单进程 Astro 7 SSR（node adapter）+ React 19 交互岛**，不做 server+web 双进程、不做独立 SPA；一个进程一个部署单元。
- 审批唯一写入口在控制台；IM 通知只做**卡片 + 深链接**，不做 IM 内批/驳（无 IM 回调/动作令牌/平台验签），留二期。
- 待办实时性：**轮询 20s（15–30s）+ 手动刷新 + 动作后刷新**，不做 SSE/WebSocket。
- 认证：不建用户表、不注册；本地 env 角色密码 + HMAC 签名 httpOnly cookie；生产预留 Cloudflare Access（信任受保护头）、VPS 兜底 GitHub OIDC（本期只留缝、不实现、失败即拒）。
- 分两批：**第一批**（审批链路不可延后）= 认证+最小 RBAC、只读经营看板、D1–D3 审批列表+批准/驳回、通知卡片+深链接（本地 webhook 全链路）；**第二批** = 上架提交、退款审批、库存手工调整。
- 不建 ops-console-landing；公开静态门面后续主线单独建，不属本 M8。
- 其余边界不变：只建本仓、不改六仓、不做多租户/计费/支付/财务/CRM、不做 M7 监控、不做现网部署、不 push、密钥不入仓、原子提交。

## 本地基线（开工前已实测）
- zeus `../zeus`（dist 存在）：`ZEUS_PORT=3020 ZEUS_INTERNAL_TOKEN=local-zeus-token ZEUS_DB_FILE=... node dist/http/serve.js`
  - `POST /api/v1/decisions` 1299 CNY team/reversible → `{grade:'D2', mode:'approve-sync', status:'blocked', ruleId:'d2-amount'}`；无 token → 401。
- commerce `../commerce-os`（dist 存在）：`COMMERCE_PORT=3021 ZEUS_BASE_URL=http://127.0.0.1:3020 ... COMMERCE_API_TOKEN=... node dist/serve.js`
  - `GET /api/v1/dashboard` 带 token 返回订单/退款/内容/净额；无 token → 401。
- 一键起上游：`npm run dev:upstream`（脚本 `scripts/dev-upstream.sh`，端口 3020/3021，数据在 `data/dev-upstream/`）。

## 已完成（脚手架）
- 单进程 Astro 7.2.10 SSR 骨架（node standalone，@astrojs/react 5，React 19）：深/亮 token、ConsoleLayout、导航、登录页、403、占位路由。
- 服务端：config/auth/session(HMAC cookie)/rbac、context、upstream（http + zeus + commerce 薄透传客户端，含类型）。
- 中间件：未登录 `/api/*` 401、页面 302 跳 `/login`；`/healthz` 公开；通知调度 seam（`src/server/notify/index.ts`）。
- 通知 seam：`src/server/notify/{index,types}.ts`（稳定导出，待实现）；本地假 webhook 接收端 `scripts/fake-webhook-receiver.ts`（3023）。
- 实测：healthz 200；未登录 302/401；错误登录 401；owner/operator 登录 200 且 cookie 为 HttpOnly；登录后页面 200；`astro build` 通过。

## 完成项（待第一批）
- [x] T-M8-01 单进程 SSR 工作台：服务端聚合 zeus/commerce + 页面框架；关停控制台不影响底层 API（2026-10-24）
- [x] T-M8-02 身份与最小 RBAC：env 角色密码 + 签名会话；401/403；浏览器零密钥（2026-10-24；operator 改阈值 403、operator 批 D3 403、D1/D2 两角色可批，单测+真实联调双验证）
- [x] T-M8-03 审批工作台：D1/D2/D3 列表（轮询 20s 钳制 15–30s/手动/动作后刷新）+ 快照/金额/规则/证据 replay + 批准/驳回；与 zeus /approval 一致（2026-10-24）
- [x] T-M8-04 经营视图 + 受控写：只读看板复用 commerce dashboard 口径（订单/退款/内容/净额，不含成本，逐字段透传不重算）；商品/订单/退款/内容/库存只读页 + 上架提交（D3 owner-only）、退款审批（D2 两角色）、库存手工调整受控动作（2026-10-24，verify-batch2 PASS=21）
- [x] T-M8-05 通知：本地 webhook 卡片+深链接；挂起→≤60s 投递→decisionId 幂等→超时升级→通道失败可观测；深链接直达（2026-10-24 落地，实现见 src/server/notify/，验证见下方）

## 第二批（受控写）— 2026-10-24 完成
- [x] 上架提交 + 批准/驳回（D3 owner-only）、退款申请/审批（D2 两角色均可）、库存手工调整，以及商品/订单/退款/内容/库存只读页；真实闭环见下文 verify-batch2（PASS=21）。

## 内核缺口（需回到 zeus/commerce 做，本仓不改内核）

> **2026-10-26 收口更新：下列 zeus / commerce 内核缺口已在各自仓库落码、过门并推送（zeus `origin/dev` `944ee6c..1376257`；commerce-os `origin/dev` `da106b2..c387650`）。本仓代码本轮未动；控制台侧消费（late 状态呈现、webhook 接收、退款/内容列表页接线）登记为下一批待办，见本节末尾「控制台侧接线待办（下一批）」。**

- ✅ **【zeus 已闭环 2026-10-26】** ~~默认策略 v1 未给任何规则配置 slaHours，真实 D2/D3 决策没有 `timeoutAt` 字段~~。收口：`69f8fc3` feat(grading) + `9df3794` test——D2 规则 slaHours=24、D3=72，D1/D0 与自定义策略未配规则零行为变化（无 timeoutAt、永不超时），含反向门。
- ✅ **【zeus 已闭环 2026-10-26】** ~~SLA 超时"读到即自动驳回"，无"已超时但仍挂起"窗口~~。收口：`f585ba3` feat(core) + `5ede5f9` test——两阶段超时：`DecisionRecord` 新增 `lateAt`、新审计 `decision.late`；breach 后保持 awaiting_approval/blocked 且仍可批准/驳回（pending-but-late），`lateGraceHours` 默认 72h（自 timeoutAt 起算，设 0 复刻旧"读到即驳回"语义，构造时校验非负），宽限期满才置 rejected/timed-out；`replay()` 呈现 created→late→approvals→timed-out 时间线。
- ✅ **【zeus 已闭环 2026-10-26】** ~~无决策事件订阅/webhook，控制台只能轮询~~。收口：`61b1f31` feat(core) + `ba36ea1` feat(http) + `0670d6b` test + `5ed884d` docs——决策生命周期事件（created/late/approved/rejected/timed-out）经 HMAC-SHA256 签名（`x-zeus-signature`）webhook 投递，幂等键 `x-zeus-delivery-id`、网络错/5xx/429 有界指数退避（3 次）、其他 4xx 不重试、全路径 fail-soft；Bearer `GET/POST /api/v1/decision-webhooks`（secret 掩码永不下发、URL 限 http(s)、secret≥16），serve 经 `ZEUS_DECISION_WEBHOOK_URL`/`ZEUS_DECISION_WEBHOOK_SECRET` 种子订阅（URL 无 secret 时 fail-closed）。已知边界（zeus 侧后续）：订阅当前为内存态、无 DELETE/持久化，重启丢失；真实 webhook URL/secret 属外部凭据。
- commerce 缺口（退款列表 / 内容列表 GET 缺失、commerce 域决策必须经 commerce 端点审批）见下方「第二批」小节；前两项已于 2026-10-26 闭环（见文末 commerce 小节），审批端点约束本批已在 ProductOps/RefundOps 遵守。

### 控制台侧接线待办（下一批，本仓）
1. 审批列表/详情消费真实 `timeoutAt`/`lateAt`：呈现 pending-but-late 状态与剩余宽限；timeout/escalation 卡片在 late 窗口内触发（引擎对缺失字段仍安全跳过，向后兼容旧 zeus）。
2. 决策事件 webhook 接收端：订阅 zeus 决策 webhook（验签 `x-zeus-signature`、按 `x-zeus-delivery-id` 幂等、通道失败退避落 channel_failure，可复用 src/server/notify 既有管道），替代/补充 20s 轮询；真实 URL/secret 待定，本地可用 `scripts/fake-webhook-receiver.ts` 验收。
3. 退款页接 `GET /api/v1/refunds`（列表）+ 既有 `:id` 详情；内容页接 `GET /api/v1/content` + `:id`（仅 published 投影，pending 待审 listing 不在内）。
4. 联调基线：zeus 起真实服务时默认策略 v1 已带 slaHours；webhook 订阅经 env 种子或 POST 路由配置；commerce 新端点需与现有只读页字段逐字段对齐。

### 控制台侧接线（2026-10-26 完成）
四条待办全部落地，只改本仓消费侧。
- **待办1（late 呈现）**：`src/server/sla.ts` 纯函数 `describeSla(record, now)` 把记录解释为 unknown/ontime/late/timed-out；无 `timeoutAt`（旧 zeus / D0·D1 规则）一律 `unknown` 安全跳过不报错；pending 且 now≥timeoutAt → `late`，列表岛与详情页展示「宽限中·已逾期 X」与 lateAt、宽限已进行时长；`result.outcome==='timed-out'` → 「已超时关闭」。`DecisionRecord` 补 `lateAt?`；出站 poller payload 补 `lateAt?`，timeout 文案改为「进入宽限期 pending-but-late」。
- **待办2（入站 webhook）**：`src/server/notify/inbound.ts` + `POST /api/inbound/zeus/decision-webhook`（中间件放行，公网 HMAC 鉴权）。对**原始 body 文本**做 HMAC-SHA256 验签（对齐 zeus `signWebhookBody`，前缀 `sha256=`），`crypto.timingSafeEqual` 常量时间比较；缺签名/签名不符 → 401；缺 delivery-id → 400；未配 secret → fail-closed 503；按 `x-zeus-delivery-id` 幂等（JSONL 落盘 + 磁盘回放，重启不重处理，重放回 200 `duplicate:true`）。secret 经 `OPS_DECISION_WEBHOOK_SECRET`，日志 `OPS_DECISION_WEBHOOK_LOG`；`scripts/dev-upstream.sh` 用 `ZEUS_DECISION_WEBHOOK_URL/SECRET` 种子 zeus 指向本端点。
- **待办3（列表接线）**：commerce client 补 `listRefunds/listContent/getContent`（`{refunds}`/`{content}` 包裹）；`GET /api/refunds`、`GET /api/content`、`GET /api/content/:id`；退款页 SSR 渲染真实退款列表，内容页从事件流派生切到 `GET /api/v1/content` published 投影（pending 待审不在内，不伪造）。
- **待办4（基线）**：真实 zeus D2 决策现在带 `slaHours:24`/`timeoutAt`；webhook 经 env 种子；refund/content 字段与上游逐字段对齐。

**验证（真实进程 3020/3021/3022）**：
- `scripts/verify-batch3.sh` **PASS=11 FAIL=0**：真实 zeus→console 签名 `created` 推送落盘；坏签名 401；新签事件 200 accepted；同 delivery-id 重播 200 duplicate；refunds/content 列表形状与页面 200。
- `scripts/verify-batch2.sh` **PASS=21 FAIL=0**（受控写回归，且产生真实退款/内容行）。
- 逐字段核对：refund 行 `{id,orderId,lines[{orderItemId,qty,amount}],reason,status,decisionId?,externalRefundRef?,createdAt,decidedAt?}`；content 行 `{id,productId,channel,externalProductId,decisionId?,listedAt}`。
- 契约级 Vitest `npx vitest run` **53/53**（新增 sla-state 7、inbound webhook 2、commerce lists 4）；`npx astro check` **0 error**；`npx eslint .` **0**；`npm run build** 成功。
- 密钥边界：`dist/client/` 对 `local-zeus-token/local-commerce-token/local-decision-webhook-secret` **零命中**。

## 验证方式（真实服务 vs mock，逐项写明）
- T-M8-05 真实链路：`scripts/verify-notify.sh`（zeus:3020 + console:3022 + receiver:3023 真实进程）。实测结果：新建真实 D2（dec_…bmey）约 5.0s 收到 pending 卡片、真实 D3（dec_…e5nz）约 0.5s 收到；额外 12s 跨多轮轮询后各自仍为 1 条（幂等）；登录态 GET 深链接 `/app/approvals/:id` 返回 200。
- 契约级 mock（Vitest，node:http 假 zeus + 假接收端 + 注入时钟/注入 sleep，无真实等待）：`tests/notify.test.ts` 7 例全绿——D2 pending 一次投递、多轮轮询幂等、JSONL 落盘后"重启"不重投、过 timeoutAt→timeout、再经 escalationMinutes→escalation、通道 500/拒连→退避重试并落 channel_failure、D1 不发通知、深链接形状 `/app/approvals/:id`、**轮询重入守卫**（通道长时间不可达、deliver 阻塞完整退避窗口时，重叠 tick 不并发重投，pending 与 channel_failure 各仅 1 条）。
- 自检：`npx astro check` 0 errors；`npx eslint .` 0（`.astro` 交由 astro check 校验，eslint 只管 TS/TSX，且忽略 data/dist；未引入 astro parser）。
- 偏离 CONTRACT 之处：`updateNotifyConfig` 为进程内运行时更新（不落盘，重启回退 env）；channel_failure 除本地落投递日志外顺带 best-effort POST 到同一 webhook。两者均为第一批本地验收范围，二期接真实通道时再议持久化与告警路由。
- 已修复缺陷：通知引擎初版在 webhook 持续不可达、deliver 阻塞 5/15/45s 退避时，setInterval 触发的重叠 tick 会在首条投递落盘前并发重入，导致同一 decisionId 出现多条 channel_failure。已加同步重入守卫（一次 tick 未结束则跳过后续 tick）并补回归用例（见上）。

### 第一批核心（审批/RBAC/看板/阈值，2026-10-24）
- 真实链路：`scripts/verify-batch1.sh` 对运行中的 zeus:3020 + commerce:3021 + console:3022 实跑，**PASS=29 FAIL=0**：未登录 API 401/页面 302、owner/operator 登录 200、operator PUT 阈值 403 FORBIDDEN、zeus 直造 D3（impact=external+amount 超阈）operator 审批 403、owner 审批后控制台与 zeus 双双 status=decided 且 approver=owner、operator 批 D1 成功且 zeus 审批链 approver=operator、看板 9 个字段（orders 4/refunds 3/content 1/netAmount）在 SSR 页面 HTML 中与 commerce 逐字段一致。
- 契约级 mock（Vitest，node:http 假 zeus/commerce 起在 localhost，真实 fetch 网络路径，非函数 mock）：`tests/session-rbac.test.ts` 8 例（HMAC 签发/验签/篡改/过期/错密钥、RBAC 矩阵）、`tests/approvals-service.test.ts` 10 例（pending 聚合倒序/grade 本地过滤/domain 透传、400 校验不触上游、D3 operator 403 且不调上游、D1/D2 operator 与 D3 owner 通过且 approver 注入、zeus 404/409 原样透传、死端口→503 UPSTREAM_UNAVAILABLE、阈值 owner-only）、`tests/dashboard-service.test.ts` 5 例（metrics 逐字段深等、错误信封形状）。合计 30 例全绿（session-rbac 8、approvals 10、dashboard 5、notify 7）。
- 真实 vs mock 边界：RBAC/会话/聚合逻辑用假上游；**透传一致性与真实进程联调用 verify-batch1.sh**（3020/3021/3022 真实）。
- 自检：`npx vitest run` 30/30；`npx astro check` 0 errors；`npx eslint .` 0（见下偏离）；`npm run build` 成功；`grep` 确认 `local-zeus-token/local-commerce-token` 仅存在于 `dist/server/`，`dist/client/` 与 islands/pages 前端源码零命中。
- 偏离/修正 CONTRACT 与脚手架之处：
  1. **上游客户端形状修正**（实测 curl 真实服务）：zeus `GET /api/v1/decisions/:id` 返回裸 DecisionRecord、`POST /:id/approval` 返回 toResponse 摘要 `{decisionId,grade,mode,status,ruleId,auditSeq}`（非 `{decision}` 包裹，脚手架原 client 形状错误已修）；policy 形状为 `{version,defaultGrade,rules}`。控制台一律原样透传，不本地判状态。
  2. **eslint flat config 修正**：脚手架原本无 astro parser，`.astro` 全部报 Parsing error。现将 `.astro` 交由 `astro check` 校验（已 0 错误），eslint 只管 TS/TSX，并为 env.d.ts 关闭 triple-slash-reference（Astro 生成环境类型的设计如此）。未引入 eslint-plugin-astro 等新依赖。
  3. 看板无独立 console JSON 端点（CONTRACT §3.2 只要求 SSR 展示），verify 通过 SSR HTML 逐字段比对。

## 集成验收（组织方在两子智能体交付后复核，2026-10-24）
- 全量自检（最终）：`npx vitest run` **40/40**（5 文件）、`npx astro check` **0 error**（80 文件）、`npx eslint .` **0 error / 0 warning**、`npm run build` **成功**。
- 真实链路（真实进程）：`scripts/verify-batch1.sh` **PASS=29 FAIL=0**（认证/RBAC/审批/看板）；`scripts/verify-notify.sh` **VERIFY OK**（D2 约 2.5s、D3 约 0.5s 投递，多轮轮询后各 1 条幂等，登录态深链接 200）；`scripts/verify-batch2.sh` **PASS=21 FAIL=0**（上架 D3/拉单/库存/退款 D2 受控写闭环，见下）。
- 密钥边界：浏览器产物 `dist/client/` 与全部登录后页面 HTML（approvals、dashboard、notifications、products、orders、refunds、inventory、content）对上游 token **零命中**；上游 bearer 仅存在于 `dist/server/`。
- 视觉验收：用本地 headless Chromium 对登录、审批列表/详情（owner 可批/operator D3 禁用并提示"服务端仍 403"）、看板、通知投递、设置，以及商品/订单/退款/库存/内容五个运营页逐页截图复核，深色工业风与家族 token 一致。
- 进程独立性：关停 ops-console（3022）后，zeus（3020）/commerce（3021）的 /healthz 与带 token 的 API（decisions、dashboard）仍返回 200，底层 API 不受影响。
- 结论：**T-M8-01～05 本地开发完成、本地可验证全绿（两批均落地）；不标记 GATE-M8**（连续 7 天现网运营、真实 webhook 触达、真实店铺/云部署属外部验收）。

## 可推送状态（给主线 owner）
- 已在 `dev` 分支整理为**单一职责原子提交序列**（scaffold → 主题/布局 → 上游聚合层 → 认证/RBAC → 审批工作台 → 只读看板 → webhook 通知 → 本地联调脚本 → 文档；第二批再追加：受控写服务/端点 → 运营只读页与交互岛 → 第二批 seed/验证脚本 → 文档），废弃的 server+web 双包骨架**未进入历史**，public 第一版即单进程 SSR 形态，且两批功能同处一个干净历史。
- 仓内只有 `.env.example` 占位，**无任何真实密钥**；`.env`、`data/`、`*.db`、`*.jsonl` 已 gitignore。
- 未建 remote、未 `gh repo create`、未 `git push`（按 owner 指令由主线建 public remote、做密钥扫描后推送 dev，main 待第一批稳定后经 PR 合并）。
- 规划仓地址：github.com/bayernjf/ops-console（尚未创建）。

## 外部验收项（本地无法完成，不冒充过门）
- GATE-M8：连续 7 天现网运营全部在控制台完成、无人直接调 API。
- 真实 webhook（飞书/微信/邮件）URL 未定义，待外部确定后替换 `OPS_NOTIFY_WEBHOOK_URL`。
- 生产认证：Cloudflare Access / GitHub OIDC 为预留 seam；现网部署、域名/TLS、真实店铺（M6 外部阻塞）。

### 第二批：受控写 + 运营只读页（T-M8-04 主体，2026-10-24）
- 真实链路：`scripts/verify-batch2.sh` 对运行中的 commerce:3021 + console:3022 实跑，**PASS=21 FAIL=0**：seed（幂等）→ operator 建商品 201 → operator 提交上架 423（grade=D3, decisionId）→ operator 上架审批 **403** → owner 上架审批 status=listed 且 commerce 商品状态同步 listed → 拉单首次 1 单/二次 0 新增（幂等）→ 库存调整 201 qty=50 → operator 发起退款 423（D2 挂起）→ operator 批退款 **succeeded**（D2 两角色均可）→ 8 个只读接口/页面全 200。
- 契约级 mock（Vitest node:http 假 commerce+假 zeus 起 localhost，真实 fetch 网络路径）：`tests/commerce-ops-service.test.ts` 10 例。全量 `npx vitest run` **40/40**（第一批 29 + notify 7 + 本批 10）。
- 自检：`npx astro check` 0 errors（80 文件）；`npx eslint .` 0 error / 0 warning（ProductOps 响应类型已收紧为显式 ApiJson）；`npm run build` 成功；`grep dist/client/` 与五个运营页 HTML 对上游 token 零命中。
- 组织方复核：`npx vitest run` 40/40、`astro check` 0、`eslint` 0、`build` 成功；`verify-batch2.sh` 实跑 **PASS=21 FAIL=0**；五个运营页（商品/订单/退款/库存/内容）headless 截图复核，深色工业风一致、真实数据与受控动作就位、退款/内容列表缺口在 UI 显式标注。
- **集成约束（重要）**：commerce 域决策（上架 D3 / 退款 D2）必须经 commerce 自己的端点（`/api/v1/listings/:decisionId/approve|reject`、`/api/v1/refunds/:id/decision`）才会执行渠道副作用（沙箱发布、渠道退款）；通用 zeus 工作台 `/app/approvals`（直连 zeus 批准）**不会触发任何渠道动作**。本批在商品页 ProductOps 与退款页 RefundOps 就近呈现挂起 decisionId 与审批按钮，通用 zeus 工作台保持不变。
- 编排集中在 `src/server/commerce-ops-service.ts`：受控动作先 `requireOperable`（owner/operator 均可）；上架/退款审批前先读 zeus `getDecision(decisionId)` 取 grade，D3 仅 owner（canApprove），再透传 commerce；approver 一律注入会话用户名；423 原样透传不吞，UI 呈现"待审批"。
- seed：`scripts/seed-dev.sh`（直连 commerce 幂等创建沙箱渠道账号 + 演示商品 SKU-DEMO-001，已存在则 SKIP；渠道账号创建不做成控制台功能）。实测产物：acc_sandbox-douyin-bce209 / prd_afbd75ba42-2164bb。

#### 新增内核缺口（commerce，本仓不改）—— 2026-10-26 均已闭环
- ✅ **退款列表 GET 已上线**：`GET /api/v1/refunds`（`4c07a40` feat(refunds)），全量列表、Bearer 鉴权、形状同 orders/products；详情 `/api/v1/refunds/:id` 原有，未知 id 404 `NOT_FOUND`。
- ✅ **内容列表/详情 GET 已上线**：`GET /api/v1/content` 与 `GET /api/v1/content/:id`（`032d36d` feat(content)）；为 `product.listed` 事件的只读投影（id=externalContentId，字段：id/productId/channel/externalProductId/decisionId?/listedAt），口径与 dashboard `content.published` 严格一致。**pending（awaiting_approval）listing 不在列表内**——如需"待审内容任务"视图须另立需求。
- 测试与文档：`c25482b` test（新增 9 例：空列表、种子读回、404、401 鉴权反向门；全量 18 文件 / 83 用例绿）、`c387650` docs；`check:migrations`/typecheck/lint/build 全绿，零新迁移。
- 控制台前端接线（退款页/内容页从事件流派生切到新端点）属本仓下一批，见上方「控制台侧接线待办（下一批）」第 3 条。
