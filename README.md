# ops-console

Tier0 产品族的**运营控制台**（M8）：单进程 SSR 工作台，让日常运营动作（审批、订单、退款、内容、库存、看数据）不再直接调 API；D2/D3 挂起/超时能主动推送通知到人。

- **形态**：Astro 7 SSR（node adapter，单进程）服务端聚合 zeus 决策/组织 API 与 commerce-os API；页面服务端渲染，审批按钮/表单/列表刷新等少量交互用 React 19 交互岛。上游 bearer/token 只在服务端持有，浏览器侧零密钥。
- **无业务规则**：服务端只做聚合与鉴权透传；关掉控制台，zeus/commerce 底层 API 不受影响。

## 范围
- 单主账号 + 最小 RBAC：owner（可审批 D1/D2/D3、可改阈值/通知配置）、operator（可操作、可审批 D1/D2、不可改阈值、不可做 D3 审批）。
- 第一批：认证/RBAC、只读经营看板（订单/退款/内容/净额，不含成本）、D1–D3 审批工作台（批准/驳回，与 zeus `/approval` 一致）、通知卡片 + 审批深链接（本地 webhook 全链路）。
- 第二批（受控写）：上架提交、退款审批、库存手工调整。
- 通知：IM 只做卡片 + 深链接回控制台（不在 IM 内批/驳）；D2/D3 挂起/超时/通道失败 webhook，超时升级，按 decisionId 幂等。
- **明确不做**：多租户/计费、自研支付/物流/发票/记账/财务/CRM/采购、M7 任务执行监控、现网部署、真实外部 webhook 触达（本轮仅本地验证）、ops-console-landing 公开门面（后续主线单独建）。

## 端口（避开家族已占用的 landing 3018/5188、commerce 3019/5187）
| 服务 | 端口 |
|---|---|
| zeus（上游） | 3020 |
| commerce-os（上游） | 3021 |
| **ops-console SSR（单进程）** | **3022** |
| 本地假 webhook 接收端 | 3023 |

## 本地运行
```bash
# 前置：先在 ../zeus 与 ../commerce-os 执行过 npm install 与 npm run build
cp .env.example .env          # 本地占位账号/token，勿提交真实密钥
npm install

npm run dev:upstream          # zeus(3020) + commerce(3021)
npm run dev                   # SSR 控制台(3022)，打开 http://127.0.0.1:3022
npm run dev:receiver          # 通知本地验收：假 webhook 接收端(3023)
```
用 `.env` 中的 owner / operator 账号登录（本地默认密码 owner-change-me / operator-change-me）。
`OPS_SESSION_SECRET`、两个角色密码、`ZEUS_INTERNAL_TOKEN`、`COMMERCE_API_TOKEN` 为必填：
缺失时启动门禁（`predev`/`prestart`）直接报错退出，不会带弱默认值启动；启动成功时会打印
一行授权姿态（`auth posture: fail-closed`）。

## 测试 / 构建
```bash
npm run check       # astro check（类型）
npm run lint        # eslint
npm run build       # SSR 构建（dist/）
npm test            # Vitest（RBAC/契约/通知本地端到端）
```

## 文档
- `CONTRACT.md`：页面/端点/交互岛/服务端模块的冻结契约。
- `AGENTS.md`：工程规则与硬边界。
- `handoff.md`：方向决策、完成项、内核缺口、本地验证方式、外部验收遗留。

## 生产认证预留
- 本地：`OPS_AUTH_MODE=local`（env 角色密码 + 签名会话）。
- 生产：`cf`（Cloudflare Access 受保护头）/ `oidc`（VPS 兜底 GitHub OIDC）为预留 seam，本期不实现，失败即拒。

## 真实链路验收（本地三进程）
```bash
bash scripts/seed-dev.sh         # 一次性：幂等建沙箱渠道账号 + 演示商品（免凭据）
bash scripts/verify-batch1.sh    # 401/403、D3 owner-only、审批与 zeus 一致、看板口径：PASS 29/0
bash scripts/verify-notify.sh    # 挂起→投递(≤60s)→幂等→深链接 200（脚本自起 3023 接收端）
bash scripts/verify-batch2.sh    # 上架 D3/拉单/库存/退款 D2 受控写闭环：PASS 21/0
```

## 状态
- **第一批（认证/RBAC、只读看板、D1–D3 审批、通知深链接）开发完成 + 本地验证全绿**。
- **第二批（受控写：商品/订单/退款/内容/库存只读页 + 上架提交/退款审批/库存手工调整）开发完成 + 本地验证全绿**。
- 最终：Vitest 40/40、astro check 0 error、eslint 0、build 成功；`verify-batch1.sh` 29/0、`verify-notify.sh` OK、`verify-batch2.sh` 21/0。
- **GATE-M8 未过门**：连续 7 天现网运营、真实 webhook 触达、真实店铺/云部署依赖外部条件，不在本轮范围。
