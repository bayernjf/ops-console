// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApprovalList from '../src/islands/ApprovalList';
import type { DecisionRecord } from '../src/server/upstream/types';

const RECORD: DecisionRecord = {
  id: 'dec-1',
  intent: 'issue refund',
  domain: 'commerce',
  grade: 'D1',
  mode: 'approve-async',
  status: 'awaiting_approval',
  ruleId: 'R1',
  gradeReason: 'amount above auto threshold',
  impact: 'medium',
  reversibility: 'reversible',
  policyVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  auditSeq: 1,
  approvals: [],
};

function fakeJson(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('ApprovalList island', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(fakeJson(200, { decisions: [RECORD] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('shows the loading state while a refresh is in flight', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<ApprovalList initial={[RECORD]} refreshMs={20000} />);
    expect(await screen.findByText('正在刷新待审批决策…')).toBeTruthy();
  });

  it('explains the empty state with the active filter and how data appears', async () => {
    fetchMock.mockResolvedValue(fakeJson(200, { decisions: [] }));
    render(<ApprovalList initial={[]} refreshMs={20000} />);
    expect(await screen.findByText('当前筛选「全部待办」没有待审批项')).toBeTruthy();
    expect(screen.getByText(/数据来自 zeus 决策流/)).toBeTruthy();
    expect(screen.getByText(/每 20 秒自动刷新/)).toBeTruthy();
    expect(screen.getByText(/三个级别当前都没有记录/)).toBeTruthy();
  });

  it('names the grade filter in the empty state', async () => {
    fetchMock.mockResolvedValue(fakeJson(200, { decisions: [] }));
    render(<ApprovalList initial={[]} refreshMs={20000} />);
    fireEvent.change(screen.getByLabelText('级别'), { target: { value: 'D2' } });
    expect(await screen.findByText('当前筛选「D2」没有待审批项')).toBeTruthy();
    expect(screen.getByText(/当前只显示 D2/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/approvals?grade=D2', expect.anything());
  });

  it('renders a retryable error instead of an empty list when the load fails', async () => {
    fetchMock.mockRejectedValue(new Error('upstream status 503'));
    render(<ApprovalList initial={[]} refreshMs={20000} />);

    expect(await screen.findByText(/upstream status 503/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.queryByText(/没有待审批项/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('surfaces a server-side load failure as the same retryable error', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<ApprovalList initial={[]} refreshMs={20000} initialError="zeus unreachable" />);

    expect(await screen.findByText(/zeus unreachable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.queryByText(/没有待审批项/)).toBeNull();
  });

  it('recovers from a failed load when retry succeeds', async () => {
    fetchMock.mockRejectedValue(new Error('upstream status 503'));
    render(<ApprovalList initial={[]} refreshMs={20000} />);
    const retry = await screen.findByRole('button', { name: '重试' });

    fetchMock.mockResolvedValue(fakeJson(200, { decisions: [RECORD] }));
    fireEvent.click(retry);

    expect(await screen.findByText('issue refund')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/upstream status 503/)).toBeNull());
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('keeps the last successful table and warns when a poll fails', async () => {
    fetchMock.mockRejectedValue(new Error('upstream status 502'));
    render(<ApprovalList initial={[RECORD]} refreshMs={20000} />);

    expect(await screen.findByText(/数据可能过期/)).toBeTruthy();
    expect(screen.getByText('issue refund')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByText(/没有待审批项/)).toBeNull();
  });

  it('recovers the stale table on retry and shows the empty state only after success', async () => {
    fetchMock.mockRejectedValue(new Error('upstream status 502'));
    render(<ApprovalList initial={[RECORD]} refreshMs={20000} />);
    const retry = await screen.findByRole('button', { name: '重试' });

    fetchMock.mockResolvedValue(fakeJson(200, { decisions: [] }));
    fireEvent.click(retry);

    expect(await screen.findByText('当前筛选「全部待办」没有待审批项')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/数据可能过期/)).toBeNull());
  });
});
