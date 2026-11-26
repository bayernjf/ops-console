# ops-console · handoff

## 待办登记（标准）

> 本段是本产品唯一活跃待办入口；详细背景见下方原有章节。完成一项改 `[x]`，并在“最近变更 / Recently shipped”留证据。
> 最近同步：2026-11-22

<!-- tier0:todos v1 -->
| id | title | status | priority | owner | next | evidence | updated |
|---|---|---|---|---|---|---|---|
| OC-01 | GATE-M8 连续 7 天现网运营 | open | p1 | self | 连续 7 天全部在控制台完成、无人直接调 API | - | 2026-11-22 |
| OC-02 | 真实 webhook（飞书/微信/邮件） | blocked | p1 | owner | owner 提供 `OPS_NOTIFY_WEBHOOK_URL` 等外部地址 | - | 2026-11-22 |
| OC-03 | 生产认证 Cloudflare Access / GitHub OIDC | blocked | p2 | external | 现网部署解冻后接入；当前保留 seam | - | 2026-11-22 |
<!-- /tier0:todos -->

### 已完成（历史）

- [x] **退款页/内容页切 commerce 新端点** — 已完成（2026-11-22 复核）。代码已在 `a75e6d0` 落地：commerce client 的 `listRefunds/listContent/getContent`、退款页 SSR 真实列表、内容页 `GET /api/v1/content` published 投影均已接线；`tests/commerce-lists.test.ts` 4 例通过，全量 Vitest 271/271 绿。

## 2026-11-27 `/metrics` 端点（Tier0 collector，OB-01）

- ✅ 新增 `src/server/metrics.ts`（纯聚合/渲染）+ `src/pages/metrics.ts`
  （Astro endpoint，`GET /metrics`）；`middleware.ts` 把 `/metrics` 加入
  `PUBLIC_PATHS`（collector 无鉴权抓取）。
- ✅ 指标族：`ops_console_up` / `ops_console_uptime_seconds` /
  `ops_console_metrics_snapshot_timestamp_seconds` /
  `ops_console_notify_deliveries{event,status}` /
  `ops_console_notify_deliveries_total`。只导出通知投递账本的计数，
  不导出 decision id / deep link / webhook URL / error text。
- ✅ compose：`ops-console` service 加入 `tier0-net`（external），collector
  用 `ops-console:3022` 抓取。
- ✅ 测试 `tests/metrics.test.ts` 2 例；全量 38 文件 / 273 tests 全绿、lint 0、
  `astro check` 0（fnm v22.23.4，本机默认 v22.23.2 低于 Astro 下限）、build 通过、
  `docker compose config` OK。
- ⬜ 端到端现测待容器在 tier0-net 运行后补（`ops_console_up=1` + 面板取到样本）。

## 2026-11-19 Tier0 组织层 F2.1 控制台侧：owner-only 组织建模

- ✅ `/app/org/manage` 上线（owner-only，`canManageOrg`）：三个创建表单
  （组织 / 部门 / 岗位）+ 岗位表逐行绑定 / 换绑 agent；成功后整页 reload，
  数据与 zeus 同源。`/app/org` 的「组织建模 →」入口仅 owner 可见；operator
  可打开页面但只看到 owner-only 提示，写请求 403。
- 改动：`src/server/upstream/types.ts`（`OrgScaleTier` / 四个 create/assign
  input / `OrgManageSnapshot`）、`src/server/upstream/zeus.ts`（四个写方法）、
  `src/server/org-manage-service.ts`（三路 fan-out + 四个 parse）、
  `src/server/rbac.ts`（`canManageOrg`）、四个 BFF
  （`/api/org/manage/organizations|departments|positions` 与
  `positions/:id/assign-agent`）、`src/pages/app/org/manage/index.astro`、
  `src/islands/OrgManagePanel.tsx`、`src/pages/app/org/index.astro`（owner 入口）。
