/**
 * Pure SLA presentation helper for decisions.
 *
 * The console holds no SLA policy: zeus owns slaHours / lateGraceHours and the
 * actual state machine. This module only *interprets* the record fields zeus
 * already returns, so old kernels that omit `timeoutAt` / `lateAt` degrade
 * gracefully instead of throwing.
 *
 * States for a still-waiting record:
 *  - unknown : no timeoutAt (rule set no slaHours) — render nothing.
 *  - ontime  : waiting and now < timeoutAt.
 *  - late    : pending-but-late — still awaiting_approval/blocked but
 *              now >= timeoutAt, inside the grace window zeus opens.
 *  - timed-out: zeus settled the record as result.outcome = 'timed-out'.
 */
import type { DecisionRecord } from './upstream/types.js';

export type SlaState = 'unknown' | 'ontime' | 'late' | 'timed-out';

export interface SlaView {
  state: SlaState;
  /** ISO timeoutAt when present. */
  timeoutAt?: string;
  /** ISO lateAt when the record entered the pending-but-late window. */
  lateAt?: string;
  /** ms past timeoutAt when late (negative before timeout). */
  overdueMs?: number;
  /** ms inside the grace window since lateAt when late. */
  inGraceMs?: number;
}

function parseIso(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

export function describeSla(record: DecisionRecord, nowMs: number): SlaView {
  if (record.result?.outcome === 'timed-out') {
    return {
      state: 'timed-out',
      ...(record.timeoutAt ? { timeoutAt: record.timeoutAt } : {}),
      ...(record.lateAt ? { lateAt: record.lateAt } : {}),
    };
  }
  const timeoutMs = parseIso(record.timeoutAt);
  if (timeoutMs === undefined) {
    // Old zeus / rules with no slaHours: no SLA on this record at all.
    return {
      state: 'unknown',
      ...(record.lateAt ? { lateAt: record.lateAt } : {}),
    };
  }
  const waiting =
    record.status === 'awaiting_approval' || record.status === 'blocked';
  if (waiting && nowMs >= timeoutMs) {
    const lateMs = parseIso(record.lateAt);
    return {
      state: 'late',
      ...(record.timeoutAt ? { timeoutAt: record.timeoutAt } : {}),
      ...(record.lateAt ? { lateAt: record.lateAt } : {}),
      overdueMs: nowMs - timeoutMs,
      ...(lateMs !== undefined ? { inGraceMs: nowMs - lateMs } : {}),
    };
  }
  return {
    state: 'ontime',
    ...(record.timeoutAt ? { timeoutAt: record.timeoutAt } : {}),
    ...(record.lateAt ? { lateAt: record.lateAt } : {}),
  };
}

/** Human-friendly duration, e.g. "2h15m" / "45s". */
export function humanizeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${sec}s`;
  return `${sec}s`;
}
