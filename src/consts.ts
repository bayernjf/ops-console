export const APP_NAME = 'ops-console';
export const APP_TITLE = 'Tier0 运营控制台';

export const NAV_ITEMS = [
  { href: '/app/approvals', label: '审批工作台' },
  { href: '/app/dashboard', label: '经营视图' },
  // Tier0 M2 W2-5: zeus observability face (owner-only), separate from the
  // commerce approval queue above.
  { href: '/app/traces', label: 'Agent 追踪' },
  // Tier0 org M2: 组织花名册与任务队列（zeus org v1 只读投影）。
  { href: '/app/org', label: '组织视图' },
  // Tier0 org M5: 目标登记与 UTC 排班（F5.1/F5.2/F5.3）。
  { href: '/app/org/goals', label: '目标与排班' },
  // Tier0 org M4: 经验候选与 SOP 目录（F4.2，提升仅 owner）。
  { href: '/app/org/experience', label: '经验与 SOP' },
  // Tier0 org M3: 岗位 / 部门 / 任务维度的模型成本（model-hub 只读聚合）。
  { href: '/app/costs', label: '组织成本' },
  // 会议回放（只读）：本地 meeting store 的时间线与主张图。
  { href: '/app/meetings', label: '会议' },
  // Batch 2 (controlled writes):
  { href: '/app/products', label: '商品' },
  { href: '/app/orders', label: '订单' },
  { href: '/app/refunds', label: '退款' },
  { href: '/app/content', label: '内容' },
  { href: '/app/inventory', label: '库存' },
  { href: '/app/notifications', label: '通知投递' },
  { href: '/app/settings', label: '设置' },
];
