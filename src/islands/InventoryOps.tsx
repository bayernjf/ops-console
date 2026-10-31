import { useState } from 'react';

interface SkuOption {
  id: string;
  skuCode: string;
}

/** Manual inventory adjustment with an explicit confirm step. */
export default function InventoryOps({ skus }: { skus: SkuOption[] }) {
  const [skuId, setSkuId] = useState(skus[0]?.id ?? '');
  const [qty, setQty] = useState('0');
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(): Promise<void> {
    setBusy(true);
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skuId, qty: Number(qty) }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(
      res.ok
        ? `已调整：sku=${data?.inventory?.skuId} qtyAvailable=${data?.inventory?.qtyAvailable}（操作人由服务端注入会话用户）`
        : `调整失败 ${res.status}：${data?.error?.message ?? JSON.stringify(data)}`,
    );
    setBusy(false);
  }

  return (
    <section className="panel ops-box">
      <h3>库存手工调整（operator/owner 均可）</h3>
      <div className="form-row">
        <label>SKU
          <select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.skuCode}（{s.id}）</option>)}
          </select>
        </label>
        <label>可用数量 qty
          <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> 确认调整为目标数量（覆盖式）</label>
      </div>
      <button className="btn btn--primary" disabled={busy || !confirm || !skuId} onClick={() => void apply()}>
        {busy ? '提交中…' : '应用调整'}
      </button>
      {msg ? <p className={msg.includes('失败') ? 'action-failed' : 'action-ok'} role={msg.includes('失败') ? 'alert' : 'status'}>{msg}</p> : null}
    </section>
  );
}
