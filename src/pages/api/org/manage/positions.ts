import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { parseCreatePositionInput } from '../../../../server/org-manage-service.js';
import { canManageOrg } from '../../../../server/rbac.js';
import { forbidden } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/**
 * POST /api/org/manage/positions — owner-only F2.1 position write.
 * Skill/tool arrays are normalized here; decisionScope defaults to zeus D2.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session || !canManageOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org modeling requires owner role'));
  }
  try {
    const body: unknown = await request.json().catch(() => null);
    const input = parseCreatePositionInput(body);
    const position = await getContext().zeus.createPosition(input);
    return jsonResponse(201, { position });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
