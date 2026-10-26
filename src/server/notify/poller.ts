/**
 * Notify poller: polls zeus pending decisions, turns D2/D3 state transitions
 * into webhook-carded events, and dedupes by decisionId+event via the store.
 *
 * Events:
 *  - pending:    a D2/D3 decision is seen waiting for the first time.
 *  - timeout:    its timeoutAt has passed while it is still waiting.
 *  - escalation: timeoutAt has passed and escalationMinutes have elapsed.
 *  - channel_failure: a delivery exhausted its retries (recorded for the ops
 *                log; also best-effort POSTed so the channel sees the alert).
 *
 * Time-dependent logic reads an injected `now()` so tests can fast-forward
 * without real timers; the default host wires real Date.now() and setInterval.
 */
import type { ZeusUpstream } from '../upstream/zeus.js';
import type { DecisionRecord } from '../upstream/types.js';
import type { NotifyStore } from './store.js';
import type { DeliveryOutcome, DeliveryRecord, NotifyEvent, WebhookPayload } from './types.js';

export interface PollerDeps {
  zeus: ZeusUpstream;
  store: NotifyStore;
  webhookUrl: string;
  publicBaseUrl: string;
  escalationMinutes: number;
  pollMs: number;
  now(): number;
  /** Delivery function; injectable in tests (real host: deliverWebhook). */
  deliver(payload: WebhookPayload): Promise<DeliveryOutcome>;
}

export interface PollerHandle {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

function deepLinkOf(publicBaseUrl: string, decisionId: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/app/approvals/${decisionId}`;
}

function amountText(decision: DecisionRecord): string {
  if (!decision.amount) return '无金额';
  return `${decision.amount.value} ${decision.amount.currency}`;
}

function messageFor(decision: DecisionRecord, event: NotifyEvent, escalationMinutes: number): string {
  const base = `[${decision.grade} ${decision.intent}] ${decision.id}`;
  switch (event) {
    case 'pending':
      return `${base} 待审批：域 ${decision.domain}，金额 ${amountText(decision)}，命中规则 ${decision.ruleId}${
        decision.timeoutAt ? `，SLA 超时时间 ${decision.timeoutAt}` : ''
      }。请打开审批工作台处理。`;
    case 'timeout':
      return `${base} 已超过 SLA（${decision.timeoutAt ?? '未知'}），进入宽限期（pending-but-late），仍可审批，请立即处理。`;
    case 'escalation':
      return `${base} 超时已超过 ${escalationMinutes} 分钟未处理（超时于 ${decision.timeoutAt ?? '未知'}），请升级关注。`;
    case 'channel_failure':
      return `${base} 通知通道异常：投递多次重试后仍失败，请检查 webhook 通道。`;
  }
}

function buildPayload(
  decision: DecisionRecord,
  event: NotifyEvent,
  deps: Pick<PollerDeps, 'publicBaseUrl' | 'escalationMinutes'>,
): WebhookPayload {
  return {
    event,
    decisionId: decision.id,
    grade: decision.grade,
    domain: decision.domain,
    intent: decision.intent,
    ...(decision.amount ? { amount: decision.amount } : {}),
    ruleId: decision.ruleId,
    status: decision.status,
    ...(decision.createdAt ? { createdAt: decision.createdAt } : {}),
    ...(decision.timeoutAt ? { timeoutAt: decision.timeoutAt } : {}),
    ...(decision.lateAt ? { lateAt: decision.lateAt } : {}),
    deepLink: deepLinkOf(deps.publicBaseUrl, decision.id),
    message: messageFor(decision, event, deps.escalationMinutes),
  };
}

function buildFailurePayload(
  decision: DecisionRecord,
  outcome: DeliveryOutcome,
  deps: Pick<PollerDeps, 'publicBaseUrl' | 'escalationMinutes'>,
): WebhookPayload {
  const reason = `${outcome.error ?? 'unknown error'}${outcome.httpStatus !== undefined ? ` (HTTP ${outcome.httpStatus})` : ''}，已重试 ${outcome.attempts} 次`;
  const base = buildPayload(decision, 'channel_failure', deps);
  return { ...base, message: `${base.message} 原因：${reason}` };
}

export function createPoller(deps: PollerDeps): PollerHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Reentrancy guard: a single failed webhook delivery blocks for the whole
   * backoff window (~65s at default 5s/15s/45s) while the interval fires every
   * pollMs. Overlapping ticks would otherwise each observe
   * store.seen(decisionId,'pending') === false (the first emit has not
   * upserted yet) and spawn duplicate deliveries + duplicate channel_failure
   * rows. While a tick is in flight every other tick — manual or scheduled —
   * is skipped entirely.
   */
  let running = false;

  async function emit(decision: DecisionRecord, event: NotifyEvent): Promise<void> {
    if (deps.store.seen(decision.id, event)) return;
    const payload = buildPayload(decision, event, deps);
    const outcome = await deps.deliver(payload);
    const nowIso = new Date(deps.now()).toISOString();
    const record: DeliveryRecord = {
      decisionId: decision.id,
      event,
      grade: decision.grade,
      status: outcome.ok ? 'delivered' : 'failed',
      attempts: outcome.attempts,
      lastAttemptAt: nowIso,
      ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      deepLink: payload.deepLink,
    };
    deps.store.upsert(record);

    if (!outcome.ok && event !== 'channel_failure') {
      // Retries exhausted: surface a channel_failure event (deduplicated per
      // decisionId). Best-effort POST; its own failure is recorded as well.
      const failurePayload = buildFailurePayload(decision, outcome, deps);
      const failureOutcome = await deps.deliver(failurePayload);
      deps.store.upsert({
        decisionId: decision.id,
        event: 'channel_failure',
        grade: decision.grade,
        status: failureOutcome.ok ? 'delivered' : 'failed',
        attempts: failureOutcome.attempts,
        lastAttemptAt: new Date(deps.now()).toISOString(),
        ...(failureOutcome.httpStatus !== undefined ? { httpStatus: failureOutcome.httpStatus } : {}),
        ...(failureOutcome.error !== undefined ? { error: failureOutcome.error } : {}),
        deepLink: payload.deepLink,
      });
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await tickOnce();
    } finally {
      running = false;
    }
  }

  async function tickOnce(): Promise<void> {
    let pending: DecisionRecord[];
    try {
      pending = await deps.zeus.listPending();
    } catch {
      // Upstream hiccup: wait for the next tick rather than cascading.
      return;
    }
    const nowMs = deps.now();
    const escalationMs = deps.escalationMinutes * 60_000;

    for (const decision of pending) {
      if (decision.grade !== 'D2' && decision.grade !== 'D3') continue;
      if (decision.status !== 'blocked' && decision.status !== 'awaiting_approval') continue;

      await emit(decision, 'pending');

      if (decision.timeoutAt) {
        const timeoutMs = Date.parse(decision.timeoutAt);
        if (Number.isFinite(timeoutMs) && nowMs >= timeoutMs) {
          await emit(decision, 'timeout');
          if (nowMs >= timeoutMs + escalationMs) {
            await emit(decision, 'escalation');
          }
        }
      }
    }
  }

  function start(): void {
    if (timer !== null) return;
    // Fire immediately so a newly-polled pending card goes out well within 60s,
    // then repeat on the interval.
    void tick().catch(() => undefined);
    timer = setInterval(() => {
      void tick().catch(() => undefined);
    }, deps.pollMs);
    // Do not keep the process alive solely for the poller.
    timer.unref?.();
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tick, start, stop };
}
