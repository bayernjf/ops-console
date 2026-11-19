import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ModelHubUpstream } from '../src/server/upstream/model-hub.js';
import { createContext } from '../src/server/context.js';
import { parseUpdateGoalStatusInput } from '../src/server/org-goal-service.js';
import type { OrgGoal } from '../src/server/upstream/types.js';

/**
 * Full-network-path tests for the M5 status-only goal transition:
 * a node:http fake zeus accepts PATCH /api/v1/org/goals/:id and the real
 * ZeusUpstream forwards exactly `{ status }`, never other goal fields.
 */

const GOALS: OrgGoal[] = [
  {
    format: 'zeus-org-goal',
    version: 1,
    id: 'goal-1',
    organizationId: 'org-1',
    title: '每日经营日报',
    period: 'daily',
    status: 'active',
    schedule: { hourUtc: 8, minuteUtc: 0 },
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
];

interface FakeZeus {
  server: Server;
  baseUrl: string;
  patchLog: Array<{ id: string; body: Record<string, unknown> }>;
  failPatch: boolean;
}

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    patchLog: [],
    failPatch: false,
  };

  const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
    new Promise(resolve => {
      let raw = '';
      req.on('data', chunk => {
        raw += chunk;
      });
      req.on('end', () => resolve(raw));
    });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.headers.authorization !== 'Bearer test-zeus-token') {
      return json(401, { code: 'UNAUTHORIZED', message: 'unauthorized' });
    }

    const patch = url.pathname.match(/^\/api\/v1\/org\/goals\/([^/]+)$/);
    if (req.method === 'PATCH' && patch) {
      const id = decodeURIComponent(patch[1] ?? '');
      return readBody(req).then(raw => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        state.patchLog.push({ id, body });
        if (state.failPatch) {
          return json(404, { code: 'GOAL_NOT_FOUND', message: `goal not found: ${id}` });
        }
        const goal = GOALS.find(item => item.id === id);
        if (!goal) return json(404, { code: 'GOAL_NOT_FOUND', message: `goal not found: ${id}` });
        return json(200, { ...goal, status: body.status, updatedAt: '2026-11-19T04:00:00.000Z' });
      });
    }

    return json(404, { code: 'NOT_FOUND', message: url.pathname });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.server = server;
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

async function stopFake(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

function ctxFor(state: FakeZeus) {
  return createContext({
    zeus: new ZeusUpstream(state.baseUrl, 'test-zeus-token'),
    commerce: new CommerceUpstream('http://127.0.0.1:1', 'unused'),
    modelHub: new ModelHubUpstream('http://127.0.0.1:1', 'owner', ''),
  });
}

describe('goal status transition (M5)', () => {
  it('forwards a status-only PATCH and returns the upstream goal', async () => {
    const state = await startFakeZeus();
    try {
      const goal = await ctxFor(state).zeus.updateOrgGoalStatus('goal-1', 'paused');
      expect(goal.status).toBe('paused');
      expect(state.patchLog).toEqual([{ id: 'goal-1', body: { status: 'paused' } }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('supports resume and archive as the same status-only patch', async () => {
    const state = await startFakeZeus();
    try {
      const resumed = await ctxFor(state).zeus.updateOrgGoalStatus('goal-1', 'active');
      expect(resumed.status).toBe('active');
      const archived = await ctxFor(state).zeus.updateOrgGoalStatus('goal-1', 'archived');
      expect(archived.status).toBe('archived');
      expect(state.patchLog.map(entry => entry.body)).toEqual([
        { status: 'active' },
        { status: 'archived' },
      ]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('passes an upstream 404 through unchanged', async () => {
    const state = await startFakeZeus();
    state.failPatch = true;
    try {
      await expect(
        ctxFor(state).zeus.updateOrgGoalStatus('missing', 'active'),
      ).rejects.toMatchObject({ status: 404, code: 'GOAL_NOT_FOUND' });
    } finally {
      await stopFake(state.server);
    }
  });
});

describe('goal status body validation', () => {
  it('accepts the three console statuses', () => {
    expect(parseUpdateGoalStatusInput({ status: 'active' })).toEqual({ status: 'active' });
    expect(parseUpdateGoalStatusInput({ status: 'paused' })).toEqual({ status: 'paused' });
    expect(parseUpdateGoalStatusInput({ status: 'archived' })).toEqual({ status: 'archived' });
  });

  it('rejects done because it is task-owned, not a console transition', () => {
    expect(() => parseUpdateGoalStatusInput({ status: 'done' })).toThrow(
      'status must be one of active, paused, archived',
    );
  });

  it('rejects missing/non-object bodies and non-string status', () => {
    expect(() => parseUpdateGoalStatusInput(null)).toThrow(
      'goal status body must be a JSON object',
    );
    expect(() => parseUpdateGoalStatusInput([])).toThrow(
      'goal status body must be a JSON object',
    );
    expect(() => parseUpdateGoalStatusInput({})).toThrow(
      'status must be one of active, paused, archived',
    );
    expect(() => parseUpdateGoalStatusInput({ status: 1 })).toThrow(
      'status must be one of active, paused, archived',
    );
  });

  it('rejects any field other than status', () => {
    expect(() =>
      parseUpdateGoalStatusInput({ status: 'paused', title: '改写标题' }),
    ).toThrow('only status can be updated from the console (got title)');
  });
});
