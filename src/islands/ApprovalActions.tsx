import { useState } from 'react';
import type { DecisionRecord, Grade } from '../server/upstream/types';

/**
 * Approve / reject island (Tier0 M8 §3.1). The server re-checks RBAC and
 * injects the approver — this island is only the UI; a bypassed client call
 * still receives 403 FORBIDDEN for operator on D3.
 */

interface Props {
  decision: DecisionRecord;
  role: 'owner' | 'operator';
}

const PENDING_STATUSES = new Set(['awaiting_approval', 'blocked']);

export default function ApprovalActions({ decision, role }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const pending = PENDING_STATUSES.has(decision.status);
  const grade: Grade = decision.grade;
  // Server-side truth, mirrored here for UX only.
  const allowed = role === 'owner' || grade === 'D1' || grade === 'D2';
  const locked = pending && !allowed;

  async function submit(verdict: 'approve' | 'reject'): Promise<void> {
    setBusy(verdict);
    setFailed(false);
    try {
      const res = await fetch(`/api/approvals/${decision.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision: verdict, ...(comment ? { comment } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body as { error?: { code?: string } } | undefined)?.error?.code;
        throw new Error(`${res.status} ${code ?? ''} — ${(body as { error?: { message?: string } } | undefined)?.error?.message ?? 'upstream error'}`);
      }
      const settled = body as { status?: string; grade?: string; decisionId?: string };
      setMessage(
        `已提交${verdict === 'approve' ? '批准' : '驳回'}：zeus 返回 status=${settled.status ?? '?'} grade=${settled.grade ?? '?'}。页面即将刷新…`,
      );
      // Refresh after the action so the settled record is shown.
      window.setTimeout(() => window.location.reload(), 900);
    } catch (thrown) {
      setFailed(true);
      setMessage(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(null);
    }
  }

  if (!pending) {
    return (
      <div className="approval-actions">
        <p className="settled-note">
          当前状态 <code>{decision.status}</code>
          {decision.result ? ` · 结果 ${decision.result.outcome}${decision.result.approver ? ` by ${decision.result.approver}` : ''}` : ''}
          ，该决策已结案，无需操作。
        </p>
      </div>
    );
  }

  return (
    <div className="approval-actions">
      <label className="comment-label" htmlFor="approval-comment">
        审批备注（可选）
      </label>
      <textarea
        id="approval-comment"
        className="comment-input"
        rows={3}
        placeholder={locked ? '' : '填写批准 / 驳回理由，记入 zeus 审批链'}
        value={comment}
        disabled={locked}
        onChange={(e) => setComment(e.target.value)}
      />
      {locked ? (
        <p className="lock-note">
          <span className="grade grade--d3">D3</span>
          该决策为 D3（human-led），operator 无审批权限，仅 owner 可操作。
          （前端绕过此按钮时，服务端仍会返回 403 FORBIDDEN。）
        </p>
      ) : null}
      <div className="action-row">
        <button
          className="btn btn--approve"
          disabled={!allowed || busy !== null}
          onClick={() => void submit('approve')}
        >
          {busy === 'approve' ? '提交中…' : '批准'}
        </button>
        <button
          className="btn btn--reject"
          disabled={!allowed || busy !== null}
          onClick={() => void submit('reject')}
        >
          {busy === 'reject' ? '提交中…' : '驳回'}
        </button>
      </div>
      {message ? (
        <p className={failed ? 'action-failed' : 'action-ok'} role={failed ? 'alert' : 'status'}>{message}</p>
      ) : null}
    </div>
  );
}
