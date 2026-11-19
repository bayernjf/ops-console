import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ModelHubUpstream } from '../src/server/upstream/model-hub.js';
import { createContext } from '../src/server/context.js';
import { loadOrgExperience, parsePromoteExperienceInput } from '../src/server/org-experience-service.js';
import type {
  ExperienceCandidate,
  PositionSopView,
} from '../src/server/upstream/types.js';

/**
 * Full-network-path tests for the M4 F4.2 experience read model and the
 * owner-only promote gate: a node:http fake zeus serves candidates, the SOP
 * catalog and organizations; the real ZeusUpstream talks to it.
 */

const ORGS = [
  { id: 'org-1', name: '一号组织', scaleTier: 'S', createdAt: '2026-11-17T00:00:00.000Z' },
  { id: 'org-2', name: '二号组织', scaleTier: 'M', createdAt: '2026-11-17T00:00:00.000Z' },
];

const CANDIDATES: ExperienceCandidate[] = [
  {
    format: 'zeus-experience-candidate',
    version: 1,
    id: 'cand-1',
    organizationId: 'org-1',
    taskId: 'task-1',
    skillId: 'refund-specialist',
    ruleId: 'rule-refund',
    kind: 'success-recipe',
    title: '先查订单再退款',
    detail: '退款前先核对订单状态，避免重复退款。',
    createdAt: '2026-11-19T00:00:00.000Z',
    status: 'pending',
  },
  {
    format: 'zeus-experience-candidate',
    version: 1,
    id: 'cand-2',
    organizationId: 'org-2',
    taskId: 'task-2',
    skillId: 'ops',
    ruleId: 'rule-ops',
    kind: 'failure-avoidance',
    title: '发布前检查库存',
    detail: '库存为零时不要发布。',
    createdAt: '2026-11-19T01:00:00.000Z',
    status: 'promoted',
    promotedAt: '2026-11-19T02:00:00.000Z',
  },
];

const SOPS: PositionSopView[] = [
  {
    skillId: 'refund-specialist',
    workflow: '退款处理',
    template: 'standard',
    steps: [
      {
        id: 's1',
        order: 1,
        tool: 'orders.lookup',
        requiredGrade: 'D1',
        humanCheckpoint: false,
        outputs: ['order'],
      },
    ],
    advisories: [],
  },
  {
    skillId: 'ops',
    workflow: '内容上架',
    template: 'standard',
    steps: [],
    advisories: [
      {
        id: 'adv-1',
        candidateId: 'cand-2',
        skillId: 'ops',
        summary: '发布前检查库存',
        detail: '库存为零时不要发布。',
        promotedAt: '2026-11-19T02:00:00.000Z',
      },
    ],
  },
];

