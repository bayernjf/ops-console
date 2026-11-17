// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrgTaskQueue from '../src/islands/OrgTaskQueue';
import type { OrgTask } from '../src/server/upstream/types';

/**
 * Tier0 org M2 F2.2 island coverage: SSR rows render the queue columns, the
 * awaiting_decision band links to the approval page, and the poll replaces the
 * table when zeus moves a task on (the only mechanism the page has to show a
 * status transition without a reload).
 */
interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

function fakeJson(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function task(over: Partial<OrgTask> & Pick<OrgTask, 'id' | 'status' | 'createdAt'>): OrgTask {
  return {
    organizationId: 'org-1',
    title: `任务 ${over.id}`,
    updatedAt: over.createdAt,
    ...over,
  };
}

const PENDING = task({
  id: 't-1',
  status: 'pending',
  createdAt: '2026-11-17T01:00:00.000Z',
  positionId: 'pos-1',
});
const BLOCKED = task({
  id: 't-2',
  status: 'awaiting_decision',
  createdAt: '2026-11-17T00:30:00.000Z',
  positionId: 'pos-1',
});
const DONE = task({
  id: 't-3',
  status: 'done',
  createdAt: '2026-11-16T03:00:00.000Z',
  positionId: 'pos-2',
  attempts: 2,
  workspacePath: '/var/ws/org-1/task-3',
  outcome: { status: 'done', attempts: 2, durationMs: 4200, settledAt: '2026-11-16T03:10:00.000Z', decisions: [] },
});

const NAMES: Record<string, string> = { 'pos-1': '执行工程师', 'pos-2': '审核员' };

describe('OrgTaskQueue island', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<FakeResponse>>();
    fetchMock.mockResolvedValue(fakeJson(200, { tasks: [PENDING, BLOCKED, DONE], counts: {} }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the queue columns from the SSR seed', () => {
    render(<OrgTaskQueue initial={[PENDING, BLOCKED, DONE]} positionNames={NAMES} refreshMs={20000} organizationId="org-1" />);
    for (const head of ['任务', '岗位', '状态', '入队时间', '耗时', '重试', '工作区']) {
      expect(screen.getByText(head)).toBeTruthy();
    }
    expect(screen.getAllByText('执行工程师').length).toBeGreaterThan(0);
    expect(screen.getAllByText('审核员').length).toBeGreaterThan(0);
    expect(screen.getByText('待派发')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    // Duration prefers outcome.durationMs; workspace shows the last two segments.
    expect(screen.getByText('4.2s')).toBeTruthy();
    expect(screen.getByText('…/org-1/task-3')).toBeTruthy();
    // Header meta announces the total and the poll cadence.
    expect(screen.getByText(/共 3 个任务/)).toBeTruthy();
    expect(screen.getByText(/等待决策 1/)).toBeTruthy();
  });

  it('puts the blocked band on top with a deep link to the approval page', () => {
    render(<OrgTaskQueue initial={[PENDING, BLOCKED, DONE]} positionNames={NAMES} refreshMs={20000} organizationId="org-1" />);
    expect(screen.getByText(/卡点 · 等待决策（1）/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '去审批 →' });
    expect(link.getAttribute('href')).toBe('/app/approvals/t-2');
  });

  it('replaces the table when the poll sees a status transition', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      fakeJson(200, { tasks: [task({ ...PENDING, status: 'running' }), DONE], counts: {} }),
    );
    render(<OrgTaskQueue initial={[PENDING, DONE]} positionNames={NAMES} refreshMs={5000} organizationId="org-1" />);
    expect(screen.getByText('待派发')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText('待派发')).toBeNull();
    expect(screen.getByText('执行中')).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/org/tasks?organization_id=org-1');
  });

  it('fails closed when the poll hits an upstream error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(fakeJson(503, { error: { message: 'upstream unavailable' } }));
    render(<OrgTaskQueue initial={[PENDING]} positionNames={NAMES} refreshMs={5000} organizationId="org-1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('任务 t-1')).toBeNull();
  });
});
