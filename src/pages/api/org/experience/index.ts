import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { loadOrgExperience } from '../../../../server/org-experience-service.js';
import { canViewOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * GET /api/org/experience?organization_id= — read-only candidate queue and
 * SOP catalog (with promoted advisories). F4.2: both operating roles may read.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.session || !canViewOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org view requires an operating role'));
  }
  try {
    const organizationId = url.searchParams.get('organization_id') ?? undefined;
    return jsonResponse(200, await loadOrgExperience(getContext(), organizationId));
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
