import type { DeliveryRecord, NotifyEvent, DeliveryStatus } from './notify/types.js';

/**
 * Read-only metrics for the Tier0 collector.
 *
 * ops-console holds no business database; its only durable local state is the
 * notification delivery ledger. The snapshot is reduced to bounded counts and
 * never includes decision ids, deep links, webhook URLs or error text.
 */

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

const NOTIFY_EVENTS: readonly NotifyEvent[] = ['pending', 'timeout', 'escalation', 'channel_failure'];
const DELIVERY_STATUSES: readonly DeliveryStatus[] = ['delivered', 'pending', 'failed'];

export interface OpsConsoleMetricsSnapshot {
  capturedAt: string;
  uptimeSeconds: number;
  notifyDeliveries: Record<string, number>;
  notifyDeliveriesTotal: number;
}

function deliveryKey(event: string, status: string): string {
  return `${event}|${status}`;
}

export function buildOpsConsoleMetricsSnapshot(
  deliveries: DeliveryRecord[],
  now = new Date(),
  uptimeSeconds = process.uptime(),
): OpsConsoleMetricsSnapshot {
  const notifyDeliveries: Record<string, number> = {};
  for (const event of NOTIFY_EVENTS) {
    for (const status of DELIVERY_STATUSES) {
      notifyDeliveries[deliveryKey(event, status)] = 0;
    }
  }

  let notifyDeliveriesTotal = 0;
  for (const record of deliveries) {
    if (!NOTIFY_EVENTS.includes(record.event) || !DELIVERY_STATUSES.includes(record.status)) {
      continue;
    }
    const key = deliveryKey(record.event, record.status);
    notifyDeliveries[key] = (notifyDeliveries[key] ?? 0) + 1;
    notifyDeliveriesTotal += 1;
  }

  return {
    capturedAt: now.toISOString(),
    uptimeSeconds: Math.max(0, Math.floor(uptimeSeconds)),
    notifyDeliveries,
    notifyDeliveriesTotal,
  };
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labels(pairs: ReadonlyArray<readonly [string, string]>): string {
  if (pairs.length === 0) return '';
  return `{${pairs.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
}

class Family {
  private readonly samples: string[] = [];

  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly type: 'gauge' | 'counter',
  ) {}

  add(value: number, pairs: ReadonlyArray<readonly [string, string]> = []): void {
    if (!Number.isFinite(value)) return;
    this.samples.push(`${this.name}${labels(pairs)} ${value}`);
  }

  render(): string {
    if (this.samples.length === 0) return '';
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n${this.samples.join('\n')}\n`;
  }
}

export function renderPrometheusMetrics(snapshot: OpsConsoleMetricsSnapshot): string {
  const blocks: string[] = [];
  const push = (family: Family): void => {
    const text = family.render();
    if (text) blocks.push(text);
  };

  const up = new Family(
    'ops_console_up',
    'Always 1 while the ops-console runtime serves a metrics snapshot.',
    'gauge',
  );
  up.add(1);
  push(up);

  const uptime = new Family('ops_console_uptime_seconds', 'Process uptime in seconds.', 'gauge');
  uptime.add(snapshot.uptimeSeconds);
  push(uptime);

  const captured = new Family(
    'ops_console_metrics_snapshot_timestamp_seconds',
    'Unix time the snapshot was captured; a stale value means the aggregation stopped advancing.',
    'gauge',
  );
  captured.add(Date.parse(snapshot.capturedAt) / 1000);
  push(captured);

  const deliveries = new Family(
    'ops_console_notify_deliveries',
    'Notification delivery ledger rows, by event and delivery status.',
    'gauge',
  );
  for (const [key, value] of Object.entries(snapshot.notifyDeliveries)) {
    const parts = key.split('|');
    const event = parts[0] ?? '';
    const status = parts[1] ?? '';
    deliveries.add(value, [
      ['event', event],
      ['status', status],
    ]);
  }
  push(deliveries);

  const deliveriesTotal = new Family(
    'ops_console_notify_deliveries_total',
    'Total notification delivery ledger rows.',
    'gauge',
  );
  deliveriesTotal.add(snapshot.notifyDeliveriesTotal);
  push(deliveriesTotal);

  return blocks.join('\n');
}