- 写边界：控制台只校验 body 形状与枚举/数值边界（scaleTier、concurrencyLimit
  1..8、decisionScope D0–D3、必填 name/mission/org/department）；id 冲突、父级
  存在性、岗位所属部门仍由 zeus 判断，4xx 原样透传。动态段 id 先
  `decodeURIComponent`，避免 `pos:xxx` 双重编码后 404。
- 测试：`tests/org-manage-service.test.ts` 10 例（真实 HTTP fake zeus：
  read model 三路 fan-out、组织/部门/岗位创建路径与 body、绑定 agent 路径、
  上游 400 透传、scaleTier/concurrencyLimit 边界、部门必填、岗位数组归一化与
  决策档、agentId 必填）。
- 门：`astro check` 0 error、`eslint` 0、`vitest` 37 文件 271 用例全绿、
  `astro build` 成功。
- 真实链路（zeus 18787 + 临时 console 3022）：
  - owner 登录 200；`/app/org/manage` 200；`/app/org` 200 且有「组织建模 →」；
  - `POST /api/org/manage/organizations` 201 创建
    `org:console-manage-verify`（scaleTier=team，concurrencyLimit=2）；
  - `POST .../departments` 201 创建 `dept:console-manage-verify`；
  - `POST .../positions` 201 创建 `pos:console-manage-verify`（D1）；
  - `POST .../positions/pos%3Aconsole-manage-verify/assign-agent` 200，绑定
    `agent:console-verify-2`；页面 200 命中组织/部门/岗位与 agent；
  - operator 页面 200 仅 owner-only 提示，POST 403 `FORBIDDEN`；未登录 POST
    401 `UNAUTHORIZED`。
  - 验收组织/部门/岗位保留在 zeus volume；控制台不做删除。
- 未做：部门/岗位编辑与删除、agent 解绑、credentialRefs 表单、组织树拖拽。

## 2026-11-19 Tier0 组织层 M5 补充：目标状态流转（暂停/恢复/归档）

- ✅ `/app/org/goals` 增加操作列（`canDoControlledAction`，owner/operator 均可用）：
  active → 暂停/归档；paused → 恢复/归档；archived → 恢复；done → 归档。
  成功后整页 reload，列表与 zeus 同源；失败时按钮旁 `role="alert"` 显示上游 message。
- 改动：`src/server/upstream/types.ts`（`ConsoleGoalStatus` /
  `UpdateOrgGoalStatusInput`）、`src/server/upstream/zeus.ts`
  （`updateOrgGoalStatus` → `PATCH /api/v1/org/goals/:id`）、
  `src/server/org-goal-service.ts`（`parseUpdateGoalStatusInput`）、
  `src/pages/api/org/goals/[id].ts`（PATCH BFF）、
  `src/pages/app/org/goals/index.astro`（操作列）、
  `src/islands/OrgGoalStatusActions.tsx`、`CONTRACT.md §8`。
- 写边界：PATCH 只接受 `{status}`，且只允许 active/paused/archived；任何额外字段
  （title/period/schedule/template）在控制台边界 400，避免误改；`done` 属任务侧
  结果不开放手动设置。zeus 仍拥有真实状态流转，4xx 原样透传。
- 测试：`tests/org-goal-status-service.test.ts` 7 例（真实 HTTP fake zeus：
  status-only PATCH 透传、暂停/恢复/归档、上游 404 透传、done/额外字段/非对象拒绝）。
- 门：`astro check` 0 error、`eslint` 0、`vitest` 36 文件 261 用例全绿、
  `astro build` 成功。
- 真实链路（zeus 18787 + 临时 console 3022，owner/operator 登录）：
  - `GET /api/org/goals` 200，`org:m5-verify` 存在、当时 0 个目标；
  - `POST /api/org/goals` 201 创建 `goal-mwn5z17l-04oxr`（period=once，不排班）；
  - PATCH `paused` / `active` / `archived` 均 200，返回状态与 updatedAt 同步变化；
  - PATCH `done` 400 `VALIDATION_FAILED`；PATCH 带 `title` 400
    `only status can be updated from the console (got title)`；
  - `/app/org/goals` 200 命中「M5状态验收-归档」「已归档」「操作」；
  - operator PATCH `active` 200（受控写两角色可用），owner 再 PATCH `archived` 200。
  - 验收目标最终保留为 archived；zeus 无 DELETE goal 的控制台入口，删除仍不做。
