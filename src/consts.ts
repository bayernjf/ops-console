export const APP_NAME = 'ops-console';
export const APP_TITLE = 'Tier0 运营控制台';

export const NAV_ITEMS = [
  { href: '/app/approvals', label: '审批工作台' },
  { href: '/app/dashboard', label: '经营视图' },
  // Tier0 M2 W2-5: zeus observability face (owner-only), separate from the
  // commerce approval queue above.
  { href: '/app/traces', label: 'Agent 追踪' },
  // Batch 2 (controlled writes):
  { href: '/app/products', label: '商品' },
  { href: '/app/orders', label: '订单' },
  { href: '/app/refunds', label: '退款' },
  { href: '/app/content', label: '内容' },
  { href: '/app/inventory', label: '库存' },
  { href: '/app/notifications', label: '通知投递' },
  { href: '/app/settings', label: '设置' },
];
