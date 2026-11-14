import { mkdtempSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backup, pruneSnapshots, sha256, STORES } from '../scripts/backup-ops-console';

// D1-1: ops-console's durable state is append-only JSONL (no SQLite). The
// snapshot must copy every store, verify it, and fail loudly rather than keep
// an unverifiable directory that a restore would trust.

const NOW = new Date('2026-11-14T06:30:00Z');

function seedStores(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STORES[0]!), '{"id":"d1"}\n{"id":"d2"}\n');
  writeFileSync(join(dir, STORES[1]!), '{"id":"e1"}\n');
}

describe('ops-console durable-state backup (D1-1)', () => {
  it('snapshots both stores with a verified manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'ops-backup-'));
    const dataDir = join(root, 'data');
    seedStores(dataDir);
    const result = backup({ dataDir, backupDir: join(root, 'backups'), now: NOW });

    expect(result.manifest.stores.map(s => s.name)).toEqual(STORES);
    const byName = Object.fromEntries(result.manifest.stores.map(s => [s.name, s]));
    expect(byName[STORES[0]!]!.lines).toBe(2);
    expect(byName[STORES[1]!]!.lines).toBe(1);
    expect(byName[STORES[0]!]!.sha256).toBe(sha256(readFileSync(join(dataDir, STORES[0]!))));
    // The snapshot content is readable back and equals the source.
    expect(readFileSync(join(result.dir, STORES[0]!), 'utf8')).toBe(readFileSync(join(dataDir, STORES[0]!), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(result.dir, 'manifest.json'), 'utf8'));
    expect(manifest.createdAt).toBe(NOW.toISOString());
  });

  it('fails loudly when no store exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'ops-backup-empty-'));
    expect(() => backup({ dataDir: join(root, 'missing'), backupDir: join(root, 'backups'), now: NOW }))
      .toThrow(/no durable stores found/);
  });

  it('prunes snapshots past the retention window and keeps fresh ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'ops-backup-prune-'));
    const backups = join(root, 'backups');
    const oldDir = join(backups, 'ops-console-old');
    const freshDir = join(backups, 'ops-console-fresh');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    const old = new Date('2026-10-01T00:00:00Z');
    utimesSync(oldDir, old, old);

    const removed = pruneSnapshots(backups, 7, NOW.getTime());
    expect(removed).toEqual(['ops-console-old']);
    expect(() => readFileSync(join(freshDir, 'missing'), 'utf8')).toThrow();
  });

  it('defaults retention to 14 days (tier0 daily window)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ops-backup-default-'));
    const dataDir = join(root, 'data');
    const backups = join(root, 'backups');
    seedStores(dataDir);
    // First snapshot, backdated 10 days (inside the 14-day default, outside
    // the old 7-day window).
    const firstRun = new Date('2026-11-04T06:30:00Z');
    backup({ dataDir, backupDir: backups, now: firstRun });
    const [snapshot] = readdirSync(backups);
    const tenDaysAgo = new Date('2026-11-04T06:30:00Z');
    const snapshotPath = join(backups, snapshot!);
    utimesSync(snapshotPath, tenDaysAgo, tenDaysAgo);
    // A second, current run applies default retention. A 7-day default would
    // prune the 10-day snapshot; the 14-day default must keep it.
    const result = backup({ dataDir, backupDir: backups, now: NOW });
    expect(result.pruned).toEqual([]);
  });
});
