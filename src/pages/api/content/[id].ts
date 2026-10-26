import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { getContent } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/content/:id — one published-content record. */
export const GET: APIRoute = async ({ params }) => {
  try {
    return jsonResponse(200, await getContent(getContext(), params.id ?? ''));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
