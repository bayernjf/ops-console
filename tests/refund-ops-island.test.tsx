// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RefundOps from '../src/islands/RefundOps';

/**
 * OC-1 regression: approving a refund is an irreversible channel money-out,
 * so it must never fire on a single click. The island must arm an inline
 * two-step confirm (showing the refund amount) and the decision API must
 * only be called after the explicit confirm click. Cancel must not call it.
 */

interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

function fakeJson(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const HELD_REFUND = {
  refund: {
    id: 'rfd_test1',
    decisionId: 'dec_test1',
    status: 'awaiting_approval',
    lines: [{ orderItemId: 'oli_1', qty: 1, amount: 42.5 }],
  },
};

async function createHeldRefund(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  fireEvent.change(screen.getByLabelText('订单 ID'), { target: { value: 'ord_1' } });
  fireEvent.change(screen.getByLabelText('订单行 ID'), { target: { value: 'oli_1' } });
  fetchMock.mockResolvedValueOnce(fakeJson(423, HELD_REFUND));
  fireEvent.click(screen.getByRole('button', { name: '发起退款' }));
  await waitFor(() => expect(screen.getByText(/已挂起待审批/)).toBeTruthy());
}

describe('RefundOps approval confirmation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<FakeResponse>>();
    // Default: any unexpected API call gets a 500, so a stray decision call
    // fails loudly in assertions instead of crashing on an undefined body.
    fetchMock.mockResolvedValue(fakeJson(500, { error: { message: 'unexpected fetch call' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function decisionCalls(): unknown[] {
    return fetchMock.mock.calls.filter((call) => String(call[0]).includes('/decision'));
  }

  it('does not execute the channel refund on the first approve click', async () => {
    render(<RefundOps />);
    await createHeldRefund(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: '批准退款' }));

    // Regression (OC-1): arming the confirm must NOT hit the decision API.
    expect(decisionCalls()).toHaveLength(0);
  });

  it('shows the refund amount in the confirm step', async () => {
    render(<RefundOps />);
    await createHeldRefund(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: '批准退款' }));

    expect(screen.getByRole('button', { name: /确认退款/ }).textContent).toContain('¥42.50');
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('executes the refund only after the explicit confirm click', async () => {
    render(<RefundOps />);
    await createHeldRefund(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: '批准退款' }));
    fetchMock.mockResolvedValue(fakeJson(200, { refund: { status: 'succeeded' } }));
    fireEvent.click(screen.getByRole('button', { name: /确认退款/ }));

    await waitFor(() => expect(decisionCalls()).toHaveLength(1));
    const [, init] = decisionCalls()[0] as [unknown, { body?: string }];
    expect(JSON.parse(String(init.body))).toMatchObject({ verdict: 'approve' });
    await waitFor(() => expect(screen.getByText(/已批准并执行渠道退款/)).toBeTruthy());
  });

  it('cancel aborts without calling the decision API', async () => {
    render(<RefundOps />);
    await createHeldRefund(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: '批准退款' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(decisionCalls()).toHaveLength(0);
    // Back to the armed-from-scratch state: approve needs arming again.
    expect(screen.getByRole('button', { name: '批准退款' })).toBeTruthy();
  });
});
