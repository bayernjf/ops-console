import { describe, expect, it, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { createContext } from '../src/server/context.js';
import { getDashboardMetrics } from '../src/server/dashboard-service.js';
import { jsonResponse, toErrorResponse } from '../src/server/endpoint-json.js';
import { ConsoleError } from '../src/server/errors.js';
import { UpstreamError } from '../src/server/upstream/http.js';

/**
 * Dashboard pass-through must be field-for-field identical to commerce
 * GET /api/v1/dashboard (no recompute, no cost fields).
 */

const METRICS = {
  currency: 'CNY',
  orders: { total: 7, paid: 5, completed: 3, grossAmount: 12998.5 },
  refunds: { total: 2, succeeded: 1, refundedAmount: 199.0 },
  content: { published: 4 },
  netAmount: 12799.5,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

let server: Server;

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

async function startFakeCommerce(): Promise<string> {
  server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-commerce-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'missing token', retryable: false } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ metrics: METRICS }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('dashboard service', () => {
  it('returns commerce metrics field-for-field (verbatim, no recompute)', async () => {
    const baseUrl = await startFakeCommerce();
    const ctx = createContext({
      zeus: new ZeusUpstream('http://127.0.0.1:1', 'x'),
      commerce: new CommerceUpstream(baseUrl, 'test-commerce-token'),
    });
    const metrics = await getDashboardMetrics(ctx);
    expect(metrics).toEqual(METRICS);
    expect(metrics.orders).toEqual(METRICS.orders);
    expect(metrics.refunds).toEqual(METRICS.refunds);
    expect(metrics.content).toEqual(METRICS.content);
    expect(metrics.netAmount).toBe(METRICS.netAmount);
    expect(metrics.generatedAt).toBe(METRICS.generatedAt);
  });
});

describe('endpoint error envelope', () => {
  it('ConsoleError -> {error:{code,message}} with its status', async () => {
    const res = toErrorResponse(new ConsoleError(403, 'FORBIDDEN', 'nope'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope' } });
  });

  it('UpstreamError with body -> verbatim upstream status and body', async () => {
    const res = toErrorResponse(new UpstreamError(404, 'DECISION_NOT_FOUND', 'missing', { code: 'DECISION_NOT_FOUND', message: 'missing' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'DECISION_NOT_FOUND', message: 'missing' });
  });

  it('UpstreamError without body (transport failure) -> 503 envelope', async () => {
    const res = toErrorResponse(new UpstreamError(503, 'UPSTREAM_UNAVAILABLE', 'down'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
  });

  it('jsonResponse helper', async () => {
    const res = jsonResponse(200, { ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
