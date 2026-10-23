import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { decideRefund } from '../../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/refunds/:id/decision {verdict:'approve'|'reject', comment?}
 * approver injected from session; grade gate runs server-side (D3 owner-only).
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const session = locals.session!;
    const body = (await request.json()) as { verdict?: string; comment?: string };
    const result = await decideRefund(
      getContext(),
      params.id ?? '',
      {
        verdict: body.verdict === 'approve' || body.verdict === 'reject' ? body.verdict : 'approve',
        comment: body.comment,
      },
      session,
    );
    return jsonResponse(200, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
