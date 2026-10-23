import { useState } from 'react';

/**
 * Refund controlled actions: request refund (423 = pending D2 hold, normal),
 * then settle it through commerce's /refunds/:id/decision (D2: operator + owner
 * both allowed). approver is injected server-side.
 */
export default function RefundOps() {
  const [orderId, setOrderId] = useState('');
  const [orderItemId, setOrderItemId] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(): Promise<void> {
    setBusy(true);
    const res = await fetch('/api/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, lines: [{ orderItemId }], reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423) {
      setRefundId(data?.refund?.id ?? null);
      setMsg(`已挂起待审批（423）：refund=${data?.refund?.id} decisionId=${data?.refund?.decisionId} status=${data?.refund?.status}。渠道退款尚未执行。`);
    } else if (res.ok) {
      setRefundId(data?.refund?.id ?? null);
      setMsg(`退款已直接处理：status=${data?.refund?.status}`);
    } else {
      setRefundId(null);
      setMsg(`发起失败 ${res.status}：${data?.error?.message ?? JSON.stringify(data)}`);
    }
    setBusy(false);
  }

  async function settle(verdict: 'approve' | 'reject'): Promise<void> {
    if (!refundId) return;
    setBusy(true);
    const res = await fetch(`/api/refunds/${refundId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict, comment: 'console batch2' }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(
      res.ok
        ? `已${verdict === 'approve' ? '批准并执行渠道退款' : '驳回'}：refund status=${data?.refund?.status}`
        : `审批失败 ${res.status}：${data?.error?.message ?? JSON.stringify(data)}`,
    );
    setBusy(false);
  }

  return (
    <section className="panel ops-box">
      <h3>发起退款（operator/owner 均可；D2 挂起后 operator 也可审批）</h3>
      <div className="form-row">
        <label>订单 ID
          <input value={orderId} placeholder="ord_…" onChange={(e) => setOrderId(e.target.value)} />
        </label>
        <label>订单行 ID
          <input value={orderItemId} placeholder="order line id" onChange={(e) => setOrderItemId(e.target.value)} />
        </label>
        <label>原因
          <input value={reason} placeholder="商品质量问题" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <button className="btn btn--primary" disabled={busy || !orderId || !orderItemId} onClick={() => void request()}>
        发起退款
      </button>
      {refundId ? (
        <div className="settle-row">
          <button className="btn btn--approve" disabled={busy} onClick={() => void settle('approve')}>批准退款</button>
          <button className="btn btn--reject" disabled={busy} onClick={() => void settle('reject')}>驳回退款</button>
        </div>
      ) : null}
      {msg ? <p className={msg.includes('失败') ? 'action-failed' : 'action-ok'}>{msg}</p> : null}
    </section>
  );
}
