import { describe, expect, it, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { createContext } from '../src/server/context.js';
import { loadOrgSnapshot, sortOrgQueue, countByStatus } from '../src/server/org-service.js';
import { canViewOrg } from '../src/server/rbac.js';
import { UpstreamError } from '../src/server/upstream/http.js';
import type { OrgTask } from '../src/server/upstream/types.js';

/**
 * Full-network-path tests: a node:http fake zeus serves the org v1 read face,
 * the real ZeusUpstream talks to it, and the org read model is exercised on the
 * resulting ServerContext. No function mocking.
 */

const ORGS = [
  { id: 'org-1', name: '一号组织', scaleTier: 'S', concurrencyLimit: 3, createdAt: '2026-11-17T00:00:00.000Z' },
  { id: 'org-2', name: '二号组织', scaleTier: 'M', createdAt: '2026-11-17T00:00:00.000Z' },
];
const DEPTS = [
  { id: 'dept-1', organizationId: 'org-1', name: '工程部', mission: '交付', createdAt: '2026-11-17T00:00:00.000Z' },
];
const POSITIONS = [
  {
    id: 'pos-1',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    name: '执行工程师',
    responsibilities: ['执行任务'],
    requiredSkills: ['coding'],
    allowedTools: ['git'],
    decisionScope: 'D2',
    agentId: 'agent-1',
    createdAt: '2026-11-17T00:00:00.000Z',
  },
];

function task(overrides: Partial<OrgTask> & Pick<OrgTask, 'id' | 'status' | 'createdAt'>): OrgTask {
  return {
    organizationId: 'org-1',
    title: `任务 ${overrides.id}`,
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

const TASKS: OrgTask[] = [
  task({ id: 't-done', status: 'done', createdAt: '2026-11-17T01:00:00.000Z' }),
  task({ id: 't-pending', status: 'pending', createdAt: '2026-11-17T02:00:00.000Z' }),
  task({ id: 't-blocked', status: 'awaiting_decision', createdAt: '2026-11-17T00:30:00.000Z', positionId: 'pos-1' }),
  task({ id: 't-running', status: 'running', createdAt: '2026-11-17T03:00:00.000Z', positionId: 'pos-1', attempts: 1 }),
];

interface FakeZeus {
  server: Server;
  baseUrl: string;
  queryLog: Array<{ path: string; organizationId: string | null }>;
  fail: boolean;
}

let fake: FakeZeus | null = null;

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    queryLog: [],
    fail: false,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer test-zeus-token') return json(401, { error: 'unauthorized' });
    if (state.fail) return json(503, { error: 'down' });

    state.queryLog.push({ path: url.pathname, organizationId: url.searchParams.get('organizationId') });
    if (req.method !== 'GET') return json(405, { error: 'method' });

    switch (url.pathname) {
      case '/api/v1/org/organizations':
        return json(200, { organizations: ORGS });
      case '/api/v1/org/departments':
        return json(200, { departments: DEPTS.filter(d => d.organizationId === url.searchParams.get('organizationId')) });
      case '/api/v1/org/positions':
        return json(200, { positions: POSITIONS.filter(p => p.organizationId === url.searchParams.get('organizationId')) });
      case '/api/v1/org/tasks':
        return json(200, { tasks: TASKS.filter(t => t.organizationId === url.searchParams.get('organizationId')) });
      default:
        return json(404, { code: 'NOT_FOUND', message: url.pathname });
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.server = server;
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake = state;
  return state;
}

function ctxFor(state: FakeZeus) {
  return createContext({
    zeus: new ZeusUpstream(state.baseUrl, 'test-zeus-token'),
    commerce: new CommerceUpstream('http://127.0.0.1:1', 'unused'),
  });
}

afterAll(async () => {
  if (fake?.server) await new Promise<void>(resolve => fake!.server.close(() => resolve()));
});

describe('org read model (M2 F2.1/F2.2)', () => {
  it('projects organizations, departments, positions and tasks in one snapshot', async () => {
    const state = await startFakeZeus();
    const snapshot = await loadOrgSnapshot(ctxFor(state));
    expect(snapshot.organizations.map(o => o.id)).toEqual(['org-1', 'org-2']);
    expect(snapshot.departments.map(d => d.id)).toEqual(['dept-1']);
    expect(snapshot.positions.map(p => p.id)).toEqual(['pos-1']);
    expect(snapshot.tasks.map(t => t.id).sort()).toEqual(['t-blocked', 't-done', 't-pending', 't-running']);
    // Defaults to the first organization; every child call carries it.
    expect(state.queryLog.filter(q => q.path !== '/api/v1/org/organizations').every(q => q.organizationId === 'org-1')).toBe(true);
  });

  it('honours an explicit organization filter', async () => {
    const state = await startFakeZeus();
    const snapshot = await loadOrgSnapshot(ctxFor(state), 'org-2');
    expect(snapshot.departments).toEqual([]);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(state.queryLog.filter(q => q.path !== '/api/v1/org/organizations').every(q => q.organizationId === 'org-2')).toBe(true);
  });

  it('returns an empty projection when no organization exists', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ organizations: [] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const ctx = createContext({
        zeus: new ZeusUpstream(baseUrl, 'test-zeus-token'),
        commerce: new CommerceUpstream('http://127.0.0.1:1', 'unused'),
      });
      expect(await loadOrgSnapshot(ctx)).toEqual({ organizations: [], departments: [], positions: [], tasks: [] });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('fails closed when the upstream is unreachable', async () => {
    const state = await startFakeZeus();
    state.fail = true;
    await expect(loadOrgSnapshot(ctxFor(state))).rejects.toBeInstanceOf(UpstreamError);
  });

  it('orders the queue blocked-first then by recency within bands', () => {
    const ordered = sortOrgQueue(TASKS).map(t => t.id);
    expect(ordered).toEqual(['t-blocked', 't-running', 't-pending', 't-done']);
  });

  it('counts by status', () => {
    expect(countByStatus(TASKS)).toEqual({ done: 1, pending: 1, awaiting_decision: 1, running: 1 });
  });

  it('grants the org view to both operating roles only', () => {
    expect(canViewOrg('owner')).toBe(true);
    expect(canViewOrg('operator')).toBe(true);
  });
});
