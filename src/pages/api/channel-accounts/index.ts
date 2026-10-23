import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listChannelAccounts } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/channel-accounts — needed by the create-product / listing forms. */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listChannelAccounts(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
