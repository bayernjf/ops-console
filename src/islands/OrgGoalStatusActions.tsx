import { useState } from 'react';
import type { ConsoleGoalStatus, OrgGoalStatus } from '../server/upstream/types.js';

export interface OrgGoalStatusActionsProps {
  goalId: string;
  status: OrgGoalStatus;
}

interface Action {
  label: string;
  next: ConsoleGoalStatus;
  tone: 'default' | 'approve';
}

const ACTIONS: Record<OrgGoalStatus, Action[]> = {
  active: [
    { label: '暂停', next: 'paused', tone: 'default' },
    { label: '归档', next: 'archived', tone: 'default' },
  ],
  paused: [
    { label: '恢复', next: 'active', tone: 'approve' },
    { label: '归档', next: 'archived', tone: 'default' },
  ],
  archived: [{ label: '恢复', next: 'active', tone: 'approve' }],
  done: [{ label: '归档', next: 'archived', tone: 'default' }],
};

/**
 * Tier0 org M5 status transitions: pause/resume/archive only. The island
 * PATCHes /api/org/goals/:id with `{ status }` and reloads so the SSR table
 * re-reads zeus. Other goal edits stay intentionally unavailable here.
 */
export default function OrgGoalStatusActions({ goalId, status }: OrgGoalStatusActionsProps) {
  const actions = ACTIONS[status] ?? [];
  const [busy, setBusy] = useState<ConsoleGoalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(next: ConsoleGoalStatus): Promise<void> {
    if (busy) return;
    setBusy(next);
    setError(null);
    try {
      const response = await fetch(`/api/org/goals/${encodeURIComponent(goalId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? `状态更新失败（${response.status}）`);
      }
      window.location.reload();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) {
    return <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>—</span>;
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {actions.map(action => (
        <button
          key={action.next}
          className={`btn btn--sm ${action.tone === 'approve' ? 'btn--approve' : 'btn--ghost'}`}
          type="button"
          disabled={busy !== null}
          onClick={() => void transition(action.next)}
        >
          {busy === action.next ? '处理中…' : action.label}
        </button>
      ))}
      {error ? (
        <span role="alert" style={{ color: 'var(--alert)', fontSize: 12 }}>{error}</span>
      ) : null}
    </div>
  );
}
