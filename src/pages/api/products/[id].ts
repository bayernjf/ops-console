import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { getProduct } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/products/:id */
export const GET: APIRoute = async ({ params }) => {
  try {
    return jsonResponse(200, await getProduct(getContext(), params.id ?? ''));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
