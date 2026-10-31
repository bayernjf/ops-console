import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type {
  TraceQueryResult,
  TraceSpan,
  TraceSummary,
  TraceTree,
} from '../server/upstream/types';
import { humanizeMs } from '../server/sla';

/**
 * Trace explorer island (Tier0 M2 W2-5, TracePort v1 §5 / D-5). Owner-only
 * read-only view over zeus GET /api/v1/traces via the same-origin /api/traces
 * BFF endpoint (the server enforces the owner gate again; operator -> 403).
 * Polls every 20s (clamped 15–30s) + manual refresh + filter form. No SSE /
 * WebSocket (CONTRACT freeze), no local storage, no client-side secrets.
 */

interface Props {
  initial: TraceQueryResult;
  refreshMs: number;
}

interface FilterState {
  agent: string;
  from: string;
  to: string;
  minCost: string;
  maxCost: string;
  traceId: string;
  limit: string;
}

const EMPTY_FILTERS: FilterState = {
  agent: '',
  from: '',
  to: '',
  minCost: '',
  maxCost: '',
  traceId: '',
  limit: '',
};

interface SpanNode {
  span: TraceSpan;
  depth: number;
}

/** zeus queryTraceTrees semantics mirrored client-side (§5: 总耗时/总成本/错误数). */
function summarizeTree(tree: TraceTree): TraceSummary {
  const summary: TraceSummary = { totalLatencyMs: 0, totalCostMicros: 0, errorCount: 0 };
  for (const span of tree.spans) {
    const call = span.call;
    if (call === undefined) continue;
    summary.totalLatencyMs += call.latencyMs ?? 0;
    if (typeof call.costMicros === 'number') summary.totalCostMicros += call.costMicros;
    if (call.error !== undefined) summary.errorCount += 1;
  }
  return summary;
}

/** tree.spans is flat (zeus buildTraceTree); re-nest it for display. */
function flattenTree(tree: TraceTree): SpanNode[] {
  const childrenByParent = new Map<string, TraceSpan[]>();
  for (const span of tree.spans) {
    const key = span.parentSpanId ?? tree.root.spanId;
    const siblings = childrenByParent.get(key);
    if (siblings) siblings.push(span);
    else childrenByParent.set(key, [span]);
  }
  const out: SpanNode[] = [{ span: tree.root, depth: 0 }];
  const walk = (parentId: string, depth: number): void => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      out.push({ span: child, depth });
      walk(child.spanId, depth + 1);
    }
  };
  walk(tree.root.spanId, 1);
  return out;
}

function spanName(span: TraceSpan): string {
  if (span.kind === 'model' && span.call) return `${span.call.backend} / ${span.call.model}`;
  if (span.kind === 'decision-step' && span.step) return span.step.name;
  if (span.kind === 'branch' || span.kind === 'dag-node') return span.vassal ?? span.skill ?? span.spanId;
  if (span.kind === 'tool') return span.skill ?? span.spanId;
  return span.outcome ?? span.realm ?? span.skill ?? span.spanId;
}

