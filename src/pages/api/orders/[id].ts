import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { getOrder } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/orders/:id — order with lines. */
export const GET: APIRoute = async ({ params }) => {
  try {
    return jsonResponse(200, await getOrder(getContext(), params.id ?? ''));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
