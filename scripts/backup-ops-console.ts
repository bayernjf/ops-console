#!/usr/bin/env node
/**
 * Durable-state backup for ops-console (D1-1: this was the only Tier0 project
 * without a backup path; commerce-os / growth-os / agent-dev already have one).
 *
 * ops-console keeps no SQLite database. Its durable state is two append-only
 * JSONL stores configured by OPS_NOTIFY_STORE_FILE and OPS_DECISION_WEBHOOK_LOG:
 *
 *   - notify-deliveries.jsonl       notification delivery ledger
 *   - inbound-decision-events.jsonl decision webhook log
 *
 * Losing them loses the delivery/decision history the console renders, so each
 * snapshot copies every store, verifies it by re-reading the line count and
 * SHA-256, writes manifest.json, then prunes snapshots older than the retention
 * window. A missing source, a short copy or a digest mismatch exits 1 with
 * FAILED — a backup that cannot prove itself must not look like a good one.
 *
 * Env:
 *   OPS_DATA_DIR      source directory (default ./data)
 *   BACKUP_DIR        snapshot root (default ./backups)
 *   RETENTION_DAYS    delete snapshots older than N days (default 14; the
 *                     tier0 retention policy keeps 14 daily + 8 weekly, and
 *                     the weekly tier is handled by the shared backup job —
 *                     this single-process pruner only enforces the daily one)
 *
 * Usage:
 *   node --experimental-strip-types scripts/backup-ops-console.ts
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The durable stores this project owns, in manifest order. */
export const STORES = ['notify-deliveries.jsonl', 'inbound-decision-events.jsonl'] as const;

const SNAPSHOT_PREFIX = 'ops-console-';

export type StoreDigest = { bytes: number; lines: number; sha256: string };

export type SnapshotStore = StoreDigest & { name: string };

export type SnapshotManifest = {
  createdAt: string;
  dataDir: string;
  stores: SnapshotStore[];
};

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Read one store and return the facts a manifest and a verification both need. */
export function fileDigest(path: string): StoreDigest {
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  return { bytes: bytes.length, lines, sha256: sha256(bytes) };
}

/** Snapshot directory name for a given instant (no colons: shell-safe). */
export function snapshotName(at: Date): string {
  return `${SNAPSHOT_PREFIX}${at.toISOString().replace(/[:.]/g, '-')}`;
}

/** Delete snapshot directories whose mtime is older than `retentionDays`. */
export function pruneSnapshots(backupDir: string, retentionDays: number, now = Date.now()): string[] {
  if (!existsSync(backupDir) || retentionDays <= 0) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of readdirSync(backupDir)) {
    if (!name.startsWith(SNAPSHOT_PREFIX)) continue;
    const path = join(backupDir, name);
    try {
      if (statSync(path).isDirectory() && statSync(path).mtimeMs < cutoff) {
        rmSync(path, { recursive: true, force: true });
        removed.push(name);
      }
    } catch {
      // A snapshot that cannot be stat'ed is not this run's failure to fix;
      // leave it for the operator instead of deleting blindly.
    }
  }
  return removed;
}

export type BackupOptions = {
  dataDir?: string;
  backupDir?: string;
  retentionDays?: number;
  now?: Date;
};

export type BackupResult = { dir: string; manifest: SnapshotManifest; pruned: string[] };

/** Copy every existing store into a fresh snapshot and verify it. */
export function backup(options: BackupOptions = {}): BackupResult {
  const dataDir = resolve(options.dataDir ?? './data');
  const backupDir = resolve(options.backupDir ?? './backups');
  const retentionDays = options.retentionDays ?? 14;
  const now = options.now ?? new Date();

  const sources = STORES.map(name => join(dataDir, name)).filter(path => existsSync(path));
  if (sources.length === 0) {
    throw new Error(`no durable stores found under ${dataDir} (looked for ${STORES.join(', ')})`);
  }

  mkdirSync(backupDir, { recursive: true });
  const dir = join(backupDir, snapshotName(now));
  mkdirSync(dir, { recursive: false });

  const manifest: SnapshotManifest = { createdAt: now.toISOString(), dataDir, stores: [] };
  try {
    for (const source of sources) {
      const name = source.slice(dataDir.length + 1);
      const before = fileDigest(source);
      const target = join(dir, name);
      copyFileSync(source, target);
      const after = fileDigest(target);
      if (after.bytes !== before.bytes || after.sha256 !== before.sha256 || after.lines !== before.lines) {
        throw new Error(`verification failed for ${name}: source and snapshot differ`);
      }
      manifest.stores.push({ name, bytes: after.bytes, lines: after.lines, sha256: after.sha256 });
    }
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    // A failed snapshot must never survive: it would look restorable.
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  const pruned = pruneSnapshots(backupDir, retentionDays, now.getTime());
  return { dir, manifest, pruned };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = backup({
      dataDir: process.env.OPS_DATA_DIR ?? './data',
      backupDir: process.env.BACKUP_DIR ?? './backups',
      retentionDays: Number(process.env.RETENTION_DAYS ?? '14'),
    });
    console.log(`backup -> ${result.dir} (${result.manifest.stores.length} store(s))`);
    if (result.pruned.length > 0) console.log(`pruned -> ${result.pruned.join(', ')}`);
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
