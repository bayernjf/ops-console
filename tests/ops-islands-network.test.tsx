// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RefundOps from '../src/islands/RefundOps';
import InventoryOps from '../src/islands/InventoryOps';
import OrdersOps from '../src/islands/OrdersOps';
import ProductOps from '../src/islands/ProductOps';

/**
 * P2-7 regression: the four ops islands used to call fetch with no
 * try/catch — a transport failure produced an unhandled rejection, no user
 * feedback, and a permanently stuck busy state (submit button disabled until
 * page refresh). Each island must now show a role=alert network-failure
 * message and release the busy state so the action can be retried.
 *
 * fetch is stubbed to reject outright (transport down); if the catch/finally
 * path is missing, the busy assertion below fails because the button never
 * re-enables.
 */

const SKUS = [{ id: 'sku_1', skuCode: 'SKU-1' }];
const ACCOUNTS = [{ id: 'acc_1', channel: 'tiktok', displayName: '店铺A' }];
const PRODUCTS = [
  { id: 'prd_1', title: '演示商品', status: 'draft', channelAccountId: 'acc_1', skus: [] },
];

function enabled(name: string): boolean {
  return !(screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
}

describe('ops islands survive a transport failure (P2-7)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('RefundOps: alerts and re-arms the request button', async () => {
    render(<RefundOps />);
    fireEvent.change(screen.getByLabelText('订单 ID'), { target: { value: 'ord_1' } });
    fireEvent.change(screen.getByLabelText('订单行 ID'), { target: { value: 'oli_1' } });

    fireEvent.click(screen.getByRole('button', { name: '发起退款' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('发起退款')).toBe(true);
  });

  it('RefundOps: settle path alerts and re-arms', async () => {
    // First put the island into the held-refund state over a healthy fetch…
    render(<RefundOps />);
    fireEvent.change(screen.getByLabelText('订单 ID'), { target: { value: 'ord_1' } });
    fireEvent.change(screen.getByLabelText('订单行 ID'), { target: { value: 'oli_1' } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 423,
      json: async () => ({ refund: { id: 'rfd_1', decisionId: 'dec_1', status: 'awaiting_approval', lines: [] } }),
    });
    fireEvent.click(screen.getByRole('button', { name: '发起退款' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '驳回退款' })).toBeTruthy());

    // …then the network drops for the decision call.
    fireEvent.click(screen.getByRole('button', { name: '驳回退款' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('驳回退款')).toBe(true);
  });

  it('InventoryOps: alerts and re-arms the apply button', async () => {
    render(<InventoryOps skus={SKUS} />);
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: '应用调整' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('应用调整')).toBe(true);
  });

  it('OrdersOps: alerts and re-arms the pull button', async () => {
    render(<OrdersOps accounts={ACCOUNTS} />);

    fireEvent.click(screen.getByRole('button', { name: '立即拉单' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('立即拉单')).toBe(true);
  });

  it('ProductOps: create path alerts and re-arms', async () => {
    render(<ProductOps products={PRODUCTS} accounts={ACCOUNTS} role="owner" />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '演示商品 标准款' } });
    fireEvent.change(screen.getByLabelText('SKU 编码'), { target: { value: 'SKU-DEMO-001' } });

    fireEvent.click(screen.getByRole('button', { name: '创建商品' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('创建商品')).toBe(true);
  });

  it('ProductOps: submit-listing path alerts and re-arms', async () => {
    render(<ProductOps products={PRODUCTS} accounts={ACCOUNTS} role="owner" />);

    fireEvent.click(screen.getByRole('button', { name: '提交上架' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络异常'));
    expect(enabled('提交上架')).toBe(true);
  });
});
