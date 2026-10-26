import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listRefunds, requestRefund } from '../../../server/commerce-ops-service.js';
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
    const body = (await request.json()) as {
      orderId?: string;
      lines?: Array<{ orderItemId?: string; qty?: number; amount?: number }>;
      reason?: string;
    };
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
