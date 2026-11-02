import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { decideRefund } from '../../../../server/commerce-ops-service.js';
import { badRequest } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/refunds/:id/decision {verdict:'approve'|'reject', comment?}
 * approver injected from session; grade gate runs server-side (D3 owner-only).
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const session = locals.session!;
    const body = (await request.json().catch(() => null)) as { verdict?: string; comment?: string } | null;
    // fail-closed (P1): an invalid/missing verdict must never be coerced into
    // 'approve' — a mistyped 'reject' would otherwise pay out a real refund.
    if (body?.verdict !== 'approve' && body?.verdict !== 'reject') {
      throw badRequest("body.verdict must be 'approve' or 'reject'");
    }
    const result = await decideRefund(
      getContext(),
      params.id ?? '',
      {
        verdict: body.verdict,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
      },
      session,
    );
    return jsonResponse(200, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
