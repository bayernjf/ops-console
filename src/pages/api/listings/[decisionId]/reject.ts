import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { rejectListing } from '../../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/** POST /api/listings/:decisionId/reject — owner-only for D3 (server-enforced). */
export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const session = locals.session!;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    const result = await rejectListing(
      getContext(),
      params.decisionId ?? '',
      { comment: body.comment },
      session,
    );
    return jsonResponse(200, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
