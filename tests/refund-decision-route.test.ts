import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * P1 regression: POST /api/refunds/:id/decision used to coerce any
 * invalid/missing verdict into 'approve' — a mistyped 'reject' would settle a
 * real channel refund. The route must now fail closed with 400 and touch
 * nothing upstream, while approve/reject pass through verbatim.
 *
 * A node:http fake commerce stands in for the upstream (route-authz.test.ts
 * precedent); the real typed clients hit it over localhost. No function mocks.
 */

const holder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../src/server/context.js', () => ({
  getContext: () => holder.current,
  createContext: (overrides: unknown) => overrides,
}));

import { POST as postRefundDecision } from '../src/pages/api/refunds/[id]/decision.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { loadConfig } from '../src/server/config.js';
import type { SessionPayload } from '../src/server/session.js';

const DEAD_ZEUS = 'http://127.0.0.1:1';
const OPERATOR: SessionPayload = { username: 'operator', role: 'operator', exp: Date.now() + 60_000 };

let decisionCalls: Array<Record<string, unknown>> = [];

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startFakeCommerce(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '';
      if (req.method === 'GET' && path === '/api/v1/refunds/ref_1') {
        // No decisionId: the grade gate is skipped, verdict flows straight through.
        return json(res, 200, { refund: { id: 'ref_1', status: 'awaiting_approval' } });
      }
      if (req.method === 'POST' && path === '/api/v1/refunds/ref_1/decision') {
        let raw = '';
        for await (const chunk of req) raw += String(chunk);
        decisionCalls.push(JSON.parse(raw) as Record<string, unknown>);
        return json(res, 200, { refund: { id: 'ref_1', status: 'succeeded' } });
      }
      return json(res, 404, { error: { code: 'not_found', message: `no fake route ${path}` } });
    })().catch((thrown) => {
      json(res, 500, { error: { code: 'fake-commerce-crash', message: String(thrown) } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

type CtxOf<F> = F extends (ctx: infer C) => unknown ? C : never;

function routeCtx<F>(opts: { body?: unknown; session?: SessionPayload }): CtxOf<F> {
  const url = new URL('http://127.0.0.1:3022/api/refunds/ref_1/decision');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body ?? {}),
    }),
    url,
    params: { id: 'ref_1' },
    locals: { session: opts.session ?? OPERATOR },
  } as unknown as CtxOf<F>;
}

describe('POST /api/refunds/:id/decision (P1 fail-closed verdict)', () => {
  let fake: Awaited<ReturnType<typeof startFakeCommerce>> | undefined;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    decisionCalls = [];
    fake = await startFakeCommerce();
    holder.current = {
      config: loadConfig(),
      zeus: new ZeusUpstream(DEAD_ZEUS, 'test-zeus-token'),
      commerce: new CommerceUpstream(fake.baseUrl, 'test-commerce-token'),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fake?.close();
    fake = undefined;
  });

  it('invalid verdict (typo) -> 400 and zero upstream side effects', async () => {
    const res = await postRefundDecision(routeCtx<typeof postRefundDecision>({ body: { verdict: 'rejectt' } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("'approve' or 'reject'");
    expect(decisionCalls).toEqual([]);
  });

  it('missing verdict -> 400 and zero upstream side effects', async () => {
    const res = await postRefundDecision(routeCtx<typeof postRefundDecision>({ body: { comment: '忘了写 verdict' } }));
    expect(res.status).toBe(400);
    expect(decisionCalls).toEqual([]);
  });

  it('approve passes through verbatim with the session-injected approver', async () => {
    const res = await postRefundDecision(routeCtx<typeof postRefundDecision>({ body: { verdict: 'approve' } }));
    expect(res.status).toBe(200);
    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0]).toMatchObject({ verdict: 'approve', approver: 'operator' });
  });

  it('reject passes through verbatim (never coerced)', async () => {
    const res = await postRefundDecision(routeCtx<typeof postRefundDecision>({ body: { verdict: 'reject', comment: '不符合政策' } }));
    expect(res.status).toBe(200);
    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0]).toMatchObject({ verdict: 'reject', approver: 'operator' });
  });
});