- 未做：标题/周期/模板编辑、删除目标；删除需单独设计确认与审计。

## 2026-11-19 Tier0 组织层 M4：经验候选与 SOP 页（F4.2 控制台侧）

- ✅ `/app/org/experience` 上线（owner/operator 可读，`canViewOrg`）：候选表
  （标题 / 详情 / 组织 / 来源任务 / 目标技能 / 类型 failure-avoidance|success-recipe /
  状态 pending|promoted / 时间）+ SOP 目录（静态步骤 + 已提升建议 advisory）。
  owner 每行可「提升到 SOP」，operator 只读并显示提示。
- 改动：`src/server/upstream/types.ts`（`ExperienceCandidate` / `SopAdvisory` /
  `PositionSopView` / `OrgExperienceSnapshot`）、`src/server/upstream/zeus.ts`
  （`listExperienceCandidates` / `promoteExperience` / `listSops`）、
  `src/server/org-experience-service.ts`（read model + promote body 校验）、
  `src/server/rbac.ts`（`canPromoteExperience`，owner-only）、
  `src/pages/api/org/experience/index.ts`（GET BFF）、
  `src/pages/api/org/experience/[id]/promote.ts`（POST BFF）、
  `src/pages/app/org/experience/index.astro`、`src/islands/ExperiencePromoteButton.tsx`、
  `src/consts.ts`（导航「经验与 SOP」）、`CONTRACT.md §9`。
- 读模型：`loadOrgExperience` 并行拉 candidates + sops + organizations；
  候选按 createdAt 倒序、SOP 按 skillId 排序；不建本地缓存，不做第二套候选规则。
- 写边界：`POST /api/org/experience/:id/promote` 是 owner-only 人审闸门
  （`canPromoteExperience`）；`parsePromoteExperienceInput` 只校验 body 形状与
  `skillId` 可选字符串。候选是否存在、目标技能是否在 SOP 目录仍由 zeus 决定，
  其 4xx（如 `EXPERIENCE_NOT_FOUND`）逐字透传。
- 测试：`tests/org-experience-service.test.ts` 9 例（真实 HTTP fake zeus：
  read model 三路 fan-out、organizationId 透传/省略、skillId 过滤、promote 显式/
  省略 skillId、上游 404 透传、body 校验）。
- 门：`astro check` 0 error、`eslint` 0、`vitest` 35 文件 254 用例全绿、
  `astro build` 成功。
- 真实链路（zeus 18787 容器 + 本机临时 ops-console 3022）：
  - owner 登录 200、`/app/org/experience` 200 命中「经验与 SOP」「经验候选」「SOP 目录」；
  - `GET /api/org/experience` 200，keys `candidates/sops/organizations`；
    真实候选 0 条、SOP 3 条、组织 1 个（尚无任务结算派生候选）；
  - `POST /api/org/experience/missing/promote` 返回 404 `EXPERIENCE_NOT_FOUND`，
    上游错误体原样透传；
  - operator 页面 200 且显示 owner-only 只读提示，POST 403 `FORBIDDEN`；
    未登录访问 API 401。
  - 验证后停止临时 console，未改 zeus/数据库。
- 未做：控制台不做候选编辑/删除/批量提升；候选只由 zeus 任务结算派生，
  控制台不提供伪造候选的入口。

## 2026-11-19 Tier0 组织层 M5：目标与排班页（F5.1/F5.2/F5.3 控制台侧）

