import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { getApproval } from '../../../../server/approvals-service.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/** GET /api/approvals/:id — full decision record (zeus verbatim). */
export const GET: APIRoute = async ({ params }) => {
  try {
    const decision = await getApproval(getContext(), params.id ?? '');
    return jsonResponse(200, { decision });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
