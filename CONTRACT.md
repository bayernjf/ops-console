# ops-console · SSR 应用契约（冻结基线 v2 · 单进程 Astro SSR）

> 2026-10-24 方向校准：形态由"server+web 双进程 SPA"改为**单进程 Astro 7 SSR + React 19 交互岛**。本文件是**页面、服务端端点（endpoints）、React 交互岛、服务端模块**之间的冻结契约。新增/改接口先改本文件。
>
> 术语与 `Tier0-术语表.md` 一致：BFF 能力（聚合/鉴权透传、不持有业务规则）由 **Astro 服务端**承担；上游 bearer 只在服务端持有，浏览器侧零密钥；最小 RBAC 为 owner/operator；审批通知按 decisionId 幂等。

## 0. 形态与端口

**一个进程、一个部署单元**：Astro SSR（node adapter，standalone），页面服务端渲染，审批按钮/表单/列表自动刷新等少量交互用 React 19 交互岛。不拆第二个 web 应用，不引入独立 SPA。

| 角色 | 端口 | 说明 |
|---|---|---|
| zeus 决策/组织 API | 3020 | 上游，`../zeus`，bearer 仅服务端持有 |
| commerce-os API | 3021 | 上游，`../commerce-os`，bearer 仅服务端持有 |
| **ops-console SSR** | **3022** | 页面 + 服务端端点，同进程 |
| 本地假 webhook 接收端 | 3023 | 仅本地通知验证（脚本） |

## 1. 认证与最小 RBAC

- 不建用户表、不做注册。本地模式（`OPS_AUTH_MODE=local`）两个固定角色账号来自环境变量：
  - owner：`OPS_OWNER_USERNAME` / `OPS_OWNER_PASSWORD`；operator：`OPS_OPERATOR_USERNAME` / `OPS_OPERATOR_PASSWORD`。
  - **fail-closed**：`OPS_SESSION_SECRET`、两个角色密码、`ZEUS_INTERNAL_TOKEN`、
    `COMMERCE_API_TOKEN` 为必填；缺失时 `predev`/`prestart` 门禁与 `loadConfig()`
    直接报错退出，不存在内置弱默认值（见 `src/server/config.ts` 的 `requiredSecret`）。
    启动成功时打印一行授权姿态日志（`auth posture: fail-closed`），分布在 SSR boot
    （`src/middleware.ts`）与 `predev`/`prestart` 门禁。
  - 登录成功下发 `HttpOnly; SameSite=Strict; Path=/`（https 下 `Secure`）的 **HMAC 签名会话 cookie**（`src/server/session.ts`）；浏览器 JS 读不到会话内容，身份只通过 `GET /api/auth/me` 展示。
- 生产预留（**本期只留缝、不实现、失败即拒**，在 README/handoff 写明）：`OPS_AUTH_MODE=cf` 信任 Cloudflare Access 受保护头；`oidc` 为 VPS 兜底 GitHub OIDC。
- 中间件 `src/middleware.ts`：除 `/login`、`/healthz`、`POST /api/auth/login` 外，未登录访问：
  - `/api/*` → `401 {error:{code:'UNAUTHORIZED'}}`；
  - 页面 → 302 跳 `/login?next=...`。

RBAC 矩阵（`src/server/rbac.ts`）：
| 能力 | owner | operator |
|---|---|---|
| 只读（待办/经营/运营数据） | ✅ | ✅ |
| 受控业务动作（上架提交/退款申请/库存手工调整/拉单） | ✅ | ✅ |
| 审批 D1 / D2 | ✅ | ✅ |
| 审批 **D3** | ✅ | ❌（`403 FORBIDDEN`） |
| 改阈值/策略 | ✅ | ❌（`403 FORBIDDEN`） |
| 改通知配置 / 通道账号登记 | ✅ | ❌ |

统一错误体 `{error:{code,message,retryable}}`；上游不可达 → `503 UPSTREAM_UNAVAILABLE`（fail-closed，不本地兜底）；其余上游 4xx/5xx 原样透传状态码与错误体。

## 2. 认证端点（已实现）
- `POST /api/auth/login` body `{username,password}` → 200 `{user:{username,role}}` + Set-Cookie；失败 401。
- `POST /api/auth/logout` → 204 清 cookie。
- `GET /api/auth/me` → 200 `{user:{username,role}}` / 未登录 401。
- 页面 `/login`（登录页）、`/403`（未授权页）都是本应用内部路由。

## 3. 第一批交付（审批链路不可延后）

### 3.1 审批工作台（页面 + 服务端聚合 zeus）
- 页面：`/app/approvals`（D1/D2/D3 待办列表）、`/app/approvals/:id`（**通知深链接落点**，直达该页）。
- 每条待办展示：决策快照（intent/domain/impact/reversibility/riskTags/proposal）、金额（amount.value/currency）、命中规则（ruleId/gradeReason）、级别 grade、状态 status、时间（createdAt/timeoutAt）、证据/replay 入口。
- 状态：D1=awaiting_approval；D2=blocked（approve-sync）；D3=blocked（human-led）。超时：当前时间超过 `timeoutAt` 标"已超时"。
- **列表实时性：轮询间隔 20s（区间 15–30s，`OPS_NOTIFY_LIST_REFRESH_MS`）+ 手动刷新按钮 + 每次审批动作后立即刷新。不做 SSE、不做 WebSocket。**
- 服务端 JSON 端点（供交互岛轮询/提交，同源 cookie 鉴权）：
  - `GET /api/approvals?status=...&grade=...&domain=...` → `{decisions:DecisionRecord[]}`（缺省返回 pending：awaiting_approval+blocked），按 createdAt 倒序。
  - `GET /api/approvals/:id` → `{decision}`（全字段）。
  - `GET /api/approvals/:id/replay?format=json|text` → `{replay}`。
  - `POST /api/approvals/:id/decision` body `{decision:'approve'|'reject', comment?}`。**approver 由服务端用会话用户名注入**；服务端先取决策 grade 做 RBAC（D3 仅 owner），再透传 zeus `/api/v1/decisions/:id/approval`；**控制台结果必须与 zeus 一致**（不本地判状态）。
