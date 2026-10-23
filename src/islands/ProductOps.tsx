import { useState } from 'react';

/**
 * Product controlled actions (Tier0 M8 batch 2): create product, submit
 * listing (423 = pending D3 hold), and settle the submission through
 * commerce's own endpoint (owner-only for D3 — mirrored here, enforced
 * server-side too). The generic zeus workbench is NOT used to settle
 * commerce-raised decisions.
 */

interface ProductRow {
  id: string;
  title: string;
  status: string;
  channelAccountId?: string;
  skus: Array<{ id: string; skuCode: string; price: number; currency: string }>;
}
interface AccountRow {
  id: string;
  channel: string;
  displayName: string;
}
interface Submission {
  productId: string;
  channelAccountId: string;
  decisionId: string;
  grade: string;
  status: 'awaiting_approval' | 'listed';
}

interface Props {
  products: ProductRow[];
  accounts: AccountRow[];
  role: 'owner' | 'operator';
}

interface ApiJson {
  error?: { message?: string };
  product?: { id?: string };
  submission?: Submission;
  result?: { status?: string };
  [key: string]: unknown;
}

async function post(url: string, body: unknown): Promise<{ status: number; data: ApiJson }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export default function ProductOps({ products, accounts, role }: Props) {
  const [title, setTitle] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [skuCode, setSkuCode] = useState('');
  const [price, setPrice] = useState('1299');
  const [currency, setCurrency] = useState('CNY');
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [createFail, setCreateFail] = useState(false);

  const [prodId, setProdId] = useState(products[0]?.id ?? '');
  const [sellPoints, setSellPoints] = useState('');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createProduct(): Promise<void> {
    setBusy(true);
    const { status, data } = await post('/api/products', {
      title,
      channelAccountId: accountId || undefined,
      skus: [{ skuCode, price: Number(price), currency }],
    });
    setCreateFail(status >= 400);
    setCreateMsg(status >= 400
      ? `失败 ${status}：${data?.error?.message ?? JSON.stringify(data)}`
      : `已创建商品 ${data?.product?.id}（SKU ${skuCode}）。注意：新建商品不会自动上架，需在下方提交上架。`);
    setBusy(false);
  }

  async function submitListing(): Promise<void> {
    setBusy(true);
    const sellingPoints = sellPoints.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
    const { status, data } = await post('/api/listings', {
      productId: prodId,
      channelAccountId: accountId,
      contentType: 'detail',
      sellingPoints,
    });
    if (status === 423 || status === 201) {
      const sub = data?.submission as Submission | undefined;
      setSubmission(sub ?? null);
      setSubmitMsg(
        status === 423
          ? `已挂起待审批：decisionId=${sub?.decisionId} grade=${sub?.grade} status=${sub?.status}（423 正常挂起，审批后才真正发布到渠道）`
          : `提交完成：status=${sub?.status}`,
      );
    } else {
      setSubmission(null);
      setSubmitMsg(`失败 ${status}：${data?.error?.message ?? JSON.stringify(data)}`);
    }
    setBusy(false);
  }

  async function settle(verdict: 'approve' | 'reject'): Promise<void> {
    if (!submission) return;
    setBusy(true);
    const { status, data } = await post(`/api/listings/${submission.decisionId}/${verdict}`, { comment: 'console batch2' });
    setSubmitMsg(
      status >= 400
        ? `审批失败 ${status}：${data?.error?.message ?? JSON.stringify(data)}`
        : `已${verdict === 'approve' ? '批准上架' : '驳回'}：${data?.submission?.status ?? data?.result?.status ?? 'done'}`,
    );
    setBusy(false);
  }

  const listingLocked = submission?.grade === 'D3' && role !== 'owner';

  return (
    <div className="ops-grid">
      <section className="panel ops-box">
        <h3>新建商品（受控动作，operator/owner 均可）</h3>
        <div className="form-row">
          <label>标题
            <input value={title} placeholder="演示商品 标准款" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>渠道账号
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}（{a.channel}）</option>)}
            </select>
          </label>
          <label>SKU 编码
            <input value={skuCode} placeholder="SKU-DEMO-001" onChange={(e) => setSkuCode(e.target.value)} />
          </label>
          <label>价格
            <input value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>币种
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </label>
        </div>
        <button className="btn btn--primary" disabled={busy || !title || !skuCode} onClick={() => void createProduct()}>
          创建商品
        </button>
        {createMsg ? <p className={createFail ? 'action-failed' : 'action-ok'}>{createMsg}</p> : null}
      </section>

      <section className="panel ops-box">
        <h3>上架提交（423 = 挂起待 D3 审批）</h3>
        <div className="form-row">
          <label>商品
            <select value={prodId} onChange={(e) => setProdId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}（{p.id}）</option>)}
            </select>
          </label>
          <label>卖点（逗号分隔）
            <input value={sellPoints} placeholder="品质保证,七天无理由" onChange={(e) => setSellPoints(e.target.value)} />
          </label>
        </div>
        <button className="btn btn--primary" disabled={busy || !prodId} onClick={() => void submitListing()}>
          提交上架
        </button>
        {submitMsg ? <p className={submitMsg.includes('失败') ? 'action-failed' : 'action-ok'}>{submitMsg}</p> : null}
        {submission && submission.status === 'awaiting_approval' ? (
          <div className="settle-row">
            <p className="lock-note">
              {listingLocked
                ? `该提交为 ${submission.grade}，operator 无审批权限（服务端 403 强制）。请 owner 在控制台审批。`
                : `decisionId=${submission.decisionId}，由 commerce 端点执行真正的渠道发布。`}
            </p>
            <button className="btn btn--approve" disabled={busy || listingLocked} onClick={() => void settle('approve')}>
              批准上架
            </button>
            <button className="btn btn--reject" disabled={busy || listingLocked} onClick={() => void settle('reject')}>
              驳回
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