interface FakeZeus {
  server: Server;
  baseUrl: string;
  experienceQueries: Array<string | null>;
  sopQueries: Array<{ organizationId: string | null; skillId: string | null }>;
  promoteLog: Array<{ id: string; body: Record<string, unknown> }>;
  failPromote: boolean;
}

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    experienceQueries: [],
    sopQueries: [],
    promoteLog: [],
    failPromote: false,
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

    if (req.method === 'GET' && url.pathname === '/api/v1/org/organizations') {
      return json(200, { organizations: ORGS });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/experience') {
      const organizationId = url.searchParams.get('organizationId');
      state.experienceQueries.push(organizationId);
      return json(200, {
        candidates: organizationId
          ? CANDIDATES.filter(candidate => candidate.organizationId === organizationId)
          : CANDIDATES,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/sops') {
      const organizationId = url.searchParams.get('organizationId');
      const skillId = url.searchParams.get('skillId');
      state.sopQueries.push({ organizationId, skillId });
      return json(200, {
        sops: skillId ? SOPS.filter(sop => sop.skillId === skillId) : SOPS,
      });
    }

    const promote = url.pathname.match(/^\/api\/v1\/org\/experience\/([^/]+)\/promote$/);
    if (req.method === 'POST' && promote) {
      const id = decodeURIComponent(promote[1] ?? '');
      return readBody(req).then(raw => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        state.promoteLog.push({ id, body });
        if (state.failPromote) {
          return json(404, { code: 'EXPERIENCE_NOT_FOUND', message: `experience candidate not found: ${id}` });
        }
        const candidate = CANDIDATES.find(item => item.id === id);
        if (!candidate) {
          return json(404, { code: 'EXPERIENCE_NOT_FOUND', message: `experience candidate not found: ${id}` });
        }
        return json(200, {
          ...candidate,
          skillId: (body.skillId as string | undefined) ?? candidate.skillId,
          status: 'promoted',
          promotedAt: '2026-11-19T03:00:00.000Z',
        });
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

describe('org experience read model (M4 F4.2)', () => {
  it('loads candidates, SOP catalog and organizations in one snapshot', async () => {
    const state = await startFakeZeus();
    try {
      const snapshot = await loadOrgExperience(ctxFor(state), 'org-1');
      expect(snapshot.candidates.map(candidate => candidate.id)).toEqual(['cand-1']);
      expect(snapshot.sops).toEqual(SOPS);
      expect(snapshot.organizations.map(org => org.id)).toEqual(['org-1', 'org-2']);
      expect(state.experienceQueries).toEqual(['org-1']);
      expect(state.sopQueries).toEqual([{ organizationId: 'org-1', skillId: null }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('omits both filters when no organization is selected', async () => {
    const state = await startFakeZeus();
    try {
      const snapshot = await loadOrgExperience(ctxFor(state));
      expect(snapshot.candidates).toEqual(CANDIDATES);
      expect(state.experienceQueries).toEqual([null]);
      expect(state.sopQueries).toEqual([{ organizationId: null, skillId: null }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('forwards an explicit skillId filter to the SOP catalog', async () => {
    const state = await startFakeZeus();
    try {
      const sops = await ctxFor(state).zeus.listSops('org-1', 'refund-specialist');
      expect(sops.map(sop => sop.skillId)).toEqual(['refund-specialist']);
      expect(state.sopQueries).toEqual([{ organizationId: 'org-1', skillId: 'refund-specialist' }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('promotes a candidate with an explicit target skill', async () => {
    const state = await startFakeZeus();
    try {
      const candidate = await ctxFor(state).zeus.promoteExperience('cand-1', 'ops');
      expect(candidate.status).toBe('promoted');
      expect(candidate.skillId).toBe('ops');
      expect(state.promoteLog).toEqual([{ id: 'cand-1', body: { skillId: 'ops' } }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('promotes without skillId by omitting the field', async () => {
    const state = await startFakeZeus();
    try {
      const candidate = await ctxFor(state).zeus.promoteExperience('cand-1');
      expect(candidate.status).toBe('promoted');
      expect(state.promoteLog).toEqual([{ id: 'cand-1', body: {} }]);
    } finally {
      await stopFake(state.server);
    }
  });

  it('passes an upstream 404 through unchanged', async () => {
    const state = await startFakeZeus();
    state.failPromote = true;
    try {
      await expect(ctxFor(state).zeus.promoteExperience('missing')).rejects.toMatchObject({
        status: 404,
        code: 'EXPERIENCE_NOT_FOUND',
      });
    } finally {
      await stopFake(state.server);
    }
  });
});

describe('promote experience input validation', () => {
  it('accepts an omitted, null or blank skillId as no target', () => {
    expect(parsePromoteExperienceInput({})).toEqual({});
    expect(parsePromoteExperienceInput({ skillId: null })).toEqual({});
    expect(parsePromoteExperienceInput({ skillId: '   ' })).toEqual({});
  });

  it('trims a provided skillId', () => {
    expect(parsePromoteExperienceInput({ skillId: '  refund-specialist  ' })).toEqual({
      skillId: 'refund-specialist',
    });
  });

  it('rejects non-object bodies and non-string skillId', () => {
    expect(() => parsePromoteExperienceInput(null)).toThrow('promote body must be a JSON object');
    expect(() => parsePromoteExperienceInput([])).toThrow('promote body must be a JSON object');
    expect(() => parsePromoteExperienceInput({ skillId: 42 })).toThrow('skillId must be a string');
  });
});
