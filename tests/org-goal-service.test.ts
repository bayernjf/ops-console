import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ModelHubUpstream } from '../src/server/upstream/model-hub.js';
import { createContext } from '../src/server/context.js';
import { loadOrgGoals, parseCreateGoalInput } from '../src/server/org-goal-service.js';
import type { OrgGoal, OrgGoalTemplate } from '../src/server/upstream/types.js';

/**
 * Full-network-path tests for the M5 goals read model and create boundary:
 * a node:http fake zeus serves the F5.1/F5.3 faces, the real ZeusUpstream talks
 * to it, and the service validates/forwards exactly what the console sends.
 */

const ORGS = [
  { id: 'org-1', name: '一号组织', scaleTier: 'S', createdAt: '2026-11-17T00:00:00.000Z' },
  { id: 'org-2', name: '二号组织', scaleTier: 'M', createdAt: '2026-11-17T00:00:00.000Z' },
];

const TEMPLATES: OrgGoalTemplate[] = [
  {
    id: 'weekly-report',
    title: '周报流水线',
    description: '采集 → 汇总 → 人审',
    steps: [
      { id: 'collect', title: '采集' },
      { id: 'summarize', title: '汇总', dependsOn: ['collect'] },
      { id: 'review', title: '人审', dependsOn: ['summarize'] },
    ],
  },
];

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
    templateRef: 'weekly-report',
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
];

interface FakeZeus {
  server: Server;
  baseUrl: string;
  goalQueries: Array<string | null>;
  postLog: unknown[];
  failCreate: boolean;
}

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    goalQueries: [],
    postLog: [],
    failCreate: false,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.headers.authorization !== 'Bearer test-zeus-token') {
      return json(401, { code: 'UNAUTHORIZED', message: 'unauthorized' });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/org/organizations') {
      return json(200, { organizations: ORGS });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/goal-templates') {
      return json(200, { templates: TEMPLATES });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/goals') {
      const organizationId = url.searchParams.get('organizationId');
      state.goalQueries.push(organizationId);
      return json(200, {
        goals: organizationId
          ? GOALS.filter(goal => goal.organizationId === organizationId)
          : GOALS,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/org/goals') {
      let raw = '';
      req.on('data', chunk => {
        raw += chunk;
      });
      req.on('end', () => {
        if (state.failCreate) {
          return json(400, { code: 'VALIDATION_FAILED', message: 'bad goal' });
        }
        const body = JSON.parse(raw) as Record<string, unknown>;
        state.postLog.push(body);
        return json(201, {
          format: 'zeus-org-goal',
          version: 1,
          id: 'goal-new',
          status: 'active',
          createdAt: '2026-11-19T01:00:00.000Z',
          updatedAt: '2026-11-19T01:00:00.000Z',
          ...body,
        });
      });
      return;
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

describe('org goal read model (M5 F5.1/F5.3)', () => {
  it('loads goals, templates and organizations in one snapshot', async () => {
    const state = await startFakeZeus();
    try {
      const snapshot = await loadOrgGoals(ctxFor(state), 'org-1');
      expect(snapshot.goals).toEqual(GOALS);
      expect(snapshot.templates).toEqual(TEMPLATES);
      expect(snapshot.organizations.map(org => org.id)).toEqual(['org-1', 'org-2']);
      expect(state.goalQueries).toEqual(['org-1']);
    } finally {
      await stopFake(state.server);
    }
  });

  it('omits the organization filter when none is selected', async () => {
    const state = await startFakeZeus();
    try {
      const snapshot = await loadOrgGoals(ctxFor(state));
      expect(snapshot.goals).toEqual(GOALS);
      expect(state.goalQueries).toEqual([null]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('creates a goal through zeus and returns the upstream body', async () => {
    const state = await startFakeZeus();
    try {
      const input = parseCreateGoalInput({
        organizationId: 'org-1',
        title: '每日经营日报',
        period: 'daily',
        schedule: { hourUtc: 8, minuteUtc: 0 },
        templateRef: 'weekly-report',
      });
      const goal = await ctxFor(state).zeus.createOrgGoal(input);
      expect(goal.id).toBe('goal-new');
      expect(goal.schedule).toEqual({ hourUtc: 8, minuteUtc: 0 });
      expect(state.postLog[0]).toMatchObject({
        organizationId: 'org-1',
        title: '每日经营日报',
        period: 'daily',
        schedule: { hourUtc: 8, minuteUtc: 0 },
        templateRef: 'weekly-report',
      });
    } finally {
      await stopFake(state.server);
    }
  });

  it('passes an upstream 400 through unchanged', async () => {
    const state = await startFakeZeus();
    state.failCreate = true;
    try {
      const input = parseCreateGoalInput({
        organizationId: 'org-1',
        title: 'bad goal',
      });
      await expect(ctxFor(state).zeus.createOrgGoal(input)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    } finally {
      await stopFake(state.server);
    }
  });
});

describe('create goal form validation', () => {
  it('accepts a minimal daily goal', () => {
    expect(
      parseCreateGoalInput({
        organizationId: 'org-1',
        title: '每日日报',
        period: 'daily',
        schedule: { hourUtc: 8, minuteUtc: 0 },
      }),
    ).toEqual({
      organizationId: 'org-1',
      title: '每日日报',
      period: 'daily',
      schedule: { hourUtc: 8, minuteUtc: 0 },
    });
  });

  it('requires weekdayUtc for weekly goals', () => {
    expect(() =>
      parseCreateGoalInput({
        organizationId: 'org-1',
        title: '每周周报',
        period: 'weekly',
        schedule: { hourUtc: 8, minuteUtc: 0 },
      }),
    ).toThrow('weekly goals require schedule.weekdayUtc');
  });

  it('rejects missing required fields and unknown enums', () => {
    expect(() => parseCreateGoalInput(null)).toThrow('goal body must be a JSON object');
    expect(() => parseCreateGoalInput({ title: '无组织' })).toThrow('organizationId is required');
    expect(() => parseCreateGoalInput({ organizationId: 'org-1' })).toThrow('title is required');
    expect(() =>
      parseCreateGoalInput({ organizationId: 'org-1', title: 'x', period: 'hourly' }),
    ).toThrow('period must be one of');
  });

  it('rejects out-of-range schedule fields', () => {
    expect(() =>
      parseCreateGoalInput({
        organizationId: 'org-1',
        title: 'x',
        schedule: { hourUtc: 24, minuteUtc: 0 },
      }),
    ).toThrow('schedule.hourUtc must be an integer between 0 and 23');
    expect(() =>
      parseCreateGoalInput({
        organizationId: 'org-1',
        title: 'x',
        period: 'weekly',
        schedule: { hourUtc: 8, minuteUtc: 0, weekdayUtc: 7 },
      }),
    ).toThrow('schedule.weekdayUtc must be an integer between 0 and 6');
  });

  it('rejects templateRef and taskTemplate together', () => {
    expect(() =>
      parseCreateGoalInput({
        organizationId: 'org-1',
        title: 'x',
        templateRef: 'weekly-report',
        taskTemplate: { title: '单任务' },
      }),
    ).toThrow('templateRef and taskTemplate are mutually exclusive');
  });
});
