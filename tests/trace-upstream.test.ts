import { describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { createContext } from '../src/server/context.js';
import { listTraces } from '../src/server/traces-service.js';
import { canViewTraces } from '../src/server/rbac.js';
import type { TraceQueryResult } from '../src/server/upstream/types.js';

/**
 * TracePort v1 §5 (Tier0 M2 W2-5): the trace query face is a pure pass-through
 * to zeus GET /api/v1/traces. Filters forward verbatim (zeus owns validation),
 * responses pass through field-for-field, and every upstream failure is
 * fail-closed (503 transport / verbatim 4xx) — never a fabricated result.
 */

const FIXTURE: TraceQueryResult = {
  traces: [
    {
      traceId: 'run-1',
      root: {
        traceId: 'run-1',
        spanId: 'run-1',
        kind: 'intent',
        startedAt: '2026-10-31T00:00:00.000Z',
        events: [],
      },
      spans: [
        {
          traceId: 'run-1',
          spanId: 'br-1',
          parentSpanId: 'run-1',
          kind: 'branch',
          vassal: 'atlas',
          startedAt: '2026-10-31T00:00:00.100Z',
          endedAt: '2026-10-31T00:00:02.000Z',
          events: [],
        },
      ],
    },
  ],
  summary: { totalLatencyMs: 1500, totalCostMicros: 13345, errorCount: 1, count: 1 },
};

interface FakeZeus {
  baseUrl: string;
  lastUrl: () => string | null;
  lastAuth: () => string | null;
  close: () => Promise<void>;
}

async function startFakeZeus(
  respond: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<FakeZeus> {
  let url: string | null = null;
  let auth: string | null = null;
  const server: Server = createServer((req, res) => {
    url = req.url ?? null;
    auth = req.headers.authorization ?? null;
    respond(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    lastUrl: () => url,
    lastAuth: () => auth,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function ok(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(FIXTURE));
}

describe('ZeusUpstream.getTraces', () => {
  it('forwards non-empty filters verbatim and keeps the bearer header', async () => {
    const fake = await startFakeZeus((_req, res) => ok(res));
    try {
      const zeus = new ZeusUpstream(fake.baseUrl, 'test-zeus-token');
      const result = await zeus.getTraces({
        agent: 'atlas',
        from: '2026-10-31T00:00:00.000Z',
        to: '2026-10-31T01:00:00.000Z',
        minCostMicros: '1000',
        maxCostMicros: '5000',
        traceId: 'run-1',
        limit: '25',
      });
      expect(result).toEqual(FIXTURE);
      expect(fake.lastAuth()).toBe('Bearer test-zeus-token');
      const query = new URL(`http://localhost${fake.lastUrl() ?? ''}`).searchParams;
      expect(query.get('agent')).toBe('atlas');
      expect(query.get('from')).toBe('2026-10-31T00:00:00.000Z');
      expect(query.get('to')).toBe('2026-10-31T01:00:00.000Z');
      expect(query.get('min_cost_micros')).toBe('1000');
      expect(query.get('max_cost_micros')).toBe('5000');
      expect(query.get('trace_id')).toBe('run-1');
      expect(query.get('limit')).toBe('25');
    } finally {
      await fake.close();
    }
  });

  it('omits unset filters entirely instead of sending empty params', async () => {
    const fake = await startFakeZeus((_req, res) => ok(res));
    try {
      const zeus = new ZeusUpstream(fake.baseUrl, 'test-zeus-token');
      await zeus.getTraces();
      expect(fake.lastUrl()).toBe('/api/v1/traces');
      // Pass-through semantics: the upstream client does not trim; the BFF
      // service layer owns blank-to-undefined (covered in the service test).
      await zeus.getTraces({ agent: '' });
      expect(fake.lastUrl()).toBe('/api/v1/traces');
    } finally {
      await fake.close();
    }
  });

  it('fails closed on transport failure: 503 UPSTREAM_UNAVAILABLE', async () => {
    // Nothing listens on port 1 — fetch fails, so the client must surface the
    // fail-closed envelope instead of fabricating an empty result.
    const zeus = new ZeusUpstream('http://127.0.0.1:1', 'test-zeus-token');
    await expect(zeus.getTraces({ agent: 'atlas' })).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('passes a zeus 400 invalid_request through with status and body', async () => {
    const fake = await startFakeZeus((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'from must be an ISO timestamp' } }));
    });
    try {
      const zeus = new ZeusUpstream(fake.baseUrl, 'test-zeus-token');
      await expect(zeus.getTraces({ from: 'not-a-date' })).rejects.toMatchObject({
        status: 400,
        code: 'invalid_request',
      });
    } finally {
      await fake.close();
    }
  });
});

describe('listTraces service (BFF pass-through)', () => {
  it('trims filters and forwards the response field-for-field', async () => {
    const fake = await startFakeZeus((_req, res) => ok(res));
    try {
      const ctx = createContext({
        zeus: new ZeusUpstream(fake.baseUrl, 'test-zeus-token'),
        commerce: new CommerceUpstream('http://127.0.0.1:1', 'x'),
      });
      const result = await listTraces(ctx, { agent: '  atlas  ', limit: ' 25 ' });
      expect(result).toEqual(FIXTURE);
      const query = new URL(`http://localhost${fake.lastUrl() ?? ''}`).searchParams;
      expect(query.get('agent')).toBe('atlas');
      expect(query.get('limit')).toBe('25');
    } finally {
      await fake.close();
    }
  });
});

describe('trace RBAC (owner-only)', () => {
  it('allows owner and rejects operator', () => {
    expect(canViewTraces('owner')).toBe(true);
    expect(canViewTraces('operator')).toBe(false);
  });
});
