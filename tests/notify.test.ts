/**
 * Notification engine tests (T-M8-05).
 *
 * Self-contained: real node:http fake zeus + fake webhook receiver, real
 * fetch, injected clock and injected sleep so no real waiting is required.
 * Coverage:
 *  a. D2 pending -> one pending card
 *  b. repeated polls -> idempotent (single delivery per decisionId+event)
 *  c. process restart: store reloaded from JSONL, no redelivery
 *  d. timeoutAt passed -> timeout card; escalationMinutes later -> escalation
 *  e. channel 500 / unreachable -> retries then channel_failure record
 *  f. deepLink shape = publicBase + /app/approvals/:id
 *  g. D1 decisions are never notified
 *  h. overlapping ticks while a delivery is in flight (channel down, long
 *     backoff) must not duplicate deliveries or channel_failure rows
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import type { DecisionRecord } from '../src/server/upstream/types.js';
import { NotifyStore } from '../src/server/notify/store.js';
import { createPoller } from '../src/server/notify/poller.js';
import { deliverWebhook } from '../src/server/notify/webhook.js';
import type { DeliveryOutcome, WebhookPayload } from '../src/server/notify/types.js';

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------
function fixture(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    id: 'dec_probe',
    intent: 'refund',
    domain: 'commerce.refund',
    amount: { value: 1299, currency: 'CNY' },
    impact: 'team',
    reversibility: 'reversible',
    grade: 'D2',
    mode: 'approve-sync',
    status: 'blocked',
    ruleId: 'd2-amount',
    gradeReason: 'probe',
    policyVersion: 1,
    createdAt: '2026-10-24T08:00:00.000Z',
    updatedAt: '2026-10-24T08:00:00.000Z',
    auditSeq: 0,
    approvals: [],
    ...overrides,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('expected ephemeral port');
  return `http://127.0.0.1:${addr.port}`;
}

function makeFakeZeus(decisions: DecisionRecord[]): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ztoken') {
      res.writeHead(401); res.end(); return;
    }
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname === '/api/v1/decisions') {
      const status = url.searchParams.get('status');
      const list = decisions.filter((d) => !status || d.status === status);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ decisions: list }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return listen(server).then((url) => ({ server, url }));
}

interface Receiver {
  server: Server;
  url: string;
  received: WebhookPayload[];
}

function makeReceiver(opts: { alwaysStatus?: number } = {}): Promise<Receiver> {
  const received: WebhookPayload[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      if (opts.alwaysStatus) {
        res.writeHead(opts.alwaysStatus); res.end('{}'); return;
      }
      try {
        received.push(JSON.parse(body) as WebhookPayload);
      } catch {
        /* ignore */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return listen(server).then((url) => ({ server, url, received }));
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
const PUBLIC = 'http://console.local';
let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ops-notify-test-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('notify poller', () => {
  it('a. D2 pending decision triggers exactly one pending card with correct deepLink', async () => {
    const d = fixture({ id: 'dec_card_d2' });
    const zeus = await makeFakeZeus([d]);
    const receiver = await makeReceiver();
    try {
      const store = new NotifyStore(join(workDir, 'a.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: receiver.url,
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 10_000,
        now: () => Date.parse('2026-10-24T08:00:00Z'),
        deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
      });
      await poller.tick();
      expect(receiver.received).toHaveLength(1);
      expect(receiver.received[0]!.event).toBe('pending');
      expect(receiver.received[0]!.decisionId).toBe('dec_card_d2');
      // f. deepLink shape
      expect(receiver.received[0]!.deepLink).toBe(`${PUBLIC}/app/approvals/dec_card_d2`);
      expect(receiver.received[0]!.message).toContain('D2');
      expect(receiver.received[0]!.message).toContain('1299 CNY');
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('b. repeated polls do not re-deliver the same decisionId+event', async () => {
    const d = fixture({ id: 'dec_idem' });
    const zeus = await makeFakeZeus([d]);
    const receiver = await makeReceiver();
    try {
      const store = new NotifyStore(join(workDir, 'b.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: receiver.url,
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 10_000,
        now: () => Date.parse('2026-10-24T08:00:00Z'),
        deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
      });
      for (let i = 0; i < 5; i++) await poller.tick();
      expect(receiver.received).toHaveLength(1);
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('c. store reloaded from disk after restart does not redeliver', async () => {
    const d = fixture({ id: 'dec_restart' });
    const zeus = await makeFakeZeus([d]);
    const receiver = await makeReceiver();
    const file = join(workDir, 'c.jsonl');
    try {
      // first process: deliver once and exit (file flushed by upsert).
      {
        const store = new NotifyStore(file);
        store.load();
        const poller = createPoller({
          zeus: new ZeusUpstream(zeus.url, 'ztoken'),
          store,
          webhookUrl: receiver.url,
          publicBaseUrl: PUBLIC,
          escalationMinutes: 15,
          pollMs: 10_000,
          now: () => Date.parse('2026-10-24T08:00:00Z'),
          deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
        });
        await poller.tick();
        expect(receiver.received).toHaveLength(1);
      }
      // "restart": brand-new store + poller over the same file.
      {
        const store2 = new NotifyStore(file);
        store2.load();
        expect(store2.seen('dec_restart', 'pending')).toBe(true);
        const poller2 = createPoller({
          zeus: new ZeusUpstream(zeus.url, 'ztoken'),
          store: store2,
          webhookUrl: receiver.url,
          publicBaseUrl: PUBLIC,
          escalationMinutes: 15,
          pollMs: 10_000,
          now: () => Date.parse('2026-10-24T08:00:00Z'),
          deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
        });
        await poller2.tick();
        await poller2.tick();
        expect(receiver.received).toHaveLength(1); // still exactly one
      }
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('d. timeoutAt passed fires timeout, then escalationMinutes later fires escalation', async () => {
    const d = fixture({
      id: 'dec_sla',
      timeoutAt: '2026-10-24T08:10:00.000Z',
    });
    const zeus = await makeFakeZeus([d]);
    const receiver = await makeReceiver();
    let nowMs = Date.parse('2026-10-24T08:00:00Z');
    try {
      const store = new NotifyStore(join(workDir, 'd.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: receiver.url,
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 10_000,
        now: () => nowMs,
        deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
      });
      await poller.tick();
      expect(receiver.received.map((r) => r.event)).toEqual(['pending']);

      nowMs = Date.parse('2026-10-24T08:11:00Z'); // past timeoutAt, not yet escalation
      await poller.tick();
      expect(receiver.received.map((r) => r.event)).toEqual(['pending', 'timeout']);

      nowMs = Date.parse('2026-10-24T08:26:00Z'); // 16 min after timeoutAt
      await poller.tick();
      expect(receiver.received.map((r) => r.event)).toEqual(['pending', 'timeout', 'escalation']);

      nowMs = Date.parse('2026-10-24T09:00:00Z');
      await poller.tick();
      expect(receiver.received).toHaveLength(3); // no duplicates
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('e. channel failures exhaust retries and leave a channel_failure record', async () => {
    const d = fixture({ id: 'dec_down' });
    const zeus = await makeFakeZeus([d]);
    const receiver = await makeReceiver({ alwaysStatus: 500 });
    try {
      const store = new NotifyStore(join(workDir, 'e.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: receiver.url,
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 10_000,
        now: () => Date.parse('2026-10-24T08:00:00Z'),
        deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1, 1, 1], sleep: async () => {} }),
      });
      await poller.tick();

      const records = store.list();
      const pending = records.find((r) => r.event === 'pending');
      const failure = records.find((r) => r.event === 'channel_failure');
      expect(pending?.status).toBe('failed');
      expect(pending?.attempts).toBeGreaterThanOrEqual(3);
      expect(pending?.httpStatus).toBe(500);
      expect(failure).toBeDefined();
      expect(failure?.status).toBe('failed'); // channel was still down
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('g. D1 awaiting_approval decisions are never notified', async () => {
    const d1 = fixture({ id: 'dec_d1', grade: 'D1', mode: 'approve-async', status: 'awaiting_approval' });
    const zeus = await makeFakeZeus([d1]);
    const receiver = await makeReceiver();
    try {
      const store = new NotifyStore(join(workDir, 'g.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: receiver.url,
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 10_000,
        now: () => Date.parse('2026-10-24T08:00:00Z'),
        deliver: (p) => deliverWebhook(receiver.url, p, { backoffMs: [1], sleep: async () => {} }),
      });
      await poller.tick();
      await poller.tick();
      expect(receiver.received).toHaveLength(0);
      expect(store.list()).toHaveLength(0);
    } finally {
      zeus.server.close(); receiver.server.close();
    }
  });

  it('h. overlapping ticks while a delivery is in flight do not duplicate deliveries or channel_failure', async () => {
    const d = fixture({ id: 'dec_overlap' });
    const zeus = await makeFakeZeus([d]);
    let release: (outcome: DeliveryOutcome) => void = () => {};
    const inFlight = new Promise<DeliveryOutcome>((resolve) => {
      release = resolve;
    });
    let deliverCalls = 0;
    try {
      const store = new NotifyStore(join(workDir, 'h.jsonl'));
      store.load();
      const poller = createPoller({
        zeus: new ZeusUpstream(zeus.url, 'ztoken'),
        store,
        webhookUrl: 'http://unused',
        publicBaseUrl: PUBLIC,
        escalationMinutes: 15,
        pollMs: 100,
        now: () => Date.parse('2026-10-24T08:00:00Z'),
        // Never resolve until we say so — simulates a channel down for the
        // whole backoff window (~65s in production).
        deliver: async () => {
          deliverCalls += 1;
          return inFlight;
        },
      });

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // First tick starts, resolves the fake-zeus list, and enters the
      // never-resolving pending delivery.
      const firstTick = poller.tick();
      await sleep(50); // let listPending's HTTP round-trip finish
      expect(deliverCalls).toBe(1); // the pending deliver is now in flight

      // Flood with overlapping ticks while the delivery is still in flight.
      await Promise.all([poller.tick(), poller.tick(), poller.tick(), poller.tick()]);

      // Guard must have skipped the overlaps: still exactly the one in-flight deliver.
      expect(deliverCalls).toBe(1);

      // Resolve the in-flight delivery as failed -> emit records the failed
      // pending row and then performs the single channel_failure delivery.
      release({ ok: false, attempts: 3, error: 'channel down' });
      await firstTick;

      // A later tick must not produce anything new.
      await poller.tick();

      const pendings = store.list().filter((r) => r.event === 'pending');
      const failures = store.list().filter((r) => r.event === 'channel_failure');
      expect(pendings).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.status).toBe('failed');
      expect(deliverCalls).toBe(2); // pending attempt + channel_failure attempt, nothing more
    } finally {
      release({ ok: false, attempts: 1 });
      zeus.server.close();
    }
  });
});
