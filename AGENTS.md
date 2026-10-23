# AGENTS.md — ops-console 工程规则（给任何在本仓工作的智能体/人）

## 这是什么
Tier0 产品族的**面向人运营工作台**（M8）。形态：**单进程 Astro 7 SSR（node adapter）+ React 19 交互岛**。Astro 服务端聚合 zeus 决策/组织 API（`/api/v1/*`）与 commerce-os API（`/api/v1/*`），页面服务端渲染，审批按钮/表单/列表刷新等少量交互用 React 岛。**服务端只做聚合与鉴权透传，不持有业务规则**；关掉控制台，zeus/commerce 底层 API 不受影响。

## 硬边界（违反即返工）
- 只在**本仓** `/Users/jiangfeng/000mycodes/ops-console` 改动。**禁止修改** zeus / commerce-os / agent-world / atlas / loom / agent-dev 任何代码。
- 上游缺接口时不自己改内核：在 `handoff.md` 的"内核缺口（需回到 zeus/commerce 做）"登记（缺什么、期望形状、阻塞哪个验收）。
- 明确不做：多租户/租户隔离、计费、自研支付/物流/发票/记账、自研财务/CRM/采购、M7 任务执行监控。
- 不做现网部署、不 push 任何远程、不连真实外部 webhook；通知只做本地接收端投递验证。
- 不标记 GATE-M8 过门（需连续 7 天现网运营，属外部验收）。
- 任何 API/数据库密钥、凭据**严禁入仓**；只给 `.env.example` 占位，`.env` 已 gitignore。
- 不建 ops-console-landing：公开静态门面是后续主线单独建的独立静态仓，本仓不做、也不代建。

## 形态约束（2026-10-24 校准）
- 不做 server+web 双进程、不做独立 SPA；**一个进程、一个部署单元**。
- 审批唯一写入口在控制台：IM 通知只做卡片 + 深链接；**不做** IM 回调端点/动作令牌/平台签名验签（二期）。
- 待办列表实时性：**轮询 15–30s（取 20s）+ 手动刷新 + 动作后刷新**；不做 SSE/WebSocket。
- 认证：不建用户表、不注册；本地 env 角色密码 + HMAC 签名 httpOnly cookie；生产预留 Cloudflare Access（信任受保护头）、VPS 兜底 GitHub OIDC（本期只留缝，不实现）。

## 技术栈
- Node 22（本机 22.23.2；Astro 锁定 **7.2.10**，7.4 要求 Node ≥22.23.4 不可用）、ESM。
- Astro 7.2（output server, @astrojs/node standalone）、@astrojs/react 5、React 19。
- 服务端测试：Vitest（真实 HTTP 端到端优先）；类型检查：`astro check`；ESLint flat config。
- 不引入重型 UI 库（antd/mui 等）；手写 CSS，家族深色工业控制台 token 在 `src/styles/tokens.css`（steel/power/data 色板，取自 tier0-landing）。

## 目录
```
ops-console/
  CONTRACT.md                # 冻结契约（改接口先改这里）
  astro.config.mjs           # 单进程 SSR + react 岛
  scripts/dev-upstream.sh    # 本地起 zeus:3020 + commerce:3021
  scripts/fake-webhook-receiver.ts  # 本地假 webhook 接收端:3023
  src/
    middleware.ts            # 会话校验 + 路由保护 + 启动通知调度
    server/
      config.ts              # 环境配置（仅服务端）
      auth.ts session.ts rbac.ts
      context.ts             # 上游客户端单例
      upstream/{http,zeus,commerce,types}.ts  # 薄透传客户端
      notify/                # 通知引擎（轮询/幂等/升级/投递）
    pages/
      login.astro 403.astro index.astro healthz.ts
      app/                   # approvals / dashboard / products / orders / refunds / content / inventory / settings / notifications
      api/                   # auth / approvals / policy / notify / 受控写 端点
    layouts/ConsoleLayout.astro
    styles/tokens.css
  tests/                     # Vitest
```

## 本地联调（优先对真实服务，不臆造 API）
1. 确保 `../zeus`、`../commerce-os` 已 `npm run build`（dist 存在）。
2. `cp .env.example .env`（根目录）；`npm install`。
3. `npm run dev:upstream` 起 zeus(3020)+commerce(3021)。
4. `npm run dev` 起 SSR 控制台(3022)；通知验收时 `npm run dev:receiver` 起接收端(3023)。
5. 契约形状依据（读代码，不要猜）：
   - zeus：`../zeus/tests/decision-contract-v1.test.ts`、`../zeus/tests/org-contract-v1.test.ts`、`../zeus/src/http/decision-v1.ts`、`../zeus/src/http/org-v1.ts`、`../zeus/src/core/decision-service/types.ts`。
   - commerce：`../commerce-os/src/api/routes.ts`、`../commerce-os/src/dashboard/dashboard-service.ts`、`../commerce-os/tests/`。
6. 真实上游成本过高时允许契约级 mock（Vitest 内 node:http 假上游），但形状严格对照上述文件；交付时说明哪些真实、哪些 mock。

## 完成定义（每个任务）
- 自测全绿（vitest + astro check + eslint + build）；本地验收门槛见 `CONTRACT.md §5`。
- 文档更新：README 运行说明、handoff 完成项/缺口/验证方式。
- git：原子提交、英文 conventional commit message（如 `feat(notify): ...`）、无 AI co-author、**不 push**。
- 数字/状态不本地编造，一律来自上游真实响应；上游失败 fail-closed 透传 503。
