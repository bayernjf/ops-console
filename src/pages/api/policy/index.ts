import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { getPolicy } from '../../../server/policy-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/policy — zeus policy verbatim (any signed-in role). */
export const GET: APIRoute = async () => {
  try {
    const policy = await getPolicy(getContext());
    return jsonResponse(200, policy);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
