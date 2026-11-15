import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsUpstream } from '../src/server/upstream/meetings.js';
import { UpstreamError } from '../src/server/upstream/http.js';

const BASE = 'http://127.0.0.1:8787';
const TOKEN = 'operator-token';

function stubFetch(handler: (url: URL, init: RequestInit) => Response): void {
  vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    return handler(url, init);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('meetings upstream client', () => {
  it('posts an open request with the topic and round cap', async () => {
    let seen: { url?: URL; init?: RequestInit } = {};
    stubFetch((url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 'm1', topic: 't', status: 'open' }), { status: 201 });
    });
    const api = new MeetingsUpstream(BASE, TOKEN);
    await api.open({ topic: '先做质疑还是先做 UI', maxRounds: 2 }).catch(() => undefined);
    const body = JSON.parse(String(seen.init?.body ?? '{}')) as Record<string, unknown>;
    expect(seen.url?.pathname).toBe('/api/v1/meetings');
    expect(seen.init?.method).toBe('POST');
    expect(body.topic).toBe('先做质疑还是先做 UI');
    expect(body.maxRounds).toBe(2);
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends claims and rebut targets when speaking', async () => {
    let body: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'm1' }), { status: 201 });
    });
    const api = new MeetingsUpstream(BASE, TOKEN);
    await api.say('m1', {
      speakerId: 'owner',
      stance: 'challenge',
      claims: [{ text: '没有回放界面没人看', evidence: [{ kind: 'observation', ref: 'demo' }] }],
      rebuts: ['c2'],
    });
    expect(body.stance).toBe('challenge');
    expect(body.rebuts).toEqual(['c2']);
    expect(body.kind).toBe('human');
    expect((body.claims as Array<{ evidence: unknown[] }>)[0]?.evidence).toHaveLength(1);
  });

  it('keeps the zeus protocol message when the write is refused', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ code: 'invalid-state', message: 'round 1 is proposal-only; challenges open in round 2', retryable: false }),
      { status: 409 },
    ));
    const api = new MeetingsUpstream(BASE, TOKEN);
    await expect(api.say('m1', { speakerId: 'c', stance: 'challenge', claims: [], rebuts: ['c2'] }))
      .rejects.toMatchObject({ code: 'invalid-state' });
    try {
      await api.say('m1', { speakerId: 'c', stance: 'challenge', claims: [], rebuts: ['c2'] });
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(UpstreamError);
      expect((thrown as UpstreamError).message).toContain('proposal-only');
    }
  });

  it('passes the minutes through as plain markdown', async () => {
    stubFetch(() => new Response('# 会议\n\n## 决策', {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    }));
    const api = new MeetingsUpstream(BASE, TOKEN);
    await expect(api.markdown('m1')).resolves.toContain('## 决策');
  });

  it('posts a draft batch to the proposals route', async () => {
    let seen: { url?: URL; body?: Record<string, unknown> } = {};
    stubFetch((url, init) => {
      seen = { url, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> };
      return new Response(JSON.stringify({ meeting: { id: 'm1' }, recorded: [], skipped: [] }), { status: 201 });
    });
    const api = new MeetingsUpstream(BASE, TOKEN);
    await api.convene('m1', [
      { speakerId: 'planner-a', claims: [{ text: '先做回放', evidence: [{ kind: 'reference', ref: 'doc.md', note: '' }] }] },
      { speakerId: 'planner-b', claims: [] },
    ]);
    expect(seen.url?.pathname).toBe('/api/v1/meetings/m1/proposals');
    const drafts = (seen.body?.drafts ?? []) as Array<{ speakerId: string; claims: Array<{ evidence: unknown[] }> }>;
    expect(drafts[0]?.speakerId).toBe('planner-a');
    expect(drafts[1]?.claims).toEqual([]);
  });
});
