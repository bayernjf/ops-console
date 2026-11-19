import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { parseCreateOrganizationInput } from '../../../../server/org-manage-service.js';
import { canManageOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/org/manage/organizations — owner-only F2.1 structural write.
 * The console validates shape only; parent existence and slug/id collisions
 * remain zeus decisions and are passed through verbatim.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session || !canManageOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org modeling requires owner role'));
  }
  try {
    const body: unknown = await request.json().catch(() => null);
    const input = parseCreateOrganizationInput(body);
    const organization = await getContext().zeus.createOrganization(input);
    return jsonResponse(201, { organization });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
