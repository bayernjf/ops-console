/**
 * Inbound zeus decision-event webhook receiver.
 *
 * zeus pushes lifecycle events (created/late/approved/rejected/timed-out) to
 * this console over an HMAC-signed webhook (the push counterpart to the 20s
 * poller). Contract (frozen in ../zeus/src/core/decision-service/webhook.ts):
 *
 *   POST <url>
 *     x-zeus-signature: sha256=<hex>   ; HMAC-SHA256 over the RAW request body
 *     x-zeus-delivery-id: <decisionId>:<type>:<at>  ; deterministic per transition
 *
 * Security:
 *  - The signature is computed over the exact raw bytes zeus sent; we never
 *    re-serialize JSON before verifying (that would change the bytes).
 *  - Comparison is constant-time (crypto.timingSafeEqual).
 *  - Unknown / missing signature, or a mismatched digest -> 401.
 *  - A seen delivery-id is acknowledged with 200 (idempotent at-least-once
 *    delivery) and NOT re-processed.
 *
 * This module only authenticates and durably records the event; it does not
 * turn it into outbound cards (the existing poller already does that on its
 * next tick). Replays never throw into the HTTP path.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type DecisionEventType =
  | 'created'
  | 'late'
  | 'approved'
  | 'rejected'
  | 'timed-out';

/** The event body zeus POSTs (decisionEventFromRecord). */
export interface DecisionEvent {
  type: DecisionEventType;
  decisionId: string;
  at: string;
  domain: string;
  intent: string;
  grade: string;
  mode: string;
  status: string;
  ruleId: string;
  slaHours?: number;
  timeoutAt?: string;
  lateAt?: string;
  outcome?: string;
  approver?: string;
  [key: string]: unknown;
}

/** Compute the expected header value for a raw body (mirrors zeus signer). */
export function signZeusBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Constant-time verification of the `x-zeus-signature` header. */
export function verifyZeusSignature(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const expected = signZeusBody(secret, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface InboundLogRow {
  deliveryId: string;
  receivedAt: string;
  event: DecisionEvent;
  duplicate: boolean;
}

/**
 * Append-only JSONL log of accepted inbound events, with an in-memory + disk
 * replay of seen delivery-ids so a process restart does not double-process.
 */
export class InboundEventLog {
  private readonly seen = new Set<string>();
  private loaded = false;

  constructor(private readonly file: string) {}

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) return;
    const text = readFileSync(this.file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as InboundLogRow;
        if (typeof row.deliveryId === 'string') this.seen.add(row.deliveryId);
      } catch {
        /* skip corrupt lines */
      }
    }
  }

  has(deliveryId: string): boolean {
    return this.seen.has(deliveryId);
  }

  /** Record an accepted delivery; returns true when it was already seen. */
  record(row: InboundLogRow): boolean {
    const duplicate = this.seen.has(row.deliveryId);
    this.seen.add(row.deliveryId);
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(row)}\n`);
    return duplicate;
  }

  reset(): void {
    this.seen.clear();
    this.loaded = false;
  }
}

export interface HandleInboundDeps {
  secret: string;
  log: InboundEventLog;
  now(): number;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Authenticate and durably record one inbound decision event.
 * Never throws; returns the HTTP result the route should send.
 */
export function handleInboundDecisionEvent(
  deps: HandleInboundDeps,
  rawBody: string,
  headers: { signature: string | null; deliveryId: string | null },
): InboundResult {
  if (!deps.secret) {
    // Receiver not configured: refuse closed rather than trust unsigned events.
    return { status: 503, body: { error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'inbound webhook secret not set' } } };
  }
  if (!headers.deliveryId) {
    return { status: 400, body: { error: { code: 'MISSING_DELIVERY_ID', message: 'x-zeus-delivery-id header required' } } };
  }
  if (!verifyZeusSignature(deps.secret, rawBody, headers.signature)) {
    return { status: 401, body: { error: { code: 'INVALID_SIGNATURE', message: 'x-zeus-signature mismatch' } } };
  }

  let event: DecisionEvent;
  try {
    const parsed = JSON.parse(rawBody) as Partial<DecisionEvent>;
    if (!parsed || typeof parsed.decisionId !== 'string' || typeof parsed.type !== 'string') {
      return { status: 400, body: { error: { code: 'BAD_EVENT', message: 'event must include decisionId and type' } } };
    }
    event = parsed as DecisionEvent;
  } catch {
    return { status: 400, body: { error: { code: 'BAD_JSON', message: 'request body must be JSON' } } };
  }

  const duplicate = deps.log.record({
    deliveryId: headers.deliveryId,
    receivedAt: new Date(deps.now()).toISOString(),
    event,
    duplicate: false,
  });

  return {
    status: 200,
    body: { ok: true, accepted: true, duplicate, decisionId: event.decisionId, type: event.type },
  };
}
