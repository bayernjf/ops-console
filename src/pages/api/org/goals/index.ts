import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { loadOrgGoals, parseCreateGoalInput } from '../../../../server/org-goal-service.js';
import { canDoControlledAction, canViewOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * GET /api/org/goals?organization_id= — read-only goals + template catalog.
 * POST /api/org/goals — register a goal (F5.1 controlled write). The console
 * validates only the shape; zeus owns schedule/template semantics.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.session || !canViewOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org view requires an operating role'));
  }
  try {
    const organizationId = url.searchParams.get('organization_id') ?? undefined;
    return jsonResponse(200, await loadOrgGoals(getContext(), organizationId));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session || !canDoControlledAction(locals.session.role)) {
    return toErrorResponse(forbidden('goal creation requires an operating role'));
  }
  try {
    const body: unknown = await request.json().catch(() => null);
    const input = parseCreateGoalInput(body);
    const goal = await getContext().zeus.createOrgGoal(input);
    return jsonResponse(201, { goal });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
