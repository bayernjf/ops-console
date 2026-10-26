import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listContent } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/content — published-content projection (pending listings excluded). */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listContent(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