- `DecisionRecord` 字段形状见 `src/server/upstream/types.ts`（对齐 zeus `core/decision-service/types.ts`）。
- 阈值（owner-only，属 RBAC 必备）：`GET /api/policy`、`PUT /api/policy/thresholds`（body `{d1MaxAmount?,d2MaxAmount?,defaultGrade?}`，透传 zeus `POST /api/v1/org/policy/thresholds`，actor 注入）。operator 调 PUT → 403。

### 3.2 只读经营看板（页面 `/app/dashboard`）
- 服务端渲染 `GET /api/v1/dashboard` 聚合，原样展示：
  - 订单 `{total,paid,completed,grossAmount}`、退款 `{total,succeeded,refundedAmount}`、内容 `{published}`、`netAmount`、`currency`、`generatedAt`。
  - 口径：订单/退款/内容/净额（GMV−成功退款），**不含成本**；不重算，逐字段一致。

### 3.3 通知（卡片 + 深链接；唯一写入口在控制台）
- IM 通知**只做卡片通知 + 深链接回控制台**；**不做** IM 平台内直接批/驳（不做 IM 回调端点、动作令牌、平台签名验签），二期再议。
- 轮询 zeus pending（awaiting_approval + blocked），仅对 **grade D2/D3** 产生通知。
- 事件：`pending`（新挂起）、`timeout`（过 timeoutAt 未决）、`escalation`（超时后 `OPS_NOTIFY_ESCALATION_MINUTES` 升级）、`channel_failure`（投递超重试上限）。
- 幂等键 `decisionId+event`，同 decisionId 同事件只投递一次（**进程重启后仍幂等**，落 `OPS_NOTIFY_STORE_FILE` JSONL）。
- 挂起后 **≤ 60s** 投递（默认轮询 5s）；失败指数退避（5s/15s/45s），超限 `channel_failure` 可在投递日志看到。
- webhook 卡片载荷：
```json
{ "event":"pending", "decisionId":"…", "grade":"D2", "domain":"…", "intent":"…",
  "amount":{"value":1299,"currency":"CNY"}, "ruleId":"…", "status":"blocked",
  "createdAt":"…", "timeoutAt":"…",
  "deepLink":"http://127.0.0.1:3022/app/approvals/dec_…",
  "message":"[D2 待审批] …（金额/规则/超时）" }
```
- 端点：`GET /api/notify/config`（登录可读，webhookUrl 脱敏）、`PUT /api/notify/config`（owner-only）、`GET /api/notify/deliveries`（登录可读）、`POST /api/notify/test`（owner-only）。
- 通知页：`/app/notifications`（配置 + 投递日志）。
- 本地接收端：`scripts/fake-webhook-receiver.ts`（3023；`POST /hook` 收、`GET /received` 查）。

## 4. 第二批交付（受控写，第一批验收后再做）

页面 `/app/products`、`/app/orders`、`/app/refunds`、`/app/content`、`/app/inventory`：只读列表 + 受控动作；服务端经 `src/server/upstream/commerce.ts` 透传 commerce `/api/v1/*`（操作者字段注入会话用户名）。
- 上架提交：`POST /api/listings`（423 awaiting_approval 透传）；批准/驳回 `/api/v1/listings/:decisionId/approve|reject`（若对应 D3 决策，operator 同样 403）。
- 退款审批：`POST /api/refunds`（申请，423 透传）、`POST /api/refunds/:id/decision`。
- 库存手工调整：`POST /api/inventory` `{skuId,qty}`。
- 只读：products/categories、orders、refunds、events（内容/发布记录）、inventory、channel-accounts（`POST /api/channels/accounts` owner-only）。
- commerce 无独立"上架提交列表"端点：待审批上架以 zeus 待办（domain 过滤）为准，内容页读事件流；确认缺端点只登记"内核缺口"，不臆造。

## 5. 验收自测（本地真实服务优先）

1. 未登录访问全部受保护页面 → 跳登录；受保护 `/api/*` → 401。
2. operator 改阈值 → 403；operator 审批 D3 → 403；operator 可审批 D1/D2、可做受控业务动作。
3. 浏览器侧（页面 HTML/JS/网络）不出现任何上游 token/密钥（grep 构建产物为证）。
4. 控制台批准/驳回结果与 zeus `/approval` 一致（真实 zeus 联调）。
5. 看板数字与 commerce `GET /api/v1/dashboard` 逐字段一致。
6. 通知：本地制造 D2/D3 挂起 → ≤60s 接收端收到卡片 → 重复轮询不重复投递 → 深链接直达 `/app/approvals/:id`。
7. 关掉 ops-console 进程后，zeus/commerce 各自 `/healthz` 与 API 不受影响。