- ✅ `/app/org/goals` 上线（owner/operator 可读，`canViewOrg`）：只读列出组织目标
  （标题 / 组织 / 周期 / 状态 / UTC 排班 / 模板 / 更新时间）+ 登记表单（组织、标题、
  周期 daily|weekly|once、内置模板、UTC 时·分、weekly 星期、可选 Hub 项目）。
  创建走 `POST /api/org/goals`（`canDoControlledAction`），服务端校验后逐字透传
  zeus `POST /api/v1/org/goals`。
- 改动：`src/server/upstream/types.ts`（goal / schedule / template 类型）、
  `src/server/upstream/zeus.ts`（`listOrgGoals` / `listGoalTemplates` /
  `createOrgGoal`）、`src/server/org-goal-service.ts`（read model + 表单校验）、
  `src/pages/api/org/goals/index.ts`（GET/POST BFF）、
  `src/pages/app/org/goals/index.astro`、`src/islands/OrgGoalCreateForm.tsx`、
  `src/consts.ts`（导航「目标与排班」）、`CONTRACT.md §8`。
- 读模型：`loadOrgGoals` 并行拉 goals + goal-templates + organizations；不建本地缓存，
  不做第二套调度/模板展开，页面只展示 zeus 的真相。
- 写边界：`parseCreateGoalInput` 只校验组织/标题必填、period/status 枚举、
  schedule 范围与 weekly weekday、templateRef/taskTemplate 互斥；模板是否存在、
  period/schedule 耦合、幂等键仍由 zeus 决定，4xx 原样透传。
- 测试：`tests/org-goal-service.test.ts` 9 例（真实 HTTP fake zeus：read model 三路
  fan-out、organizationId 透传/省略、创建透传、上游 400 透传、weekly weekday/
  范围/互斥校验）。
- 门：`astro check` 0 error、`eslint` 0、`vitest` 34 文件 245 用例全绿、
  `astro build` 成功。
- 真实链路（本机临时 zeus 3020 + ops-console 3022，临时 SQLite `/tmp/zeus-m5-verify.db`）：
  - `GET /api/v1/org/goals` / `goal-templates` 200；创建组织 `org:m5` 201。
  - owner 登录 200、`/app/org/goals` 200 命中「目标与排班」「登记目标」「M5验收组织」；
    `POST /api/org/goals` 201 落 `goal-mwn42n3q-0znlp`（daily 08:00 UTC + weekly-report），
    刷新页面命中「每日经营日报」「周报流水线」「08:00 UTC」「进行中」。
  - 非法 period 400 `VALIDATION_FAILED`；未登录 POST 401；operator 登录 200、页面 200
    可见同一目标（只读可读，写权限为 `canDoControlledAction`）。
  - 验证后停止临时 zeus/console，删除临时 SQLite。
- 部署状态：OrbStack `zeus` 容器已于 2026-11-19 重建
  （`docker compose up -d --build zeus`），18787 healthy，
  `GET /api/v1/org/goals` / `goal-templates` 均 200；控制台 `.env` 的
  `ZEUS_BASE_URL=18787` 已可直接使用。验收组织 `org:m5-verify`（M5验收组织）
  已建，`/app/org/goals` 登录后 200 且显示组织与登记表单。
- 验收数据：`org:m5-verify` 保留在容器 volume；zeus 暂无 DELETE organization
  API，需清空时走 volume 或后续补 API。
- 未做：控制台的编辑/暂停/归档/删除目标（M5 控制台侧只做登记与排班展示；zeus 已有
  PATCH/DELETE，需要时再加）。

## 2026-11-19 Tier0 组织层 M3：组织成本页（F3.3 控制台侧）

- ✅ `/app/costs` 上线（owner/operator 可读，`canViewOrg`）：三个维度 tab（任务 / 部门 / 岗位），
  接 model-hub `GET /api/admin/costs/org`，表格展示轴值 / calls / input·output tokens / 成本，
  顶部 totals 逐字来自上游。成本按 micro-USD 渲染，与 model-hub 管理台同一口径。
