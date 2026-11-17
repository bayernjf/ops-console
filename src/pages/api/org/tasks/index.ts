import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { countByStatus, loadOrgSnapshot, sortOrgQueue } from '../../../../server/org-service.js';
import { canViewOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * GET /api/org/tasks?organization_id= — read-only queue projection of zeus
 * GET /api/v1/org/tasks (Tier0 org M2 F2.2). Sorted server-side (blocked first)
 * so the island only renders; upstream failures pass through fail-closed.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.session || !canViewOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org view requires an operating role'));
  }
  try {
    const organizationId = url.searchParams.get('organization_id') ?? undefined;
    const snapshot = await loadOrgSnapshot(getContext(), organizationId);
    const tasks = sortOrgQueue(snapshot.tasks);
    return jsonResponse(200, { tasks, counts: countByStatus(tasks) });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
