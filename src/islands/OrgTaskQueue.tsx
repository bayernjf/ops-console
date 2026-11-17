import { useCallback, useEffect, useState } from 'react';
import AsyncState from '../components/AsyncState';
import type { OrgTask } from '../server/upstream/types';

/**
 * Tier0 org M2 F2.2: read-only task queue island. SSR seeds the first paint and
 * then the island polls GET /api/org/tasks (server-side bearer to zeus; the
 * browser never sees a token). Ordering is owned by the BFF — blocked tasks
 * first — so this component only renders.
 */
const STATUS_LABEL: Record<string, string> = {
  pending: '待派发',
  dispatched: '已派发',
  running: '执行中',
  awaiting_decision: '等待决策',
  done: '已完成',
  failed: '失败',
};

const FAILURE_LABEL: Record<string, string> = {
  business: '业务失败',
  retryable_exhausted: '重试耗尽',
  timeout: '超时',
  tool_denied: '工具越权',
};

export interface OrgTaskQueueProps {
  initial: OrgTask[];
  positionNames: Record<string, string>;
  refreshMs: number;
  organizationId?: string;
}

function humanizeMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

function taskDuration(task: OrgTask): number | undefined {
  if (task.outcome?.durationMs !== undefined) return task.outcome.durationMs;
  const start = Date.parse(task.createdAt);
  const end = Date.parse(task.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

function shortPath(path: string | undefined): string {
  if (!path) return '-';
  const parts = path.split('/');
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

export default function OrgTaskQueue({ initial, positionNames, refreshMs, organizationId }: OrgTaskQueueProps) {
  const [tasks, setTasks] = useState<OrgTask[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
      const response = await fetch(`/api/org/tasks${query}`, { headers: { Accept: 'application/json' } });
      const body = (await response.json()) as {
        tasks?: OrgTask[];
        error?: { message?: string };
        message?: string;
      };
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `HTTP ${response.status}`);
      setTasks(body.tasks ?? []);
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), Math.max(5000, refreshMs));
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  const blocked = tasks.filter(task => task.status === 'awaiting_decision');
  const positionOf = (task: OrgTask): string =>
    (task.positionId ? positionNames[task.positionId] : undefined) ?? task.positionId ?? '-';

  if (error) {
    return <AsyncState error={`${error}（上游不可达时 fail-closed）`} />;
  }

  return (
    <div className="org-queue">
      <p className="list-meta" aria-live="polite">
        共 {tasks.length} 个任务 · 等待决策 {blocked.length} · 每 {Math.round(Math.max(5000, refreshMs) / 1000)}s 自动刷新
        {loading ? ' · 刷新中…' : ''}
      </p>

      {blocked.length > 0 ? (
        <section className="blocked">
          <h2>卡点 · 等待决策（{blocked.length}）</h2>
          <ul>
            {blocked.map(task => (
              <li key={task.id}>
                <span className="mono">{task.title}</span>
                <span className="hint">{positionOf(task)}</span>
                <a className="link" href={`/app/approvals/${task.id}`}>
                  去审批 →
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tasks.length === 0 ? (
        <AsyncState empty emptyText="队列为空：zeus 侧还没有 org 任务。" />
      ) : (
        <div className="table-wrap">
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">任务</th>
                <th scope="col">岗位</th>
                <th scope="col">状态</th>
                <th scope="col">入队时间</th>
                <th scope="col">耗时</th>
                <th scope="col">重试</th>
                <th scope="col">工作区</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr key={task.id}>
                  <td>
                    <span className="mono">{task.title}</span>
                    <span className="hint mono">{task.id}</span>
                  </td>
                  <td>{positionOf(task)}</td>
                  <td>
                    <span className={`tag tag--${task.status}`}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    {task.failedKind ? (
                      <span className="hint"> {FAILURE_LABEL[task.failedKind] ?? task.failedKind}</span>
                    ) : null}
                    {task.error ? <div className="hint ellipsis">{task.error}</div> : null}
                  </td>
                  <td className="mono">{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td className="mono">{humanizeMs(taskDuration(task))}</td>
                  <td className="mono">{task.attempts ?? 0}</td>
                  <td className="mono" title={task.workspacePath ?? ''}>
                    {shortPath(task.workspacePath)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
