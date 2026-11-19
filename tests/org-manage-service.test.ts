import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { ModelHubUpstream } from '../src/server/upstream/model-hub.js';
import { createContext } from '../src/server/context.js';
import {
  loadOrgManageSnapshot,
  parseAssignAgentInput,
  parseCreateDepartmentInput,
  parseCreateOrganizationInput,
  parseCreatePositionInput,
} from '../src/server/org-manage-service.js';

/**
 * Full-network-path tests for the F2.1 owner-only org modeling writes: a
 * node:http fake zeus serves the org v1 read/write faces, the real
 * ZeusUpstream talks to it, and the service validates only the console edge.
 */

const ORGANIZATIONS = [
  { id: 'org-1', name: '一号组织', scaleTier: 'small', createdAt: '2026-11-19T00:00:00.000Z' },
];
const DEPARTMENTS = [
  {
    id: 'dept-1',
    organizationId: 'org-1',
    name: '内容部',
    mission: '内容生产',
    createdAt: '2026-11-19T00:00:00.000Z',
  },
];
const POSITIONS = [
  {
    id: 'pos-1',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    name: '内容策划',
    responsibilities: [],
    requiredSkills: [],
    allowedTools: [],
    decisionScope: 'D2',
    createdAt: '2026-11-19T00:00:00.000Z',
  },
];

