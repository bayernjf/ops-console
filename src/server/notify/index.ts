/**
 * Notification engine entry point (T-M8-05).
 *
 * Stable integration surface consumed by middleware and the notify API
 * endpoints: startNotifyScheduler / getNotifyConfig / updateNotifyConfig /
 * listDeliveries / sendTestNotification. Function names and signatures must
 * stay stable — middleware depends on them.
 *
 * The poller runs server-side only (Astro SSR request/middleware context). It
 * is never imported by browser code.
 */
import type { ServerContext } from '../context.js';
import { NotifyStore } from './store.js';
import { createPoller, type PollerHandle } from './poller.js';
import { deliverWebhook } from './webhook.js';
import type {
  DeliveryRecord,
  NotifyConfigView,
  NotifyRuntimeConfig,
  WebhookPayload,
} from './types.js';

/** Mask a webhook URL for display: scheme + host only (path/query/token hidden). */
export function maskWebhookUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

let runtime: NotifyRuntimeConfig | null = null;
let store: NotifyStore | null = null;
let poller: PollerHandle | null = null;
/** Ctx captured by startNotifyScheduler; reused by config/test endpoints. */
let activeCtx: ServerContext | null = null;

function ensureRuntime(ctx: ServerContext): NotifyRuntimeConfig {
  if (runtime) return runtime;
  runtime = {
    enabled: ctx.config.notify.enabled,
    webhookUrl: ctx.config.notify.webhookUrl,
    pollMs: ctx.config.notify.pollMs,
    escalationMinutes: ctx.config.notify.escalationMinutes,
    storeFile: ctx.config.notify.storeFile,
    publicBaseUrl: ctx.config.publicBaseUrl,
  };
  store = new NotifyStore(runtime.storeFile);
  store.load();
  return runtime;
}

function rebuildPoller(): void {
  if (!runtime || !activeCtx) return;
  poller?.stop();
  if (!runtime.enabled) {
    poller = null;
    return;
  }
  const r = runtime;
  poller = createPoller({
    zeus: activeCtx.zeus,
    store: store as NotifyStore,
    webhookUrl: r.webhookUrl,
    publicBaseUrl: r.publicBaseUrl,
    escalationMinutes: r.escalationMinutes,
    pollMs: r.pollMs,
    now: () => Date.now(),
    deliver: (payload: WebhookPayload) => deliverWebhook(r.webhookUrl, payload),
  });
  poller.start();
}

/** Idempotent: safe to call on every request; starts the poller once. */
export function startNotifyScheduler(ctx: ServerContext): void {
  if (poller !== null && activeCtx !== null) return;
  activeCtx = ctx;
  ensureRuntime(ctx);
  rebuildPoller();
}

export function getNotifyConfig(): NotifyConfigView {
  if (!runtime) {
    return { enabled: false, webhookUrl: '', pollMs: 5000, escalationMinutes: 15 };
  }
  return {
    enabled: runtime.enabled,
    webhookUrl: maskWebhookUrl(runtime.webhookUrl),
    pollMs: runtime.pollMs,
    escalationMinutes: runtime.escalationMinutes,
  };
}

/**
 * Owner-only runtime update (authorization enforced by the API route).
 * In-memory for this process; on process restart values revert to env.
 */
export function updateNotifyConfig(patch: Partial<NotifyConfigView>): NotifyConfigView {
  if (!runtime || !activeCtx) {
    throw new Error('notify scheduler not started; call startNotifyScheduler first');
  }
  const r = runtime;
  if (typeof patch.enabled === 'boolean') r.enabled = patch.enabled;
  if (typeof patch.webhookUrl === 'string' && patch.webhookUrl.length > 0) r.webhookUrl = patch.webhookUrl;
  if (typeof patch.pollMs === 'number' && patch.pollMs > 0) r.pollMs = Math.floor(patch.pollMs);
  if (typeof patch.escalationMinutes === 'number' && patch.escalationMinutes > 0) {
    r.escalationMinutes = Math.floor(patch.escalationMinutes);
  }
  rebuildPoller();
  return getNotifyConfig();
}

export function listDeliveries(): DeliveryRecord[] {
  return store?.list() ?? [];
}

/** Immediately POST one synthetic test card; record it in the durable store. */
export async function sendTestNotification(ctx: ServerContext): Promise<DeliveryRecord> {
  const r = ensureRuntime(ctx);
  const testId = `test-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const deepLink = `${r.publicBaseUrl.replace(/\/$/, '')}/app/approvals/test`;
  const payload: WebhookPayload = {
    event: 'pending',
    decisionId: testId,
    grade: 'D2',
    domain: 'ops-console.self-test',
    intent: '通知通道测试',
    amount: { value: 1, currency: 'CNY' },
    ruleId: 'self-test',
    status: 'blocked',
    deepLink,
    message: `[D2 通知通道测试] ${testId}：这是一条来自 ops-console 的测试卡片，用于验证 webhook 通道与深链接。`,
  };
  const outcome = await deliverWebhook(r.webhookUrl, payload);
  const record: DeliveryRecord = {
    decisionId: testId,
    event: 'pending',
    grade: 'D2',
    status: outcome.ok ? 'delivered' : 'failed',
    attempts: outcome.attempts,
    lastAttemptAt: new Date().toISOString(),
    ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    deepLink,
  };
  (store as NotifyStore).upsert(record);
  return record;
}
