/**
 * SLA presentation helper tests.
 *
 * Backward-compatibility focus: old zeus kernels omit timeoutAt/lateAt, and
 * new kernels add a pending-but-late window. The helper must never throw on
 * missing fields and must classify the record correctly.
 */
import { describe, expect, it } from 'vitest';
import { describeSla, humanizeMs } from '../src/server/sla.js';
import type { DecisionRecord } from '../src/server/upstream/types.js';

function base(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'dec_x',
    intent: 'refund',
    domain: 'commerce.refund',
    impact: 'team',
    reversibility: 'reversible',
    grade: 'D2',
    mode: 'approve-sync',
    status: 'blocked',
    ruleId: 'd2-amount',
    gradeReason: 'x',
    policyVersion: 1,
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
    auditSeq: 0,
    approvals: [],
    ...over,
  };
}

const NOW = Date.parse('2026-10-26T12:00:00.000Z');

describe('describeSla', () => {
  it('unknown when timeoutAt absent (old zeus / no slaHours) — safe skip', () => {
    const v = describeSla(base(), NOW);
    expect(v.state).toBe('unknown');
    expect(v.timeoutAt).toBeUndefined();
  });

  it('ontime while waiting and before timeoutAt', () => {
    const v = describeSla(base({ timeoutAt: '2026-10-26T13:00:00.000Z' }), NOW);
    expect(v.state).toBe('ontime');
  });

  it('late when still pending but now >= timeoutAt, computes overdue/grace ms', () => {
    const v = describeSla(
      base({
        status: 'blocked',
        timeoutAt: '2026-10-26T11:00:00.000Z',
        lateAt: '2026-10-26T11:00:00.000Z',
      }),
      NOW,
    );
    expect(v.state).toBe('late');
    expect(v.overdueMs).toBe(60 * 60_000);
    expect(v.inGraceMs).toBe(60 * 60_000);
  });

  it('late tolerates missing lateAt even after timeoutAt (older kernel)', () => {
    const v = describeSla(base({ timeoutAt: '2026-10-26T11:00:00.000Z' }), NOW);
    expect(v.state).toBe('late');
    expect(v.lateAt).toBeUndefined();
    expect(v.inGraceMs).toBeUndefined();
  });

  it('timed-out when zeus settled result.outcome', () => {
    const v = describeSla(
      base({
        status: 'rejected',
        result: { outcome: 'timed-out', at: '2026-10-26T12:00:00.000Z' },
      }),
      NOW,
    );
    expect(v.state).toBe('timed-out');
  });

  it('decided records are not flagged late even after timeoutAt', () => {
    const v = describeSla(
      base({ status: 'decided', timeoutAt: '2026-10-26T11:00:00.000Z' }),
      NOW,
    );
    expect(v.state).toBe('ontime');
  });
});

describe('humanizeMs', () => {
  it('formats hours/minutes/seconds', () => {
    expect(humanizeMs(90_000)).toBe('1m30s');
    expect(humanizeMs(60 * 60_000 + 9 * 60_000)).toBe('1h9m');
    expect(humanizeMs(-5)).toBe('—');
  });
});
