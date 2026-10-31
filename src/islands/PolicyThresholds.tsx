import { useMemo, useState } from 'react';
import type { DecisionPolicy, Grade } from '../server/upstream/types';

/**
 * Policy thresholds island (Tier0 M8 §3.1). Reading is open to every signed-in
 * role; writing is owner-only — operator sees disabled inputs and an explicit
 * note. The server enforces owner-only again on PUT (operator -> 403).
 */

interface Props {
  policy: DecisionPolicy;
  role: 'owner' | 'operator';
}

interface AmountMatch {
  min?: number;
  max?: number;
  currency?: string;
}

function amountOf(rule: DecisionPolicy['rules'][number] | undefined): AmountMatch {
  if (!rule || typeof rule.match !== 'object' || rule.match === null) return {};
  const amount = (rule.match as { amount?: AmountMatch }).amount;
  return typeof amount === 'object' && amount !== null ? amount : {};
}

export default function PolicyThresholds({ policy, role }: Props) {
  const canWrite = role === 'owner';
  const d1Rule = useMemo(() => policy.rules.find((r) => r.id === 'd1-amount'), [policy.rules]);
  const d2Rule = useMemo(() => policy.rules.find((r) => r.id === 'd2-amount'), [policy.rules]);

  const [d1Max, setD1Max] = useState<string>(String(amountOf(d1Rule).max ?? ''));
  const [d2Max, setD2Max] = useState<string>(String(amountOf(d2Rule).max ?? ''));
  const [defaultGrade, setDefaultGrade] = useState<Grade>(policy.defaultGrade);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      const body: { d1MaxAmount?: number; d2MaxAmount?: number; defaultGrade?: Grade } = {};
      if (d1Max.trim() !== '') body.d1MaxAmount = Number(d1Max);
      if (d2Max.trim() !== '') body.d2MaxAmount = Number(d2Max);
      body.defaultGrade = defaultGrade;
      const res = await fetch('/api/policy/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await res.json()) as DecisionPolicy & { error?: { code?: string; message?: string } };
      if (!res.ok) {
        throw new Error(`${res.status} ${result.error?.code ?? ''} — ${result.error?.message ?? 'upstream error'}`);
      }
      setMessage(`阈值已更新（policy version=${result.version}），已透传 zeus。`);
    } catch (thrown) {
      setFailed(true);
      setMessage(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="policy-thresholds">
      <h3>审批阈值（zeus policy v{policy.version}）</h3>
      <p className="policy-note">
        当前规则快照原样来自 zeus <code>GET /api/v1/policy</code>：
        D1 上限 ¥{String(amountOf(d1Rule).max ?? '—')}，D2 区间
        ¥{String(amountOf(d2Rule).min ?? '—')}–¥{String(amountOf(d2Rule).max ?? '—')}，
        默认级别 {policy.defaultGrade}。
      </p>
      {!canWrite ? (
        <p className="lock-note">
          当前角色 operator：阈值为 owner-only，以下字段只读禁用。（前端绕过调用
          <code>PUT /api/policy/thresholds</code> 时，服务端仍返回 403 FORBIDDEN。）
        </p>
      ) : null}
      <div className="threshold-form">
        <label>
          D1 最大金额（CNY）
          <input value={d1Max} disabled={!canWrite || busy} onChange={(e) => setD1Max(e.target.value)} />
        </label>
        <label>
          D2 最大金额（CNY）
          <input value={d2Max} disabled={!canWrite || busy} onChange={(e) => setD2Max(e.target.value)} />
        </label>
        <label>
          默认级别
          <select value={defaultGrade} disabled={!canWrite || busy} onChange={(e) => setDefaultGrade(e.target.value as Grade)}>
            {(['D0', 'D1', 'D2', 'D3'] as Grade[]).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn--primary" disabled={!canWrite || busy} onClick={() => void save()}>
          {busy ? '提交中…' : '保存阈值（owner）'}
        </button>
      </div>
      {message ? (
        <p className={failed ? 'action-failed' : 'action-ok'} role={failed ? 'alert' : 'status'}>{message}</p>
      ) : null}
    </div>
  );
}
