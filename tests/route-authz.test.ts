import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Core route-handler coverage (code-review P2: src/middleware.ts and the route
 * handlers had no test references). The middleware gate itself is covered in
 * middleware.test.ts; this file exercises the handlers behind it directly:
 *
 *  - owner-only reads/writes answer 403 FORBIDDEN to an operator session
 *    (trace query, D3 approval decision, policy thresholds)
 *  - an anonymous session is rejected at the route layer too (defense in
 *    depth behind the middleware)
 *  - upstream failures fail closed through the handler: transport failure is
 *    a 503 UPSTREAM_UNAVAILABLE envelope that hides the internal base URL,
 *    upstream 4xx passes through verbatim (never re-wrapped)
 *  - the server injects the session identity: approver/actor come from the
 *    session, never from the request body
 *
 * A node:http fake zeus (trace-upstream.test.ts precedent) stands in for the
 * upstream; its response shapes mirror the zeus contracts.
 */

const holder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../src/server/context.js', () => ({
  getContext: () => holder.current,
  createContext: (overrides: unknown) => overrides,
}));

import { GET as getTraces } from '../src/pages/api/traces/index.js';
import { POST as postDecision } from '../src/pages/api/approvals/[id]/decision.js';
import { PUT as putThresholds } from '../src/pages/api/policy/thresholds.js';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { loadConfig } from '../src/server/config.js';
import type { SessionPayload } from '../src/server/session.js';
import type {
  DecisionApprovalResponse,
  DecisionPolicy,
  DecisionRecord,
} from '../src/server/upstream/types.js';

const DEAD_ZEUS = 'http://127.0.0.1:1';

const D3_RECORD: DecisionRecord = {
  id: 'dec-d3-1',
  intent: '发布新品到渠道',
  domain: 'commerce.listing',
  grade: 'D3',
  mode: 'human-led',
  status: 'blocked',
  ruleId: 'd3-irreversible',
  gradeReason: 'irreversible channel publish',
  impact: 'external: publishes to the live channel',
  reversibility: 'irreversible without channel-side unpublish',
  policyVersion: 3,
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  auditSeq: 7,
  approvals: [],
};

const D2_RECORD: DecisionRecord = {
  ...D3_RECORD,
  id: 'dec-d2-1',
  intent: '批量退款 500 元',
  grade: 'D2',
  mode: 'approve-sync',
  ruleId: 'd2-amount',
};

const APPROVAL_RESPONSE: DecisionApprovalResponse = {
  decisionId: 'dec-d2-1',
  grade: 'D2',
  mode: 'approve-sync',
  status: 'decided',
  ruleId: 'd2-amount',
  auditSeq: 8,
};

const POLICY: DecisionPolicy = {
  version: 4,
  defaultGrade: 'D2',
  rules: [{ id: 'd1-amount', match: { amount: { max: 500 } }, grade: 'D1' }],
};

interface FakeZeus {
  baseUrl: string;
  close: () => Promise<void>;
}

let approvalBody: Record<string, unknown> | null = null;
let thresholdBody: Record<string, unknown> | null = null;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
  });
}

