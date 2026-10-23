/**
 * Durable delivery store for notifications.
 *
 * Append-only JSONL at OPS_NOTIFY_STORE_FILE. The dedup key is
 * `${decisionId}|${event}`; every record seen on disk is replayed into an
 * in-memory map on load, so a process restart never redelivers the same
 * decisionId+event.
 *
 * The store file lives under data/ which is gitignored — it is operational
 * state, never source.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeliveryRecord, NotifyEvent } from './types.js';

function keyOf(decisionId: string, event: NotifyEvent): string {
  return `${decisionId}|${event}`;
}

export class NotifyStore {
  private readonly keys = new Map<string, DeliveryRecord>();
  private readonly rows: DeliveryRecord[] = [];
  private loaded = false;

  constructor(private readonly file: string) {}

  /** Load prior deliveries from disk. Idempotent; missing file is fine. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) return;
    const text = readFileSync(this.file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as DeliveryRecord;
        if (typeof row.decisionId !== 'string' || typeof row.event !== 'string') continue;
        this.keys.set(keyOf(row.decisionId, row.event), row);
        this.rows.push(row);
      } catch {
        // Skip corrupt lines; never block the poller on a bad row.
      }
    }
  }

  /** True when a delivery for this decisionId+event already exists. */
  seen(decisionId: string, event: NotifyEvent): boolean {
    return this.keys.has(keyOf(decisionId, event));
  }

  /** Insert or update the record for its dedup key; append to the JSONL file. */
  upsert(record: DeliveryRecord): void {
    const k = keyOf(record.decisionId, record.event);
    this.keys.set(k, record);
    const existingIdx = this.rows.findIndex((r) => keyOf(r.decisionId, r.event) === k);
    if (existingIdx >= 0) {
      this.rows[existingIdx] = record;
    } else {
      this.rows.push(record);
    }
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }

  /** Recent deliveries, newest first. */
  list(): DeliveryRecord[] {
    return [...this.rows].reverse();
  }

  /** Test/ops helper: drop all in-memory state (does not unlink the file). */
  reset(): void {
    this.keys.clear();
    this.rows.length = 0;
    this.loaded = false;
  }
}
