import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listRefunds, requestRefund } from '../../../server/commerce-ops-service.js';
import { badRequest } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/**
 * GET /api/refunds — refund list (read-only).
 * POST /api/refunds — request a refund.
 * 423 {refund:{decisionId,status:'awaiting_approval'}} is the normal D2 hold.
 */
export const GET: APIRoute = async () => {
  try {
    return jsonResponse(200, await listRefunds(getContext()));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session!;
    // A malformed JSON body is a client error: 400, never the 500 fallback.
    const body = (await request.json().catch(() => null)) as {
      orderId?: string;
      lines?: Array<{ orderItemId?: string; qty?: number; amount?: number }>;
      reason?: string;
    } | null;
    if (body === null) throw badRequest('JSON body required');
    const result = await requestRefund(
      getContext(),
      {
        orderId: body.orderId ?? '',
        lines: body.lines ?? [],
        reason: body.reason ?? '',
      },
      session,
    );
    return jsonResponse(201, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
