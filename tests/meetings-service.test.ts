import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/server/config.js';
import { listMeetings, loadMeeting, openClaimIds } from '../src/server/meetings-service.js';

const dirs: string[] = [];

async function dir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'ops-meetings-'));
  dirs.push(path);
  return path;
}

function config(path: string): Config {
  return { meetings: { dir: path } } as unknown as Config;
}

function meeting(id: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    topic: `议题-${id}`,
    createdAt,
    status: 'challenging',
    round: 2,
    maxRounds: 2,
    utterances: [],
    decisions: [],
    ...extra,
  };
}

afterEach(async () => {
  while (dirs.length > 0) {
    const path = dirs.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe('meetings service', () => {
  it('returns an empty list when the store directory does not exist', async () => {
    expect(await listMeetings(config(join(tmpdir(), 'ops-meetings-missing')))).toEqual([]);
  });

  it('lists meetings newest first with counts', async () => {
    const path = await dir();
    await writeFile(join(path, 'm-old.json'), JSON.stringify(meeting('m-old', '2026-11-01T00:00:00.000Z')));
    await writeFile(
      join(path, 'm-new.json'),
      JSON.stringify(meeting('m-new', '2026-11-15T00:00:00.000Z', {
        decisions: [{ id: 'd1', by: 'owner', chosenClaimIds: ['c1'], rejectedClaimIds: [], rationale: 'x', at: '2026-11-15T01:00:00.000Z' }],
      })),
    );
    const items = await listMeetings(config(path));
    expect(items.map(item => item.id)).toEqual(['m-new', 'm-old']);
    expect(items[0]!.decisions).toBe(1);
  });

  it('loads a meeting, returns null when missing, and refuses path-escaping ids', async () => {
    const path = await dir();
    await writeFile(join(path, 'm1.json'), JSON.stringify(meeting('m1', '2026-11-15T00:00:00.000Z')));
    expect((await loadMeeting(config(path), 'm1'))?.topic).toBe('议题-m1');
    expect(await loadMeeting(config(path), 'nope')).toBeNull();
    await expect(loadMeeting(config(path), '../m1')).rejects.toThrow(/invalid meeting id/);
  });

  it('reports claims that were challenged but never decided', async () => {
    const path = await dir();
    await writeFile(join(path, 'm2.json'), JSON.stringify(meeting('m2', '2026-11-15T00:00:00.000Z', {
      utterances: [
        { id: 'u-1', speakerId: 'a', kind: 'agent', round: 1, stance: 'propose', claims: [{ id: 'c1', text: 'x', evidence: [] }, { id: 'c2', text: 'y', evidence: [] }], rebuts: [], at: '2026-11-15T00:00:00.000Z' },
        { id: 'u-2', speakerId: 'b', kind: 'agent', round: 2, stance: 'challenge', claims: [], rebuts: ['c1'], at: '2026-11-15T00:10:00.000Z' },
      ],
    })));
    const doc = await loadMeeting(config(path), 'm2');
    expect(openClaimIds(doc!)).toEqual(['c1']);
  });
});
