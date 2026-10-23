import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { importOrders } from '../../../server/commerce-ops-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** POST /api/orders/import {channelAccountId, since?} — idempotent channel pull. */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session!;
    const body = (await request.json()) as { channelAccountId?: string; since?: string };
    const result = await importOrders(
      getContext(),
      { channelAccountId: body.channelAccountId ?? '', since: body.since },
      session,
    );
    return jsonResponse(201, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