- 改动：`src/server/upstream/model-hub.ts`（登录 + 12h 会话缓存 + 401 重登一次）、
  `src/server/org-cost-service.ts`（维度白名单 + 透传）、`src/server/config.ts`（`MODEL_HUB_*`）、
  `src/server/context.ts`（modelHub 单例）、`src/server/upstream/http.ts`（`RequestOptions.headers`）、
  `src/pages/app/costs/index.astro`、`src/consts.ts`（导航「组织成本」）、`.env.example`、`CONTRACT.md §7`。
- 认证：model-hub 管理面只认 owner 会话 cookie（不是 bearer）；控制台用
  `MODEL_HUB_ADMIN_USERNAME/PASSWORD` 在服务端登录，cookie 只在进程内；密码为空时页面
  fail-closed（`503 MODEL_HUB_NOT_CONFIGURED`），不阻止控制台启动、不影响其他页面。
- 测试：`tests/org-cost-service.test.ts` 7 例（真实 HTTP fake model-hub：登录、cookie 缓存、
  401 重登、窗口透传、未配置/不可达 fail-closed、维度白名单）。
- 门：`npm run check` 0 error、`npm run lint` 0、`vitest run` 33 文件 236 用例全绿、
  `npm run build` 成功（Node 22.23.4）。
- 真实链路（本机 model-hub 8791 + ops-console 3022）：owner/operator 登录 200、
  `/app/costs` 200 且渲染真实 `task-m3a2-proof2`、`?group_by=department` 200、
  非法 `group_by=team` 回退 task 200、未登录 302；model-hub 返回 4 个 task /
  6 calls / 24,581 micros，页面 totals 与上游逐字一致。
- 未做：ops-console 不代理任务调用明细 CSV（需要明细时去 model-hub 管理台导出）。

## 2026-11-17/18 Tier0 组织层 F2.3 卡点看板端到端闭环 + 审批-恢复断链修复

- ✅ 修复：`decideApproval` 对 proposal 携带 `taskId` 的决策改走 zeus `POST /api/v1/org/tasks/:taskId/resume`（zeus 原子完成"批决策 + 恢复任务"），不再走纯决策批准端点——旧路径会批完决策却让任务永远停在 `awaiting_decision`。D3 owner-only RBAC 仍在调用前强制。`ZeusUpstream` 新增 `resumeOrgTask`。
- ✅ 测试 +3 例（`tests/approvals-service.test.ts`，fake zeus 增加 resume 路由）：org 决策批准走 resume 且纯批准端点零调用、reject 同路径、D3 org 决策 operator 403 且 resume 零调用；既有队列断言随新记录更新。全量 **33 文件 / 229 用例**。
- ✅ 端到端验收（真实三进程：zeus 18790 带 agent-dev 臂 + console 3022 + agent-dev daemon 3738）：weekly-report 模板真执行 collect→summarize→human-review 挂起（D2 org/hard）→ 任务页卡点分区出现 → 深链 `/app/approvals/[id]` 审批 → **任务自动 resume 到 done**（修复前需手动调 zeus resume 且带 approval 会撞已 decided 冲突）。未登录 302、登录后 200、owner 审批 200 全程实证。
- 门禁：`astro check` 0 error、`eslint .` 0、`vitest run` 33 文件 229 用例全绿、`astro build` 成功。

## 2026-11-17 Tier0 组织层 M2：花名册页 + 任务队列页（F2.1 / F2.2）

- ✅ F2.1 `/app/org`：只读投影 zeus `GET /api/v1/org/{organizations,departments,positions}`，
  树形渲染 组织 → 部门 → 岗位，岗位卡显示 decisionScope、绑定 agent、技能、工具、
  该岗位任务数；组织头显示 scaleTier 与 concurrencyLimit。可按 `?organization_id=` 切换组织。
- ✅ F2.2 `/app/org/tasks`：接 zeus `GET /api/v1/org/tasks`（bearer，按 org 过滤，zeus 零改动），
  七列（任务 / 岗位 / 状态 / 入队时间 / 耗时 / 重试 / 工作区），失败带 failedKind 中文与
  error 摘要；`awaiting_decision` 置顶分区并深链 `/app/approvals/[id]`（F2.3 首版并入本页）。
  岛屿 `OrgTaskQueue` 每 `OPS_NOTIFY_LIST_REFRESH_MS`（下限 5s）轮询 BFF，状态流转无需刷新。
