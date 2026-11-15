// Thin typed client over zeus Meeting API v1. The console never writes meeting
// JSON: every mutation goes through zeus, which owns the protocol guards.

import { callJson, UpstreamError } from './http.js';
import type { Config } from '../config.js';

export type MeetingEvidence = { kind: string; ref: string; note?: string };
export type MeetingClaim = { id: string; text: string; evidence: MeetingEvidence[] };
export type MeetingUtterance = {
  id: string;
  speakerId: string;
  kind: 'human' | 'agent';
  round: number;
  stance: 'propose' | 'challenge' | 'support' | 'note';
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
export type MeetingSummary = {
  id: string;
  topic: string;
  status: string;
  round: number;
  maxRounds: number;
  utterances: number;
  decisions: number;
  createdAt: string;
};

export type SayInput = {
  speakerId: string;
  stance: MeetingUtterance['stance'];
  claims: Array<{ id?: string; text: string; evidence?: MeetingEvidence[] }>;
  rebuts?: string[];
  kind?: 'human' | 'agent';
};

export class MeetingsUpstream {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async list(): Promise<MeetingSummary[]> {
    const body = await callJson<{ meetings: MeetingSummary[] }>(this.baseUrl, this.token, '/api/v1/meetings');
    return body.meetings;
  }

  async get(id: string): Promise<MeetingDocument> {
    return callJson<MeetingDocument>(this.baseUrl, this.token, `/api/v1/meetings/${encodeURIComponent(id)}`);
  }

  async open(input: { topic: string; maxRounds?: number }): Promise<MeetingDocument> {
    return callJson<MeetingDocument>(this.baseUrl, this.token, '/api/v1/meetings', {
      method: 'POST',
      body: { topic: input.topic, ...(input.maxRounds !== undefined ? { maxRounds: input.maxRounds } : {}) },
    });
  }

  async say(id: string, input: SayInput): Promise<MeetingDocument> {
    return callJson<MeetingDocument>(this.baseUrl, this.token, `/api/v1/meetings/${encodeURIComponent(id)}/utterances`, {
      method: 'POST',
      body: {
        speakerId: input.speakerId,
        kind: input.kind ?? 'human',
        stance: input.stance,
        claims: input.claims.map(claim => ({ ...claim, evidence: claim.evidence ?? [] })),
        rebuts: input.rebuts ?? [],
      },
    });
  }

  /**
   * Markdown minutes. Kept outside callJson because that helper parses JSON;
   * this response is plain text/markdown and goes straight to the browser as a
   * download.
   */
  async markdown(id: string): Promise<string> {
    const url = new URL(`/api/v1/meetings/${encodeURIComponent(id)}/markdown`, this.baseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/markdown' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (thrown) {
      const cause = thrown instanceof Error ? thrown.message : String(thrown);
      console.error(`[ops-console] upstream ${url.toString()} unreachable: ${cause}`);
      throw new UpstreamError(503, 'UPSTREAM_UNAVAILABLE', 'upstream unavailable');
    }
    const text = await response.text();
    if (!response.ok) {
      let code = 'UPSTREAM_ERROR';
      let message = `upstream ${response.status}`;
      try {
        const body = JSON.parse(text) as { code?: string; message?: string };
        code = body.code ?? code;
        message = body.message ?? message;
      } catch {
        // Non-JSON error body: keep the generic code, the status is in the message.
      }
      throw new UpstreamError(response.status, code, message);
    }
    return text;
  }

  /** Fill round 1 from drafts; zeus assigns claim ids and records skips. */
  async convene(
    id: string,
    drafts: Array<{ speakerId: string; claims: Array<{ text: string; evidence?: MeetingEvidence[] }> }>,
  ): Promise<{ meeting: MeetingDocument; recorded: Array<{ speakerId: string; claimIds: string[] }>; skipped: Array<{ speakerId: string; reason: string }> }> {
    return callJson(this.baseUrl, this.token, `/api/v1/meetings/${encodeURIComponent(id)}/proposals`, {
      method: 'POST',
      body: { drafts: drafts.map(draft => ({ ...draft, claims: draft.claims.map(claim => ({ ...claim, evidence: claim.evidence ?? [] })) })) },
    });
  }

  async advance(id: string): Promise<MeetingDocument> {
    return callJson<MeetingDocument>(this.baseUrl, this.token, `/api/v1/meetings/${encodeURIComponent(id)}/advance`, {
      method: 'POST',
      body: {},
    });
  }

  async decide(
    id: string,
    input: { by: string; chosenClaimIds: string[]; rejectedClaimIds: string[]; rationale: string },
  ): Promise<MeetingDocument> {
    return callJson<MeetingDocument>(this.baseUrl, this.token, `/api/v1/meetings/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: input,
    });
  }
}

export function meetingsUpstream(config: Config): MeetingsUpstream {
  return new MeetingsUpstream(config.zeus.baseUrl, config.zeus.token);
}
