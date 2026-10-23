import { useState } from 'react';

interface AccountRow {
  id: string;
  channel: string;
  displayName: string;
}

/** Pull orders from a channel (idempotent: re-pull is skipped, never dupes). */
export default function OrdersOps({ accounts }: { accounts: AccountRow[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pull(): Promise<void> {
    setBusy(true);
    const res = await fetch('/api/orders/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelAccountId: accountId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`拉单失败 ${res.status}：${data?.error?.message ?? JSON.stringify(data)}`);
    } else {
      const imported: unknown[] = data?.result?.imported ?? [];
      const skipped: unknown[] = data?.result?.skipped ?? [];
      setMsg(`拉单完成：新增 ${imported.length} 单，跳过（幂等）${skipped.length} 单。`);
    }
    setBusy(false);
  }

  return (
    <section className="panel ops-box">
      <h3>从渠道拉单（幂等，operator/owner 均可）</h3>
      <div className="form-row">
        <label>渠道账号
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}（{a.channel}）</option>)}
          </select>
        </label>
      </div>
      <button className="btn btn--primary" disabled={busy || !accountId} onClick={() => void pull()}>
        {busy ? '拉取中…' : '立即拉单'}
      </button>
      {msg ? <p className={msg.includes('失败') ? 'action-failed' : 'action-ok'}>{msg}</p> : null}
    </section>
  );
}