- 改动：`src/server/upstream/{types,zeus}.ts`（Org 投影类型 + 4 个 GET 方法）、
  `src/server/org-service.ts`（快照聚合 / 队列排序 / 状态计数）、`src/server/rbac.ts`
  （`canViewOrg` = owner|operator，只读无 payload）、`src/pages/api/org/tasks/index.ts`
  （未登录/非运营角色 403）、两张页面、`src/islands/OrgTaskQueue.tsx`、`src/consts.ts`
  （nav「组织视图」，`startsWith` 使 `/app/org/tasks` 同属该条目）。
- 本地三进程验收（zeus 18788 + console 3022，seed 1 org / 1 dept / 2 positions 其中 1 个绑定
  agent / 4 pending 任务）：未登录 `/app/org`、`/app/org/tasks` → 302 到 login，
  `/api/org/tasks` → 401；登录后两页 200；花名册渲染「验收组织 small 并发上限 2 /
  部门 1 · 岗位 2 · 已绑定 1」与 zeus API 返回逐字段一致；队列页显示 4 个任务、
  岗位名由 positionId 映射、`/api/org/tasks` 返回 `counts: {pending: 4}`。
- 测试：`tests/org-service.test.ts`（7 例，node:http 假 zeus 全链路：聚合 / org 过滤 /
  空组织 / 上游不可达 fail-closed / 排序 / 计数 / RBAC）+ `tests/org-task-queue-island.test.tsx`
  （4 例：列渲染 / 卡点分区与深链 / 轮询驱动的状态流转 / 上游错误 fail-closed）。
- 门：`astro check` 135 files 0 error、`eslint .` 0、`vitest run` 32 文件 226 用例全绿、
  `astro build` 成功。
- 依赖缺口（zeus 侧，本批已修）：SQLite org store 之前不落 `concurrency_limit` /
  `workspace_path` / `outcome_json`，导致 F1.1 并发上限恒回退默认 2、F1.2 工作区与 F4.1
  结局在重启后丢失。zeus 已补 0006 迁移（见 zeus handoff 同日条目）。
- 未做：F2.3 只到「卡点置顶 + 深链」，未造真实 D3 挂起任务走完端到端；M3（成本）与
  M5（目标/排班）未开工。

> **2026-11-06 补登：dev → main 已于 2026-11-05 经 PR #14 合并（合并前 CI 全绿）；实测 origin/main 与 origin/dev 内容完全一致（git diff 为空）。**

> 规则：完成项及时登记；缺口分"内核缺口（需回到 zeus/commerce 做）"与"外部验收项"。

## 2026-10-31 Tier0 评审 P2 收尾（a11y 补齐 + 中间件/路由测试）

- ✅ UIUX 评审 P2（ops-console 0 aria / 0 focus）按 `/app/traces` 既有基准最小补齐，未做重设计：
  - 岛屿：`ApprovalList`（meta 行 `aria-live=polite`、error `role=alert`、空态 `role=status`、表头 `scope=col`）；`ApprovalActions` / `PolicyThresholds`（动作结果消息按失败/成功分 `alert`/`status`）；`RefundOps` / `InventoryOps` / `OrdersOps`（动作结果消息同上）；`ProductOps`（创建与上架两条消息同上）。
  - 页面：8 张服务端表格表头补 `scope=col`（approvals 详情审批历史、orders 列表/详情、products 详情、content、inventory、refunds、notifications 投递日志）；`ConsoleLayout` 主导航 `aria-label`；notifications 配置结果 `#notify-form-msg` `aria-live=polite`；approvals 详情 replay 外链补 `rel=noreferrer`（对齐 notifications 页既有写法）。
  - 原生已覆盖、不重复加：全站按钮均有可见文本（RefundOps 两步确认按钮此前已带 `aria-label`）；grade/status/tag 徽章的文本即状态值本身，无需额外 role；login 表单 label 隐式关联且错误提示已有 `role=alert`；`:focus-visible` 家族兜底已在 OC-5 落地（`src/styles/islands.css`）。
