import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { getRefund } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/refunds/:id */
export const GET: APIRoute = async ({ params }) => {
  try {
    return jsonResponse(200, await getRefund(getContext(), params.id ?? ''));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