interface FakeZeus {
  server: Server;
  baseUrl: string;
  orgLog: unknown[];
  departmentLog: unknown[];
  positionLog: unknown[];
  assignLog: unknown[];
  failCreate: boolean;
}

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    orgLog: [],
    departmentLog: [],
    positionLog: [],
    assignLog: [],
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
      return json(200, { organizations: ORGANIZATIONS });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/departments') {
      return json(200, { departments: DEPARTMENTS });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/org/positions') {
      return json(200, { positions: POSITIONS });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/v1/org/')) {
      let raw = '';
      req.on('data', chunk => {
        raw += chunk;
      });
      req.on('end', () => {
        if (state.failCreate) {
          return json(400, { code: 'VALIDATION_FAILED', message: 'bad org write' });
        }
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (url.pathname === '/api/v1/org/organizations') {
          state.orgLog.push(body);
          return json(201, { ...body, id: body.id ?? 'org-new', createdAt: '2026-11-19T01:00:00.000Z' });
        }
        if (url.pathname === '/api/v1/org/departments') {
          state.departmentLog.push(body);
          return json(201, { ...body, id: body.id ?? 'dept-new', createdAt: '2026-11-19T01:00:00.000Z' });
        }
        if (url.pathname === '/api/v1/org/positions') {
          state.positionLog.push(body);
          return json(201, { ...body, id: body.id ?? 'pos-new', createdAt: '2026-11-19T01:00:00.000Z' });
        }
        const assignMatch = url.pathname.match(/^\/api\/v1\/org\/positions\/(.+)\/assign-agent$/);
        if (assignMatch) {
          state.assignLog.push({ positionId: assignMatch[1], body });
          return json(200, { ...POSITIONS[0], agentId: body.agentId });
        }
        return json(404, { code: 'NOT_FOUND', message: url.pathname });
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

describe('org modeling read model (F2.1)', () => {
  it('loads organizations, departments and positions in one snapshot', async () => {
    const state = await startFakeZeus();
    try {
      const snapshot = await loadOrgManageSnapshot(ctxFor(state));
      expect(snapshot.organizations).toEqual(ORGANIZATIONS);
      expect(snapshot.departments).toEqual(DEPARTMENTS);
      expect(snapshot.positions).toEqual(POSITIONS);
    } finally {
      await stopFake(state.server);
    }
  });
});

describe('org modeling upstream writes (F2.1)', () => {
  it('creates an organization and forwards the validated body', async () => {
    const state = await startFakeZeus();
    try {
      const input = parseCreateOrganizationInput({
        name: ' 内容运营组 ',
        id: 'org:content',
        scaleTier: 'team',
        parentId: 'org-1',
        concurrencyLimit: 3,
      });
      const created = await ctxFor(state).zeus.createOrganization(input);
      expect(created.id).toBe('org:content');
      expect(state.orgLog[0]).toEqual({
        name: '内容运营组',
        id: 'org:content',
        scaleTier: 'team',
        parentId: 'org-1',
        concurrencyLimit: 3,
      });
    } finally {
      await stopFake(state.server);
    }
  });

  it('creates a department and a position through their routes', async () => {
    const state = await startFakeZeus();
    try {
      const department = parseCreateDepartmentInput({
        organizationId: 'org-1',
        name: '内容部',
        mission: '负责内容生产',
      });
      await ctxFor(state).zeus.createDepartment(department);
      expect(state.departmentLog[0]).toEqual({
        organizationId: 'org-1',
        name: '内容部',
        mission: '负责内容生产',
      });

      const position = parseCreatePositionInput({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        name: '内容策划',
        responsibilities: ['选题', '撰稿'],
        requiredSkills: ['copywriting'],
        allowedTools: ['web-search'],
        decisionScope: 'D1',
      });
      await ctxFor(state).zeus.createPosition(position);
      expect(state.positionLog[0]).toEqual({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        name: '内容策划',
        responsibilities: ['选题', '撰稿'],
        requiredSkills: ['copywriting'],
        allowedTools: ['web-search'],
        decisionScope: 'D1',
      });
    } finally {
      await stopFake(state.server);
    }
  });

  it('binds an agent to a position and returns the updated position', async () => {
    const state = await startFakeZeus();
    try {
      const updated = await ctxFor(state).zeus.assignAgent('pos-1', 'agent-7');
      expect(updated.agentId).toBe('agent-7');
      expect(state.assignLog[0]).toEqual({
        positionId: 'pos-1',
        body: { agentId: 'agent-7' },
      });
    } finally {
      await stopFake(state.server);
    }
  });

  it('passes an upstream 400 through unchanged', async () => {
    const state = await startFakeZeus();
    state.failCreate = true;
    try {
      const input = parseCreateOrganizationInput({ name: '撞车组织' });
      await expect(ctxFor(state).zeus.createOrganization(input)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'bad org write',
      });
    } finally {
      await stopFake(state.server);
    }
  });
});

describe('org modeling form validation', () => {
  it('accepts a minimal organization and keeps optional fields absent', () => {
    expect(parseCreateOrganizationInput({ name: '内容组' })).toEqual({ name: '内容组' });
  });

  it('rejects an unknown scale tier and out-of-range concurrency limits', () => {
    expect(() => parseCreateOrganizationInput({ name: 'x', scaleTier: 'S' })).toThrow(
      'scaleTier must be one of',
    );
    for (const limit of [0, 9, 2.5]) {
      expect(() => parseCreateOrganizationInput({ name: 'x', concurrencyLimit: limit })).toThrow(
        'concurrencyLimit must be an integer between 1 and 8',
      );
    }
  });

  it('requires name for organizations and org/name/mission for departments', () => {
    expect(() => parseCreateOrganizationInput({})).toThrow('name is required');
    expect(() => parseCreateDepartmentInput({ name: 'x', mission: 'y' })).toThrow(
      'organizationId is required',
    );
    expect(() => parseCreateDepartmentInput({ organizationId: 'org-1', mission: 'y' })).toThrow(
      'name is required',
    );
    expect(() => parseCreateDepartmentInput({ organizationId: 'org-1', name: 'x' })).toThrow(
      'mission is required',
    );
  });

  it('normalizes position lists and rejects unknown decision scopes', () => {
    expect(
      parseCreatePositionInput({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        name: '策划',
        responsibilities: [' 选题 ', '', '撰稿'],
        requiredSkills: ['copywriting'],
        allowedTools: [],
      }),
    ).toEqual({
      organizationId: 'org-1',
      departmentId: 'dept-1',
      name: '策划',
      responsibilities: ['选题', '撰稿'],
      requiredSkills: ['copywriting'],
      allowedTools: [],
    });
    expect(() =>
      parseCreatePositionInput({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        name: '策划',
        decisionScope: 'D9' as never,
      }),
    ).toThrow('decisionScope must be one of D0, D1, D2, D3');
    expect(() =>
      parseCreatePositionInput({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        name: '策划',
        responsibilities: '选题' as never,
      }),
    ).toThrow('responsibilities must be an array of strings');
  });

  it('requires an agent id for binding', () => {
    expect(() => parseAssignAgentInput({})).toThrow('agentId is required');
    expect(parseAssignAgentInput({ agentId: ' agent-7 ' })).toEqual({ agentId: 'agent-7' });
  });
});
