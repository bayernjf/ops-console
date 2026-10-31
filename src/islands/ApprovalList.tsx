import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecisionRecord, Grade } from '../server/upstream/types';
import { describeSla, humanizeMs } from '../server/sla';

/**
 * Approval workbench list island (Tier0 M8 §3.1). Polls the same-origin
 * /api/approvals endpoint every 20s (clamped 15–30s), offers a manual
 * refresh, and reloads after every approval action. No SSE / WebSocket.
 * All data comes from the API; no upstream token is ever present client-side.
 */

interface Props {
  initial: DecisionRecord[];
  refreshMs: number;
}

type Filter = 'all' | Grade;

const GRADE_TAG_CLASS: Record<Grade, string> = {
  D0: 'grade grade--d0',
  D1: 'grade grade--d1',
  D2: 'grade grade--d2',
  D3: 'grade grade--d3',
};

function formatAmount(record: DecisionRecord): string {
  if (!record.amount) return '—';
  return `${record.amount.value} ${record.amount.currency}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

export default function ApprovalList({ initial, refreshMs }: Props) {
  const [records, setRecords] = useState<DecisionRecord[]>(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/api/approvals' : `/api/approvals?grade=${encodeURIComponent(filter)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
        return;
      }
      if (!res.ok) {
        throw new Error(`upstream status ${res.status}`);
      }
      const body = (await res.json()) as { decisions: DecisionRecord[] };
      setRecords(body.decisions);
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [filter]);

  // Polling: clamp to the contract interval band 15s–30s.
  useEffect(() => {
    const intervalMs = Math.min(30000, Math.max(15000, refreshMs));
    timerRef.current = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

  // Refetch whenever the grade filter changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = filter === 'all' ? records : records.filter((r) => r.grade === filter);

  return (
    <div className="approval-list">
      <div className="list-toolbar">
        <label className="filter">
          <span>级别</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">全部待办</option>
            <option value="D1">D1</option>
            <option value="D2">D2</option>
            <option value="D3">D3</option>
          </select>
        </label>
        <button className="btn btn--primary" onClick={() => void refresh()} disabled={loading}>
          {loading ? '刷新中…' : '手动刷新'}
        </button>
        <span className="list-meta" aria-live="polite">每 20s 自动刷新 · 共 {visible.length} 条</span>
      </div>
      {error ? <p className="list-error" role="alert">加载失败：{error}（上游不可达时 fail-closed）</p> : null}
      {visible.length === 0 && !error ? (
        <p className="list-empty" role="status">暂无待审批决策（D1 awaiting_approval / D2·D3 blocked）。</p>
      ) : (
        <table className="approval-table">
          <thead>
            <tr>
              <th scope="col">级别</th>
              <th scope="col">快照 intent / domain</th>
              <th scope="col">金额</th>
              <th scope="col">命中规则</th>
              <th scope="col">状态</th>
              <th scope="col">创建时间</th>
              <th scope="col">超时</th>
              <th scope="col">证据</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => {
              const sla = describeSla(record, now);
              return (
              <tr key={record.id}>
                <td>
                  <span className={GRADE_TAG_CLASS[record.grade]}>{record.grade}</span>
                </td>
                <td>
                  <a className="intent-link" href={`/app/approvals/${record.id}`}>
                    <div className="intent">{record.intent}</div>
                    <div className="domain">{record.domain}</div>
                  </a>
                </td>
                <td className="num">{formatAmount(record)}</td>
                <td>
                  <div className="rule">{record.ruleId}</div>
                  <div className="rule-reason">{record.gradeReason}</div>
                </td>
                <td>
                  <span className={`status status--${record.status}`}
                    >{record.status}</span>
                  {sla.state === 'late' ? (
                    <div className="late-tag" title="已过 SLA，仍在宽限期内可审批">
                      宽限中 · 已逾期 {humanizeMs(sla.overdueMs ?? 0)}
                    </div>
                  ) : null}
                  {sla.state === 'timed-out' ? (
                    <div className="timedout-tag">已超时关闭</div>
                  ) : null}
                </td>
                <td className="time">{formatTime(record.createdAt)}</td>
                <td>
                  {sla.state === 'unknown' ? (
                    '—'
                  ) : sla.state === 'late' ? (
                    <span className="overdue">
                      已逾期（{formatTime(sla.timeoutAt!)}）
                    </span>
                  ) : (
                    <span className="time">{formatTime(sla.timeoutAt!)}</span>
                  )}
                </td>
                <td>
                  <a className="btn btn--ghost btn--sm" href={`/app/approvals/${record.id}`}>
                    详情 / replay
                  </a>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
