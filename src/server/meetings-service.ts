// Read-only view over the local meeting store that zeus writes (`npm run
// meeting` → one JSON per meeting). The console never writes meetings: the owner
// decides in zeus, the console replays what happened.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type MeetingEvidence = { kind: string; ref: string; note?: string };
export type MeetingClaim = { id: string; text: string; evidence: MeetingEvidence[] };
export type MeetingUtterance = {
  id: string;
  speakerId: string;
  kind: string;
  round: number;
  stance: string;
  claims: MeetingClaim[];
  rebuts: string[];
  at: string;
};
export type MeetingDecision = {
  id: string;
  by: string;
  chosenClaimIds: string[];
  rejectedClaimIds: string[];
  rationale: string;
  at: string;
};
export type MeetingDocument = {
  id: string;
  topic: string;
  createdAt: string;
  status: string;
  round: number;
  maxRounds: number;
  utterances: MeetingUtterance[];
  decisions: MeetingDecision[];
};

export type MeetingListItem = {
  id: string;
  topic: string;
  status: string;
  round: number;
  maxRounds: number;
  utterances: number;
  decisions: number;
  updatedAt: string;
};

export function meetingDir(config: Config): string {
  return config.meetings.dir;
}

export async function listMeetings(config: Config): Promise<MeetingListItem[]> {
  const dir = meetingDir(config);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items: MeetingListItem[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const raw = await readFile(join(dir, name), 'utf8');
    const meeting = JSON.parse(raw) as MeetingDocument;
    items.push({
      id: meeting.id,
      topic: meeting.topic,
      status: meeting.status,
      round: meeting.round,
      maxRounds: meeting.maxRounds,
      utterances: meeting.utterances.length,
      decisions: meeting.decisions.length,
      updatedAt: lastTouchedAt(meeting),
    });
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadMeeting(config: Config, id: string): Promise<MeetingDocument | null> {
  if (!ID_RE.test(id)) {
    throw new Error(`invalid meeting id: ${id}`);
  }
  const path = join(meetingDir(config), `${id}.json`);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as MeetingDocument;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Claims that a decision never resolved but that were challenged — the open questions. */
export function openClaimIds(meeting: MeetingDocument): string[] {
  const decided = new Set(
    meeting.decisions.flatMap(decision => [...decision.chosenClaimIds, ...decision.rejectedClaimIds]),
  );
  const rebutted = new Set(meeting.utterances.flatMap(utterance => utterance.rebuts));
  return meeting.utterances
    .flatMap(utterance => utterance.claims)
    .map(claim => claim.id)
    .filter(id => !decided.has(id) && rebutted.has(id));
}

function lastTouchedAt(meeting: MeetingDocument): string {
  const stamps = [
    meeting.createdAt,
    ...meeting.utterances.map(utterance => utterance.at),
    ...meeting.decisions.map(decision => decision.at),
  ].filter(stamp => typeof stamp === 'string' && stamp.length > 0);
  return stamps.sort().at(-1) ?? meeting.createdAt;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
