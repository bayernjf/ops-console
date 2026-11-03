import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listInventory, setInventory } from '../../../server/commerce-ops-service.js';
import { badRequest } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/inventory — passthrough inventory list. */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listInventory(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};

/** POST /api/inventory {skuId, qty} — manual adjustment (operator + owner). */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session!;
    // A malformed JSON body is a client error: 400, never the 500 fallback.
    const body = (await request.json().catch(() => null)) as { skuId?: string; qty?: number } | null;
    if (body === null) throw badRequest('JSON body required');
    const result = await setInventory(
      getContext(),
      { skuId: body.skuId ?? '', qty: Number(body.qty ?? -1) },
      session,
    );
    return jsonResponse(201, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