async function startFakeZeus(): Promise<FakeZeus> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '';
      if (req.method === 'GET' && path === '/api/v1/decisions/dec-d3-1') return json(res, 200, D3_RECORD);
      if (req.method === 'GET' && path === '/api/v1/decisions/dec-d2-1') return json(res, 200, D2_RECORD);
      if (req.method === 'POST' && path === '/api/v1/decisions/dec-d2-1/approval') {
        approvalBody = await readBody(req);
        return json(res, 200, APPROVAL_RESPONSE);
      }
      if (req.method === 'GET' && path.startsWith('/api/v1/traces')) {
        // zeus owns filter validation; its 400 keeps its own body.
        return json(res, 400, {
          error: { code: 'invalid_request', message: 'from must be an ISO timestamp' },
        });
      }
      if (req.method === 'POST' && path === '/api/v1/org/policy/thresholds') {
        thresholdBody = await readBody(req);
        return json(res, 200, POLICY);
      }
      return json(res, 404, { error: { code: 'not_found', message: `no fake route ${path}` } });
    })().catch((thrown) => {
      json(res, 500, { error: { code: 'fake-zeus-crash', message: String(thrown) } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function session(role: 'owner' | 'operator', username?: string): SessionPayload {
  return { username: username ?? role, role, exp: Date.now() + 60_000 };
}

type CtxOf<F> = F extends (ctx: infer C) => unknown ? C : never;

function routeCtx<F>(
  path: string,
  opts: { method?: string; body?: unknown; session?: SessionPayload | null; params?: Record<string, string> } = {},
): CtxOf<F> {
  const url = new URL(`http://127.0.0.1:3022${path}`);
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  return {
    request: new Request(url, init),
    url,
    params: opts.params ?? {},
    locals: { session: opts.session === undefined ? session('owner') : opts.session },
  } as unknown as CtxOf<F>;
}

function setCtx(zeus: ZeusUpstream): void {
  holder.current = {
    config: loadConfig(),
    zeus,
    commerce: new CommerceUpstream(DEAD_ZEUS, 'test-commerce-token'),
  };
}

describe('route handlers: RBAC and fail-closed upstream', () => {
  let fake: FakeZeus | undefined;

  beforeEach(() => {
    // Expected upstream-failure logs are mocked so they do not pollute output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    approvalBody = null;
    thresholdBody = null;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fake?.close();
    fake = undefined;
  });

  it('GET /api/traces answers 403 FORBIDDEN to an operator (owner-only face)', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await getTraces(routeCtx<typeof getTraces>('/api/traces', { session: session('operator') }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('trace query is owner-only');
  });

  it('GET /api/traces rejects an anonymous session at the route layer too', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await getTraces(routeCtx<typeof getTraces>('/api/traces', { session: null }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/traces fails closed with 503 UPSTREAM_UNAVAILABLE when zeus is unreachable', async () => {
    setCtx(new ZeusUpstream(DEAD_ZEUS, 'test-zeus-token'));
    const res = await getTraces(routeCtx<typeof getTraces>('/api/traces?agent=atlas'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.retryable).toBe(true);
    // H2 regression: the generic message must not disclose the internal base URL.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('127.0.0.1');
    expect(body.error.message).not.toContain('fetch failed');
  });

  it('GET /api/traces passes a zeus 400 through verbatim instead of re-wrapping it', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await getTraces(routeCtx<typeof getTraces>('/api/traces?from=not-a-date'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toBe('from must be an ISO timestamp');
  });

  it('POST decision: operator is 403 FORBIDDEN on a D3 (owner-only) decision', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await postDecision(
      routeCtx<typeof postDecision>('/api/approvals/dec-d3-1/decision', {
        method: 'POST',
        body: { decision: 'approve' },
        session: session('operator'),
        params: { id: 'dec-d3-1' },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('operator is not allowed to approve D3 decisions');
  });

  it('POST decision: owner on a D2 decision settles through zeus with the session-injected approver', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await postDecision(
      routeCtx<typeof postDecision>('/api/approvals/dec-d2-1/decision', {
        method: 'POST',
        body: { decision: 'approve', comment: 'ok' },
        session: session('owner', 'alice'),
        params: { id: 'dec-d2-1' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(APPROVAL_RESPONSE);
    expect(approvalBody).toMatchObject({ decision: 'approve', approver: 'alice', comment: 'ok' });
  });

  it('POST decision rejects an invalid verdict with 400 before touching zeus', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await postDecision(
      routeCtx<typeof postDecision>('/api/approvals/dec-d2-1/decision', {
        method: 'POST',
        body: { decision: 'maybe' },
        params: { id: 'dec-d2-1' },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(approvalBody).toBeNull();
  });

  it('PUT /api/policy/thresholds answers 403 FORBIDDEN to an operator (owner-only write)', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await putThresholds(
      routeCtx<typeof putThresholds>('/api/policy/thresholds', {
        method: 'PUT',
        body: { d1MaxAmount: 100 },
        session: session('operator'),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('only owner may change policy thresholds');
    expect(thresholdBody).toBeNull();
  });

  it('PUT /api/policy/thresholds fails closed with 503 when zeus is unreachable', async () => {
    setCtx(new ZeusUpstream(DEAD_ZEUS, 'test-zeus-token'));
    const res = await putThresholds(
      routeCtx<typeof putThresholds>('/api/policy/thresholds', {
        method: 'PUT',
        body: { d1MaxAmount: 100 },
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.retryable).toBe(true);
  });

  it('PUT /api/policy/thresholds forwards the owner session username as the zeus actor', async () => {
    fake = await startFakeZeus();
    setCtx(new ZeusUpstream(fake.baseUrl, 'test-zeus-token'));
    const res = await putThresholds(
      routeCtx<typeof putThresholds>('/api/policy/thresholds', {
        method: 'PUT',
        body: { d1MaxAmount: 500, defaultGrade: 'D1' },
        session: session('owner', 'alice'),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(POLICY);
    expect(thresholdBody).toMatchObject({ d1MaxAmount: 500, defaultGrade: 'D1', actor: 'alice' });
  });
});
