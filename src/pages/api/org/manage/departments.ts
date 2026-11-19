import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { parseCreateDepartmentInput } from '../../../../server/org-manage-service.js';
import { canManageOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/org/manage/departments — owner-only F2.1 department write.
 * `organizationId` and `mission` are required; zeus owns org/parent checks.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session || !canManageOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org modeling requires owner role'));
  }
  try {
    const body: unknown = await request.json().catch(() => null);
    const input = parseCreateDepartmentInput(body);
    const department = await getContext().zeus.createDepartment(input);
    return jsonResponse(201, { department });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
