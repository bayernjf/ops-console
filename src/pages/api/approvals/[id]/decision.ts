import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { decideApproval } from '../../../../server/approvals-service.js';
import { badRequest } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/approvals/:id/decision  body { decision: 'approve'|'reject', comment? }
 * approver is injected from the session; D3 owner-only enforced server-side.
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const session = locals.session;
    if (!session) throw badRequest('no session'); // unreachable: middleware 401s first
    const body = (await request.json().catch(() => null)) as { decision?: string; comment?: string } | null;
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      throw badRequest("body.decision must be 'approve' or 'reject'");
    }
    const result = await decideApproval(
      getContext(),
      params.id ?? '',
      { decision: body.decision, comment: typeof body.comment === 'string' ? body.comment : undefined },
      session,
    );
    return jsonResponse(200, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