- ✅ 代码评审 P2（`src/middleware.ts` 与路由处理器无测试引用）补齐：
  - `tests/middleware.test.ts` 10 例：未登录页面 302（`next` 编码且保留 path+query）、未登录 API 401 统一信封、公开路径直通（login/healthz/auth login/inbound webhook）、owner/operator 有效会话通过并注入 `locals.session`、篡改签名 cookie 302、过期 cookie 302、API 携带无效 cookie 401（非重定向）、SLA 调度器 boot 启动一次且拿到已解析 config（H1 收尾）。
  - `tests/route-authz.test.ts` 10 例（node:http 假 zeus，沿用 trace-upstream 先例）：`GET /api/traces` operator 403 / 匿名 403（路由层纵深防御）；死端口 → 503 `UPSTREAM_UNAVAILABLE` 信封且不泄漏内部 base URL（H2 回归门）；zeus 400 逐字透传不二次包装；`POST /api/approvals/:id/decision` D3 operator 403（先读 grade 再 RBAC，不触审批写）、owner D2 200 且 `approver` 由服务端会话注入、非法 verdict 400 且不触上游；`PUT /api/policy/thresholds` operator 403（上游前拦截）、死端口 503、owner 200 且 `actor` 注入会话用户名。
  - 测试内预期的上游失败日志按约定 mock（`console.error` spy），不污染输出；middleware 模块的启动姿态行在 import 前静音。
- 验证：`astro check` 0 errors / `eslint .` 0 / `vitest run` 19 文件 122 用例全绿（本轮新增 21）/ `astro build` 成功。

## 2026-10-31 Tier0 M2 W2-5：Agent 追踪页（trace 查询）

- ✅ `/app/traces` 上线（owner-only）：只读 BFF 透传 zeus `GET /api/v1/traces`
  （TracePort v1 §5 / D-5，zeus 侧 W2-4 已交付）。filters（agent / from / to /
  成本区间 micros / traceId / limit）+ 结果列表（traceId、agent、开始时间、
  总耗时、总成本 micros、错误数）+ 展开看 span 树（缩进 kind/name/latency/
  error/tokens/cost；payload 已由 zeus 按 D-4 脱敏，控制台不二次处理）。
- 改动：`src/server/upstream/{types,zeus}.ts`（`TraceListFilter` /
  `getTraces`，沿用 callJson/Bearer/fail-closed）、`src/server/rbac.ts`
  （`canViewTraces` owner-only）、`src/server/traces-service.ts`（trim +
  逐字透传）、`src/pages/api/traces/index.ts`（operator → 403）、
  `src/pages/app/traces/index.astro`（fail-closed 初始加载）、
  `src/islands/TraceExplorer.tsx`（20s 轮询钳制 15–30s + 手动刷新，无 SSE/WS）、
  `src/consts.ts`（独立 nav 条目「Agent 追踪」）、`src/styles/islands.css`
  （trace 样式 + 家族级 `:focus-visible` 兜底 + `.table-wrap` 收编全局）。
- 契约登记：`CONTRACT.md §6`；无新增环境变量（复用 `ZEUS_BASE_URL` /
  `ZEUS_INTERNAL_TOKEN` / `OPS_NOTIFY_LIST_REFRESH_MS`）。
- 测试：`tests/trace-upstream.test.ts`（透传逐字 / 空参省略 / 503 fail-closed /
  400 invalid_request 透传 / service trim / RBAC）+ `tests/trace-explorer-island.test.tsx`
  （filters 渲染 / 结果渲染 / span 树展开 / 查询串 / 空态 role=status / 错误
  role=alert）。全量 Vitest 101/101、astro check、eslint、build 本地全绿。
