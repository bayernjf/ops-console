import type { APIRoute } from 'astro';
import { getContext } from '../../../../../../server/context.js';
import { parseAssignAgentInput } from '../../../../../../server/org-manage-service.js';
import { canManageOrg } from '../../../../../../server/rbac.js';
import { forbidden } from '../../../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../../../server/endpoint-json.js';

/**
 * POST /api/org/manage/positions/:id/assign-agent — owner-only F2.1 bind.
 * Only the agent id crosses the console edge; zeus validates the position.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.session || !canManageOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org modeling requires owner role'));
  }
  try {
    // Astro delivers the dynamic segment URL-encoded; decode before the
    // upstream call so ids like `pos:content` are not double-encoded.
    const positionId = params.id ? decodeURIComponent(params.id) : undefined;
    if (!positionId) return toErrorResponse(forbidden('position id is required'));
    const body: unknown = await request.json().catch(() => null);
    const input = parseAssignAgentInput(body);
    const position = await getContext().zeus.assignAgent(positionId, input.agentId);
    return jsonResponse(200, { position });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
