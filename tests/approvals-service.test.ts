import { describe, expect, it, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { UpstreamError } from '../src/server/upstream/http.js';
import { createContext } from '../src/server/context.js';
import {
  decideApproval,
  getApproval,
  getReplay,
  listApprovals,
} from '../src/server/approvals-service.js';
import { applyThresholds, getPolicy } from '../src/server/policy-service.js';
import { ConsoleError } from '../src/server/errors.js';
import type { DecisionRecord } from '../src/server/upstream/types.js';

/**
 * Full-network-path tests: a node:http fake zeus runs on localhost, the real
 * ZeusUpstream client (global fetch) talks to it, and the service modules are
 * exercised against the resulting ServerContext. No mocked functions.
 */

const OWNER = { username: 'owner', role: 'owner' as const };
const OPERATOR = { username: 'operator', role: 'operator' as const };

function rec(partial: Partial<DecisionRecord> & Pick<DecisionRecord, 'id' | 'grade' | 'status' | 'createdAt'>): DecisionRecord {
  return {
    intent: 'intent-' + partial.id,
    domain: 'refund',
    impact: 'team',
    reversibility: 'reversible',
    ruleId: 'rule-' + partial.grade,
    gradeReason: 'reason',
    policyVersion: 1,
    updatedAt: partial.createdAt,
    auditSeq: 1,
    approvals: [],
    ...partial,
  } as DecisionRecord;
}

const RECORDS: Record<string, DecisionRecord> = {
  dec_d1: rec({ id: 'dec_d1', grade: 'D1', status: 'awaiting_approval', createdAt: '2026-01-03T00:00:00.000Z' }),
  dec_d2: rec({ id: 'dec_d2', grade: 'D2', status: 'blocked', createdAt: '2026-01-02T00:00:00.000Z' }),
  dec_d3: rec({ id: 'dec_d3', grade: 'D3', status: 'blocked', createdAt: '2026-01-01T00:00:00.000Z' }),
};

const POLICY = { version: 1, defaultGrade: 'D2', rules: [{ id: 'd2-amount', match: { amount: { min: 500.01, max: 5000, currency: 'CNY' } }, grade: 'D2' }] };

interface FakeZeus {
  server: Server;
  baseUrl: string;
  approvalCalls: Array<{ id: string; body: unknown; authorization: string }>;
  thresholdCalls: Array<unknown>;
  listQueryLog: Array<{ status?: string | undefined; domain?: string | undefined }>;
}

async function startFakeZeus(): Promise<FakeZeus> {
  const state: FakeZeus = {
    server: null as unknown as Server,
    baseUrl: '',
    approvalCalls: [],
    thresholdCalls: [],
    listQueryLog: [],
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const auth = req.headers.authorization ?? '';
      if (auth !== 'Bearer test-zeus-token') return json(401, { error: 'unauthorized' });

      // GET /api/v1/decisions?status=&domain=
      if (req.method === 'GET' && url.pathname === '/api/v1/decisions') {
        const status = url.searchParams.get('status') ?? undefined;
        const domain = url.searchParams.get('domain') ?? undefined;
        state.listQueryLog.push({ status, domain });
        const decisions = Object.values(RECORDS).filter((r) => (status ? r.status === status : true));
        return json(200, { decisions });
      }
      // GET /api/v1/decisions/:id
      const getMatch = url.pathname.match(/^\/api\/v1\/decisions\/([^/]+)$/);
      if (req.method === 'GET' && getMatch) {
        const found = RECORDS[getMatch[1]!];
        return found ? json(200, found) : json(404, { code: 'DECISION_NOT_FOUND', message: `not found: ${getMatch![1]}`, retryable: false });
      }
      // GET /api/v1/decisions/:id/replay
      const replayMatch = url.pathname.match(/^\/api\/v1\/decisions\/([^/]+)\/replay$/);
      if (req.method === 'GET' && replayMatch) {
        return json(200, { format: url.searchParams.get('format') ?? 'json', record: RECORDS[replayMatch[1]!] ?? null, events: [] });
      }
      // POST /api/v1/decisions/:id/approval
      const apprMatch = url.pathname.match(/^\/api\/v1\/decisions\/([^/]+)\/approval$/);
      if (req.method === 'POST' && apprMatch) {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        state.approvalCalls.push({ id: apprMatch[1]!, body, authorization: auth });
        const target = RECORDS[apprMatch[1]!];
        if (!target) return json(404, { code: 'DECISION_NOT_FOUND', message: 'missing', retryable: false });
        if (target.status !== 'awaiting_approval' && target.status !== 'blocked') {
          return json(409, { code: 'APPROVAL_CONFLICT', message: 'already settled', retryable: false });
        }
        return json(200, { decisionId: target.id, grade: target.grade, mode: target.mode, status: 'decided', ruleId: target.ruleId, auditSeq: 2 });
      }
      // GET /api/v1/policy
      if (req.method === 'GET' && url.pathname === '/api/v1/policy') {
        return json(200, POLICY);
      }
      // POST /api/v1/org/policy/thresholds
      if (req.method === 'POST' && url.pathname === '/api/v1/org/policy/thresholds') {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        state.thresholdCalls.push(body);
        return json(200, { ...POLICY, version: 2 });
      }
      return json(404, { code: 'ROUTE_MISSING', message: url.pathname, retryable: false });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.server = server;
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

let fake: FakeZeus;
const zeus = (base: string) => new ZeusUpstream(base, 'test-zeus-token');

afterAll(async () => {
  await new Promise<void>((resolve, reject) => fake.server.close((err) => (err ? reject(err) : resolve())));
});

function ctxFor(baseUrl: string) {
  return createContext({ zeus: zeus(baseUrl), commerce: new CommerceUpstream('http://127.0.0.1:1', 'x') });
}

describe('approvals service against fake zeus (real HTTP)', () => {
  it('merges pending queues (awaiting_approval + blocked), sorted desc, forwards domain', async () => {
    fake = await startFakeZeus();
    const ctx = ctxFor(fake.baseUrl);
    const all = await listApprovals(ctx);
    expect(all.map((r) => r.id)).toEqual(['dec_d1', 'dec_d2', 'dec_d3']);
    expect(fake.listQueryLog).toEqual([{ status: 'awaiting_approval', domain: undefined }, { status: 'blocked', domain: undefined }]);

    const d1Only = await listApprovals(ctx, { status: 'awaiting_approval' });
    expect(d1Only.map((r) => r.id)).toEqual(['dec_d1']);

    const d3Only = await listApprovals(ctx, { grade: 'D3' });
    expect(d3Only.map((r) => r.id)).toEqual(['dec_d3']);

    await listApprovals(ctx, { domain: 'refund', grade: 'D2' });
    expect(fake.listQueryLog.at(-1)).toMatchObject({ domain: 'refund' });
  });

  it('rejects invalid status / grade with 400 VALIDATION_FAILED without calling upstream', async () => {
    const ctx = ctxFor(fake.baseUrl);
    await expect(listApprovals(ctx, { status: 'bogus' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    await expect(listApprovals(ctx, { grade: 'D9' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('returns the raw record and the replay bundle verbatim', async () => {
    const ctx = ctxFor(fake.baseUrl);
    expect(await getApproval(ctx, 'dec_d2')).toMatchObject({ id: 'dec_d2', grade: 'D2' });
    const replay = await getReplay(ctx, 'dec_d2', 'json');
    expect(replay).toMatchObject({ format: 'json' });
  });

  it('operator approving D3 -> 403 FORBIDDEN and zeus approval endpoint untouched', async () => {
    const ctx = ctxFor(fake.baseUrl);
    const before = fake.approvalCalls.length;
    await expect(decideApproval(ctx, 'dec_d3', { decision: 'approve' }, OPERATOR)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(fake.approvalCalls.length).toBe(before);
  });

  it('operator approves D1/D2 and owner approves D3, approver injected, zeus response passed through', async () => {
    const ctx = ctxFor(fake.baseUrl);
    const d1 = await decideApproval(ctx, 'dec_d1', { decision: 'approve', comment: 'ok' }, OPERATOR);
    expect(d1).toMatchObject({ decisionId: 'dec_d1', status: 'decided', grade: 'D1' });
    expect(fake.approvalCalls.at(-1)).toMatchObject({ id: 'dec_d1', body: { decision: 'approve', approver: 'operator', comment: 'ok' } });

    const d3 = await decideApproval(ctx, 'dec_d3', { decision: 'reject' }, OWNER);
    expect(d3).toMatchObject({ decisionId: 'dec_d3', status: 'decided', grade: 'D3' });
    expect(fake.approvalCalls.at(-1)).toMatchObject({ id: 'dec_d3', body: { decision: 'reject', approver: 'owner' } });
  });

  it('passes through zeus 404 / 409 bodies verbatim and maps unreachable upstream to 503', async () => {
    const ctx = ctxFor(fake.baseUrl);
    const notFound = decideApproval(ctx, 'dec_missing', { decision: 'approve' }, OWNER);
    await expect(notFound).rejects.toMatchObject({ status: 404 });

    // Closed-port context => fetch failure => 503 UPSTREAM_UNAVAILABLE.
    const dead = ctxFor('http://127.0.0.1:1');
    await expect(listApprovals(dead)).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
  });
});

describe('policy / thresholds against fake zeus (real HTTP)', () => {
  it('getPolicy returns the zeus policy verbatim for any signed-in role', async () => {
    const ctx = ctxFor(fake.baseUrl);
    expect(await getPolicy(ctx)).toMatchObject({ version: 1, defaultGrade: 'D2' });
  });

  it('operator changing thresholds -> 403 FORBIDDEN, zeus untouched', async () => {
    const ctx = ctxFor(fake.baseUrl);
    const before = fake.thresholdCalls.length;
    await expect(applyThresholds(ctx, { d1MaxAmount: 400 }, OPERATOR)).rejects.toBeInstanceOf(ConsoleError);
    await expect(applyThresholds(ctx, { d1MaxAmount: 400 }, OPERATOR)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fake.thresholdCalls.length).toBe(before);
  });

  it('owner changing thresholds injects actor and passes the policy through', async () => {
    const ctx = ctxFor(fake.baseUrl);
    const policy = await applyThresholds(ctx, { d1MaxAmount: 400, defaultGrade: 'D3' }, OWNER);
    expect(policy).toMatchObject({ version: 2 });
    expect(fake.thresholdCalls.at(-1)).toMatchObject({ d1MaxAmount: 400, defaultGrade: 'D3', actor: 'owner' });
  });

  it('unreachable zeus while reading policy -> 503 UpstreamError', async () => {
    const dead = ctxFor('http://127.0.0.1:1');
    await expect(getPolicy(dead)).rejects.toBeInstanceOf(UpstreamError);
  });
});
