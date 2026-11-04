// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
