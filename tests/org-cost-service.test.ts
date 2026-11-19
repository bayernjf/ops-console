import { describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ModelHubUpstream } from '../src/server/upstream/model-hub.js';
import { createContext } from '../src/server/context.js';
import {
  loadOrgCosts,
  parseOrgCostDimension,
} from '../src/server/org-cost-service.js';
import { UpstreamError } from '../src/server/upstream/http.js';

/**
 * Full-network-path tests: a node:http fake model-hub serves the admin login
 * and /api/admin/costs/org faces; the real ModelHubUpstream signs in and the
 * org cost read model is exercised on the resulting ServerContext. No
 * function mocking.
 */

const ROWS = [
  { key: 'task-1', calls: 2, input_tokens: 3000, output_tokens: 1300, cost_micros: 4200 },
  { key: 'task-2', calls: 1, input_tokens: 500, output_tokens: 250, cost_micros: 900 },
];
const TOTALS = {
  calls: 3,
  input_tokens: 3500,
  output_tokens: 1550,
  cost_micros: 5100,
};

interface FakeModelHub {
  server: Server;
  baseUrl: string;
  loginCount: number;
  costCalls: Array<{
    groupBy: string | null;
    from: string | null;
    to: string | null;
  }>;
  /** Number of upcoming cost GETs that answer 401 (session-expiry simulation). */
  failCosts: number;
}

async function startFakeModelHub(): Promise<FakeModelHub> {
  const state: FakeModelHub = {
    server: null as unknown as Server,
    baseUrl: '',
    loginCount: 0,
    costCalls: [],
    failCosts: 0,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/api/admin/session') {
      state.loginCount += 1;
      return json(
        200,
        { user: { username: 'owner', role: 'owner' } },
        { 'Set-Cookie': 'hub_session=fake-session; Path=/; HttpOnly' },
      );
    }

    if (req.method !== 'GET') return json(405, { error: { code: 'method_not_allowed' } });

    if (url.pathname === '/api/admin/costs/org') {
      state.costCalls.push({
        groupBy: url.searchParams.get('group_by'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      });
      if (state.failCosts > 0) {
        state.failCosts -= 1;
        return json(401, { error: { code: 'unauthorized' } });
      }
      if (!(req.headers.cookie ?? '').includes('hub_session=fake-session')) {
        return json(401, { error: { code: 'unauthorized' } });
      }
      return json(200, {
        group_by: url.searchParams.get('group_by') ?? 'task',
        window: null,
        rows: ROWS,
        totals: TOTALS,
      });
    }

    return json(404, { error: { code: 'not_found' } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.server = server;
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

async function stopFake(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

function ctxFor(state: FakeModelHub, password = 'test-password') {
  return createContext({
    zeus: new ZeusUpstream('http://127.0.0.1:1', 'unused'),
    commerce: new CommerceUpstream('http://127.0.0.1:1', 'unused'),
    modelHub: new ModelHubUpstream(state.baseUrl, 'owner', password),
  });
}

describe('org cost read model (M3 F3.3)', () => {
  it('loads the task axis and renders upstream rows and totals verbatim', async () => {
    const state = await startFakeModelHub();
    try {
      const costs = await loadOrgCosts(ctxFor(state), 'task');
      expect(costs.group_by).toBe('task');
      expect(costs.rows).toEqual(ROWS);
      expect(costs.totals).toEqual(TOTALS);
      expect(state.costCalls[0]?.groupBy).toBe('task');
      expect(state.loginCount).toBe(1);
    } finally {
      await stopFake(state.server);
    }
  });

  it('caches the admin session across calls', async () => {
    const state = await startFakeModelHub();
    try {
      const ctx = ctxFor(state);
      await loadOrgCosts(ctx, 'task');
      await loadOrgCosts(ctx, 'department');
      expect(state.loginCount).toBe(1);
      expect(state.costCalls.map(c => c.groupBy)).toEqual(['task', 'department']);
    } finally {
      await stopFake(state.server);
    }
  });

  it('re-logins once after a 401 and then succeeds', async () => {
    const state = await startFakeModelHub();
    state.failCosts = 1;
    try {
      const costs = await loadOrgCosts(ctxFor(state), 'task');
      expect(costs.rows).toEqual(ROWS);
      expect(state.loginCount).toBe(2);
    } finally {
      await stopFake(state.server);
    }
  });

  it('passes the inclusive date window through to model-hub', async () => {
    const state = await startFakeModelHub();
    try {
      await loadOrgCosts(ctxFor(state), 'department', {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(state.costCalls[0]).toMatchObject({
        groupBy: 'department',
        from: '2026-10-01',
        to: '2026-10-31',
      });
    } finally {
      await stopFake(state.server);
    }
  });

  it('fails closed without admin credentials', async () => {
    const state = await startFakeModelHub();
    try {
      await expect(loadOrgCosts(ctxFor(state, ''), 'task')).rejects.toMatchObject({
        code: 'MODEL_HUB_NOT_CONFIGURED',
      });
      expect(state.loginCount).toBe(0);
    } finally {
      await stopFake(state.server);
    }
  });

  it('fails closed when model-hub is unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = createContext({
        zeus: new ZeusUpstream('http://127.0.0.1:1', 'unused'),
        commerce: new CommerceUpstream('http://127.0.0.1:1', 'unused'),
        modelHub: new ModelHubUpstream('http://127.0.0.1:1', 'owner', 'test-password'),
      });
      await expect(loadOrgCosts(ctx, 'task')).rejects.toBeInstanceOf(UpstreamError);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('whitelists the three org axes', () => {
    expect(parseOrgCostDimension('task')).toBe('task');
    expect(parseOrgCostDimension('department')).toBe('department');
    expect(parseOrgCostDimension('position')).toBe('position');
    expect(parseOrgCostDimension('team')).toBe('task');
    expect(parseOrgCostDimension(null)).toBe('task');
  });
});
