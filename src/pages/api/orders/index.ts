import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listOrders } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/orders — passthrough commerce order list. */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listOrders(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
