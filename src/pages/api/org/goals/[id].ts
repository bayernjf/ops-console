import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { parseUpdateGoalStatusInput } from '../../../../server/org-goal-service.js';
import { canDoControlledAction } from '../../../../server/rbac.js';
import { badRequest, forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * PATCH /api/org/goals/:id — F5.1 status-only transition (pause/resume/archive).
 * The console intentionally does not expose title/period/schedule edits here;
 * any field other than `status` is rejected at the boundary. zeus owns the
 * transition and its 4xx (e.g. goal not found) passes through unchanged.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.session || !canDoControlledAction(locals.session.role)) {
    return toErrorResponse(forbidden('goal status update requires an operating role'));
  }
  const id = params.id;
  if (!id) return toErrorResponse(badRequest('missing goal id'));

  try {
    const raw = await request.text().catch(() => '');
    let body: unknown = null;
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    const input = parseUpdateGoalStatusInput(body);
    const goal = await getContext().zeus.updateOrgGoalStatus(id, input.status);
    return jsonResponse(200, { goal });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
