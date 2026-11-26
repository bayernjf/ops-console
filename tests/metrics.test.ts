import { describe, it, expect } from 'vitest';
import {
  buildOpsConsoleMetricsSnapshot,
  renderPrometheusMetrics,
} from '../src/server/metrics.js';
import type { DeliveryRecord } from '../src/server/notify/types.js';

const base = {
  grade: 'D2',
  attempts: 1,
  deepLink: 'https://example.com/app/approvals/dec-1',
};

const deliveries: DeliveryRecord[] = [
  { ...base, decisionId: 'dec-1', event: 'pending', status: 'delivered' },
  { ...base, decisionId: 'dec-2', event: 'timeout', status: 'failed', error: 'secret-adjacent text' },
  { ...base, decisionId: 'dec-3', event: 'escalation', status: 'delivered' },
  { ...base, decisionId: 'dec-4', event: 'pending', status: 'failed' },
];

describe('ops-console metrics', () => {
  it('aggregates notify deliveries by event and status without identifiers', () => {
    const snapshot = buildOpsConsoleMetricsSnapshot(deliveries, new Date('2026-11-27T00:00:00.000Z'), 30);

    expect(snapshot.uptimeSeconds).toBe(30);
    expect(snapshot.notifyDeliveriesTotal).toBe(4);
    expect(snapshot.notifyDeliveries['pending|delivered']).toBe(1);
    expect(snapshot.notifyDeliveries['timeout|failed']).toBe(1);
    expect(snapshot.notifyDeliveries['escalation|delivered']).toBe(1);
    expect(snapshot.notifyDeliveries['pending|failed']).toBe(1);
    expect(snapshot.notifyDeliveries['pending|pending']).toBe(0);

    const text = renderPrometheusMetrics(snapshot);
    expect(text).toContain('ops_console_up 1');
    expect(text).toContain('ops_console_uptime_seconds 30');
    expect(text).toContain('ops_console_notify_deliveries{event="pending",status="delivered"} 1');
    expect(text).toContain('ops_console_notify_deliveries_total 4');
    expect(text).not.toContain('dec-1');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('secret-adjacent');
  });

  it('starts from a zeroed ledger for an empty delivery list', () => {
    const snapshot = buildOpsConsoleMetricsSnapshot([], new Date('2026-11-27T00:00:00.000Z'));

    expect(snapshot.notifyDeliveriesTotal).toBe(0);
    for (const value of Object.values(snapshot.notifyDeliveries)) {
      expect(value).toBe(0);
    }

    const text = renderPrometheusMetrics(snapshot);
    expect(text).toContain('ops_console_up 1');
    expect(text).toContain('ops_console_notify_deliveries_total 0');
  });
});
