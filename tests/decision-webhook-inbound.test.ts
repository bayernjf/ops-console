/**
 * Inbound zeus decision-webhook receiver tests.
 *
 * Real node:http server + real fetch (no function mocking): a tiny shim
 * mirrors the Astro route by reading the raw request body and handing it to
 * handleInboundDecisionEvent. Coverage:
 *  - valid HMAC signature  -> 200 accepted, event logged
 *  - wrong secret / tampered body -> 401
 *  - missing delivery-id    -> 400
 *  - replay same delivery-id -> 200 duplicate, not double-logged
 *  - "restart" reload from JSONL still treats the delivery-id as seen
 *  - secret unconfigured    -> fail closed (503)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleInboundDecisionEvent,
  InboundEventLog,
  signZeusBody,
} from '../src/server/notify/inbound.js';

const SECRET = 'local-decision-webhook-secret-change-me';

async function start(log: InboundEventLog, secret: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const result = handleInboundDecisionEvent(
        { secret, log, now: () => Date.parse('2026-10-26T12:00:00Z') },
        rawBody,
        {
          signature: req.headers['x-zeus-signature'] ? String(req.headers['x-zeus-signature']) : null,
          deliveryId: req.headers['x-zeus-delivery-id'] ? String(req.headers['x-zeus-delivery-id']) : null,
        },
      );
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('no port');
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

const event = {
  type: 'late',
  decisionId: 'dec_late_1',
  at: '2026-10-26T11:00:00.000Z',
  domain: 'commerce.refund',
  intent: 'refund',
  grade: 'D2',
  mode: 'approve-sync',
  status: 'blocked',
  ruleId: 'd2-amount',
  timeoutAt: '2026-10-26T11:00:00.000Z',
  lateAt: '2026-10-26T11:00:00.000Z',
};

let workDir = '';
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ops-inbound-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('inbound decision webhook', () => {
  it('valid signature accepted, tampered body rejected with 401, replay idempotent', async () => {
    const file = join(workDir, 'in.jsonl');
    const log = new InboundEventLog(file);
    log.load();
    const { server, url } = await start(log, SECRET);
    try {
      const raw = JSON.stringify(event);
      const deliveryId = `${event.decisionId}:${event.type}:${event.at}`;
      const sig = signZeusBody(SECRET, raw);

      // 1. valid -> 200 accepted
      const okRes = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zeus-signature': sig, 'x-zeus-delivery-id': deliveryId },
        body: raw,
      });
      expect(okRes.status).toBe(200);
      const okBody = (await okRes.json()) as { accepted: boolean; duplicate: boolean };
      expect(okBody.accepted).toBe(true);
      expect(okBody.duplicate).toBe(false);

      // 2. tampered body (signature no longer matches the bytes) -> 401
      const tampered = JSON.stringify({ ...event, grade: 'D3' });
      const badRes = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zeus-signature': sig, 'x-zeus-delivery-id': deliveryId },
        body: tampered,
      });
      expect(badRes.status).toBe(401);

      // 3. replay same delivery-id (correct signature) -> 200 duplicate, no double log
      const replayRes = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zeus-signature': sig, 'x-zeus-delivery-id': deliveryId },
        body: raw,
      });
      expect(replayRes.status).toBe(200);
      const replayBody = (await replayRes.json()) as { duplicate: boolean };
      expect(replayBody.duplicate).toBe(true);
    } finally {
      server.close();
    }

    // "restart": fresh log over the same JSONL must still know the delivery-id.
    const log2 = new InboundEventLog(file);
    log2.load();
    expect(log2.has(`${event.decisionId}:${event.type}:${event.at}`)).toBe(true);
  });

  it('missing delivery-id -> 400; wrong-secret signature -> 401; unconfigured secret -> 503', async () => {
    const file = join(workDir, 'b.jsonl');
    const log = new InboundEventLog(file);
    log.load();
    const { server, url } = await start(log, SECRET);
    try {
      const raw = JSON.stringify(event);
      const sig = signZeusBody(SECRET, raw);

      const noId = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zeus-signature': sig },
        body: raw,
      });
      expect(noId.status).toBe(400);

      const wrongSig = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zeus-signature': signZeusBody('wrong-secret', raw),
          'x-zeus-delivery-id': 'dec_late_1:late:2026-10-26T11:00:00.000Z',
        },
        body: raw,
      });
      expect(wrongSig.status).toBe(401);
    } finally {
      server.close();
    }

    // Unconfigured secret -> fail closed.
    const log3 = new InboundEventLog(join(workDir, 'c.jsonl'));
    log3.load();
    const { server: s2, url: u2 } = await start(log3, '');
    try {
      const raw = JSON.stringify(event);
      const res = await fetch(u2, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zeus-signature': signZeusBody('x', raw), 'x-zeus-delivery-id': 'a:b:c' },
        body: raw,
      });
      expect(res.status).toBe(503);
    } finally {
      s2.close();
    }
  });
});
