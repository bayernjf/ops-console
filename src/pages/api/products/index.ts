import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listProducts, createProduct } from '../../../server/commerce-ops-service.js';
import { badRequest } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/products — passthrough commerce product list. */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listProducts(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};

/** POST /api/products — operator + owner; body {title, channelAccountId?, skus[]}. */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session!;
    // A malformed JSON body is a client error: 400, never the 500 fallback.
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      channelAccountId?: string;
      attributes?: Record<string, unknown>;
      skus?: Array<{ skuCode: string; specs?: Record<string, unknown>; price: number; currency?: string }>;
    } | null;
    if (body === null) throw badRequest('JSON body required');
    const result = await createProduct(
      getContext(),
      {
        title: body.title ?? '',
        ...(body.channelAccountId ? { channelAccountId: body.channelAccountId } : {}),
        ...(body.attributes ? { attributes: body.attributes } : {}),
        skus: body.skus ?? [],
      },
      session,
    );
    return jsonResponse(201, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
