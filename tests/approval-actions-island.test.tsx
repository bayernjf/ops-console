// @vitest-environment jsdom
// Keyboard-only approval flow: Ctrl/Cmd+Enter approves, +Shift rejects, and
// the verdict message receives focus so the operator gets feedback without
// looking away from the keyboard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApprovalActions from '../src/islands/ApprovalActions';
import type { DecisionRecord } from '../src/server/upstream/types';

const D1: DecisionRecord = {
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

const D3: DecisionRecord = { ...D1, id: 'dec-3', grade: 'D3', status: 'blocked' };

function fakeJson(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ApprovalActions island', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(fakeJson(200, { status: 'approved', grade: 'D1' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('approves with Ctrl+Enter and moves focus to the result message', async () => {
    render(<ApprovalActions decision={D1} role="operator" />);
    const comment = screen.getByLabelText('审批备注（可选）');
    fireEvent.change(comment, { target: { value: 'looks fine' } });
    fireEvent.keyDown(comment, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/approvals/dec-1/decision');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve', comment: 'looks fine' });

    const message = await screen.findByText(/已提交批准/);
    await waitFor(() => expect(document.activeElement).toBe(message));
  });

  it('rejects with Ctrl+Shift+Enter', async () => {
    render(<ApprovalActions decision={D1} role="operator" />);
    fireEvent.keyDown(screen.getByLabelText('审批备注（可选）'), {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ decision: 'reject' });
  });

  it('ignores the shortcut when the operator is locked out of D3', async () => {
    render(<ApprovalActions decision={D3} role="operator" />);
    expect(screen.queryByText(/键盘：Tab/)).toBeNull();
    expect((screen.getByLabelText('审批备注（可选）') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('审批备注（可选）'), { key: 'Enter', ctrlKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the keyboard hint for an allowed decision', () => {
    render(<ApprovalActions decision={D1} role="owner" />);
    expect(screen.getByText(/键盘：Tab/)).toBeTruthy();
  });
});
