import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { submitListing } from '../../../server/commerce-ops-service.js';
import { badRequest } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/**
 * POST /api/listings — submit a listing for approval.
 * 423 {submission:{decisionId,grade,status:'awaiting_approval'}} is the normal
 * D3 hold and is surfaced to the UI as-is.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session!;
    // A malformed JSON body is a client error: 400, never the 500 fallback.
    const body = (await request.json().catch(() => null)) as {
      productId?: string;
      channelAccountId?: string;
      contentType?: string;
      sellingPoints?: string[];
    } | null;
    if (body === null) throw badRequest('JSON body required');
    const result = await submitListing(
      getContext(),
      {
        productId: body.productId ?? '',
        channelAccountId: body.channelAccountId ?? '',
        contentType: body.contentType,
        sellingPoints: body.sellingPoints,
      },
      session,
    );
    return jsonResponse(201, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