- 依赖说明：zeus 未开启 `ZEUS_DECISION_TRACE_FILE` 时页面为空态文案（不报
  错）；契约级 mock（node:http 假上游）验证透传与 fail-closed，形状对照
  `zeus/src/observability/trace-query.ts` 与 `zeus/src/http/server.ts:1165`。

## 2026-10-31 Tier0 评审 H1 收尾（启动姿态日志）

- ✅ 评审建议"启动日志打印授权姿态"落地：SSR boot（`src/middleware.ts` 模块加载，config
  解析成功后）与 `predev`/`prestart` 门禁（`scripts/verify-required-env.ts`）各打一行
  `[ops-console] auth posture: fail-closed (secrets required from env; no insecure defaults)`。
- **不加 `OPS_INSECURE_DEV` 开关**：加开关需在源码重新引入硬编码 dev 默认密钥路径（正是
  H1 点名的模式），且该变量误入生产 env 即重现漏洞；本地开发便利由 gitignored `.env`
  占位值承载，秘密一律显式提供，缺配置即 exit 1。
- 测试：新增 `tests/boot-gate.test.ts` 3 例，真实子进程跑门禁脚本——无秘密 exit 1 并指名
  变量、单秘密为空 exit 1、全量存在 exit 0 且输出含姿态行。

## 2026-10-30 Tier0 评审 P1 核实（配置 fail-closed）

- ✅ **配置 fail-closed 已闭环**（提交 `2426fc9 fix(config): fail closed on missing secret env`，经 PR #2 合入 dev）：
  源码无任何硬编码默认口令/会话密钥（`.env.example` 仅保留占位），`OPS_SESSION_SECRET`、
  `OPS_OWNER_PASSWORD`、`OPS_OPERATOR_PASSWORD`、`ZEUS_INTERNAL_TOKEN`、`COMMERCE_API_TOKEN`
  统一走 `requiredSecret()`，缺失或为空即抛错拒绝启动。
- 测试：`tests/config.test.ts` 12 例覆盖“全部存在可加载 / 每个密钥缺失或为空拒绝启动”，本地实测全绿。
- 说明：非敏感项（用户名 `owner`/`operator`、host、端口、base URL）保留默认值，符合“仅秘密禁止默认”的设计。
- 原待办两项已在 PR #3 闭环：登录限流（`10c147a feat(auth): throttle login attempts per peer`，
  测试 `650533f test(auth): cover the login throttle`）；SLA 调度器改在 boot 启动
  （`40a6f62 fix(notify): start the SLA scheduler at boot`，middleware 模块加载即启动，不再依赖首个请求）。

## 2026-10-28 storefront 接线（SF-14，commerce-os M1 收口）

- 运营台直读 commerce 只读端点，**storefront 数据零改动入台**：真实 zeus 3020 + commerce 3021 + console 3022 三进程验证——storefront 订单（`ord_sf-cart_…`，渠道标记 storefront）、退款（`rfd_sf-cart_…` → succeeded）、库存（SKU-SF14）在对应页面可见；内容页（`GET /api/v1/content` 投影）与看板（订单/净额）正常渲染。owner 登录（OPS_AUTH_MODE=local 默认账号）验证通过。
- 接线路径：`src/server/upstream/commerce.ts`（listOrders/listRefunds/listInventory/listContent/dashboard）+ `src/pages/app/{orders,refunds,inventory,content,dashboard}/index.astro`。

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
- ~~未建 remote、未 `gh repo create`、未 `git push`~~ **2026-11-05 复核：remote 已建、dev 已推送、PR 已合并**——`origin` = `git@github.com:bayernjf/ops-console.git`，`git ls-remote` 实测远程 `dev`/`main` 均存在，本地 `dev` 与 `origin/dev` 同步、无未推送提交；`gh pr list --state all` 实测 PR #1~#12 已全部合并（均 MERGED，含 2026-11-04 的 #10/#11/#12）。
- 仓地址：github.com/bayernjf/ops-console（**已创建**，非规划态）。

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