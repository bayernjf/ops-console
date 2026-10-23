import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { approveListing } from '../../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/** POST /api/listings/:decisionId/approve — owner-only for D3 (server-enforced). */
export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const session = locals.session!;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    const result = await approveListing(
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