function spanLatencyMs(span: TraceSpan): number | undefined {
  if (span.call?.latencyMs !== undefined) return span.call.latencyMs;
  if (span.step?.latencyMs !== undefined) return span.step.latencyMs;
  if (span.startedAt && span.endedAt) {
    const start = Date.parse(span.startedAt);
    const end = Date.parse(span.endedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  }
  return undefined;
}

function agentsOf(tree: TraceTree): string {
  const agents = new Set<string>();
  if (tree.root.vassal) agents.add(tree.root.vassal);
  for (const span of tree.spans) {
    if (span.vassal) agents.add(span.vassal);
  }
  return agents.size > 0 ? [...agents].join(', ') : '—';
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

/** cost_micros stays the family unit (hub-shared); grouped digits, no invented currency. */
function formatMicros(micros: number): string {
  return micros.toLocaleString('en-US');
}

/** datetime-local value -> UTC ISO string for the zeus from/to window. */
function isoOrNull(value: string): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function buildQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.agent.trim()) params.set('agent', filters.agent.trim());
  const from = isoOrNull(filters.from);
  if (from) params.set('from', from);
  const to = isoOrNull(filters.to);
  if (to) params.set('to', to);
  if (filters.minCost.trim()) params.set('min_cost_micros', filters.minCost.trim());
  if (filters.maxCost.trim()) params.set('max_cost_micros', filters.maxCost.trim());
  if (filters.traceId.trim()) params.set('trace_id', filters.traceId.trim());
  if (filters.limit.trim()) params.set('limit', filters.limit.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function TraceExplorer({ initial, refreshMs }: Props) {
  const [result, setResult] = useState<TraceQueryResult>(initial);
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/traces${buildQuery(applied)}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401) {
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        throw new Error(
          `${res.status} ${body?.error?.code ?? ''} — ${body?.error?.message ?? 'upstream error'}`,
        );
      }
      const body = (await res.json()) as TraceQueryResult;
      setResult(body);
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setLoading(false);
    }
  }, [applied]);

  // Polling: clamp to the contract interval band 15s–30s. No SSE / WebSocket.
  useEffect(() => {
    const intervalMs = Math.min(30000, Math.max(15000, refreshMs));
    timerRef.current = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

  // Refetch whenever the applied filter set changes (including on mount).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  function applyFilters(event: { preventDefault(): void }): void {
    event.preventDefault();
    setApplied(draft);
  }

  function resetFilters(): void {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  const summary = result.summary;

  return (
    <div className="trace-explorer">
      <form className="trace-filters" onSubmit={applyFilters}>
        <label>
          Agent
          <input
            type="text"
            value={draft.agent}
            placeholder="如 atlas（span 内 vassal 名）"
            onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
          />
        </label>
        <label>
          起始时间
          <input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          截止时间
          <input
            type="datetime-local"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          最小成本（micros）
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft.minCost}
            onChange={(e) => setDraft({ ...draft, minCost: e.target.value })}
          />
        </label>
        <label>
          最大成本（micros）
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft.maxCost}
            onChange={(e) => setDraft({ ...draft, maxCost: e.target.value })}
          />
        </label>
        <label>
          Trace ID
          <input
            type="text"
            value={draft.traceId}
            placeholder="精确匹配 runId"
            onChange={(e) => setDraft({ ...draft, traceId: e.target.value })}
          />
        </label>
        <label>
          条数上限
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            step={1}
            placeholder="50（zeus 上限 200）"
            value={draft.limit}
            onChange={(e) => setDraft({ ...draft, limit: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? '查询中…' : '查询'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={resetFilters}>
          重置
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? '刷新中…' : '手动刷新'}
        </button>
      </form>

      <p className="list-meta" aria-live="polite">
        每 {Math.round(Math.min(30000, Math.max(15000, refreshMs)) / 1000)}s 自动刷新 · 命中{' '}
        {summary.count} 条 · 模型调用总耗时 {humanizeMs(summary.totalLatencyMs)} · 总成本{' '}
        {formatMicros(summary.totalCostMicros)} micros · 错误 {summary.errorCount} 次
      </p>

      {error ? (
        <p className="list-error" role="alert">
          加载失败：{error}（上游不可达时 fail-closed）
        </p>
      ) : null}

      {result.traces.length === 0 && !error ? (
        <p className="list-empty" role="status">
          当前过滤条件下没有 trace：zeus 尚未导出（需开启 ZEUS_DECISION_TRACE_FILE）或不匹配过滤条件。
        </p>
      ) : (
        <div className="table-wrap">
          <table className="trace-table">
            <thead>
              <tr>
                <th scope="col">Trace ID</th>
                <th scope="col">Agent</th>
                <th scope="col">开始时间</th>
                <th scope="col">总耗时</th>
                <th scope="col">总成本（micros）</th>
                <th scope="col">错误</th>
                <th scope="col">Span 树</th>
              </tr>
            </thead>
            <tbody>
              {result.traces.map((tree) => {
                const perTree = summarizeTree(tree);
                const expanded = expandedId === tree.traceId;
                const panelId = `trace-panel-${tree.traceId}`;
                return (
                  <Fragment key={tree.traceId}>
                    <tr>
                      <td className="mono">
                        <code>{tree.traceId}</code>
                      </td>
                      <td>{agentsOf(tree)}</td>
                      <td className="time">{formatTime(tree.root.startedAt)}</td>
                      <td className="num">{humanizeMs(perTree.totalLatencyMs)}</td>
                      <td className="num" title="cost_micros：与 model-hub 同单位（1 micros = 1e-6 主单位）">
                        {formatMicros(perTree.totalCostMicros)}
                      </td>
                      <td className={perTree.errorCount > 0 ? 'error-cell' : 'num'}>
                        {perTree.errorCount > 0 ? (
                          <span className="span-error">{perTree.errorCount}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          onClick={() => setExpandedId(expanded ? null : tree.traceId)}
                        >
                          {expanded ? '收起' : '展开'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="trace-detail-row" id={panelId}>
                        <td colSpan={7}>
                          <ul className="span-tree">
                            {flattenTree(tree).map((node, index) => {
                              const span = node.span;
                              const latency = spanLatencyMs(span);
                              return (
                                <li
                                  key={`${span.spanId}-${index}`}
                                  className={`span-node span-node--${span.kind}`}
                                  style={{ marginLeft: node.depth * 16 }}
                                >
                                  <div className="span-line">
                                    <span className={`span-kind span-kind--${span.kind}`}>
                                      {span.kind}
                                    </span>
                                    <span className="span-name">{spanName(span)}</span>
                                    {latency !== undefined ? (
                                      <span className="span-latency">{humanizeMs(latency)}</span>
                                    ) : null}
                                    {span.call?.error ? (
                                      <span className="span-error">{span.call.error}</span>
                                    ) : null}
                                  </div>
                                  {span.call ? (
                                    <div className="span-meta">
                                      tokens {span.call.tokensIn ?? '?'}/{span.call.tokensOut ?? '?'}
                                      {span.call.tokensEstimated ? '（估算）' : ''}
                                      {typeof span.call.costMicros === 'number'
                                        ? ` · ${formatMicros(span.call.costMicros)} micros`
                                        : ''}
                                    </div>
                                  ) : null}
                                  {span.step?.conclusion ? (
                                    <div className="span-meta">{span.step.conclusion}</div>
                                  ) : null}
                                  {span.summary ? (
                                    <div className="span-meta">{span.summary}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
