import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { meetingsUpstream } from '../../../server/upstream/meetings.js';
import { UpstreamError } from '../../../server/upstream/http.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/meetings — the zeus meeting list, proxied with the server token. */
export const GET: APIRoute = async () => {
  try {
    const meetings = await meetingsUpstream(getContext().config).list();
    return jsonResponse(200, { meetings });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};

/**
 * POST /api/meetings — form endpoint for the replay page's write controls.
 * Every action is forwarded to zeus; the console holds no meeting rules of its
 * own and never touches the JSON store.
 *
 * Actions: open (topic, maxRounds), say (speaker, stance, claimText, rebuts,
 * evidence), advance, decide (chosen, rejected, rationale).
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const id = String(form.get('id') ?? '');
  const api = meetingsUpstream(getContext().config);
  const operator = locals.session?.username ?? 'owner';

  const back = (meetingId?: string, error?: string) => {
    const params = new URLSearchParams();
    if (meetingId) params.set('id', meetingId);
    if (error) params.set('error', error);
    const query = params.toString();
    return redirect(`/app/meetings${query ? `?${query}` : ''}`, 303);
  };

  try {
    if (action === 'open') {
      const topic = String(form.get('topic') ?? '').trim();
      if (!topic) return back(undefined, '议题不能为空');
      const roundsRaw = String(form.get('maxRounds') ?? '2');
      const maxRounds = Number(roundsRaw);
      const meeting = await api.open({
        topic,
        ...(Number.isInteger(maxRounds) ? { maxRounds } : {}),
      });
      return back(meeting.id);
    }

    if (!id) return back(undefined, '缺少会议 id');

    if (action === 'say') {
      const meeting = await api.get(id);
      const speakerId = String(form.get('speaker') ?? '').trim() || operator;
      const stance = String(form.get('stance') ?? 'propose') as 'propose' | 'challenge' | 'support' | 'note';
      const claimText = String(form.get('claimText') ?? '').trim();
      const evidenceRef = String(form.get('evidenceRef') ?? '').trim();
      const evidenceKind = String(form.get('evidenceKind') ?? 'fact').trim() || 'fact';
      const rebuts = form.getAll('rebut').map(value => String(value)).filter(value => value.length > 0);
      const claims = claimText.length > 0 || evidenceRef.length > 0
        ? [{
          text: claimText,
          evidence: evidenceRef.length > 0 ? [{ kind: evidenceKind, ref: evidenceRef, note: '' }] : [],
        }]
        : [];
      const next = await api.say(id, {
        speakerId,
        stance,
        claims,
        rebuts,
      });
      return back(next.id);
    }

    if (action === 'advance') {
      const next = await api.advance(id);
      return back(next.id);
    }

    if (action === 'decide') {
      const chosen = form.getAll('chosen').map(value => String(value)).filter(value => value.length > 0);
      const rejected = form.getAll('rejected').map(value => String(value)).filter(value => value.length > 0);
      const rationale = String(form.get('rationale') ?? '').trim();
      const next = await api.decide(id, { by: operator, chosenClaimIds: chosen, rejectedClaimIds: rejected, rationale });
      return back(next.id);
    }

    return back(id, `未知操作：${action}`);
  } catch (thrown) {
    const message = thrown instanceof UpstreamError ? thrown.message : thrown instanceof Error ? thrown.message : String(thrown);
    return back(id || undefined, message);
  }
};
