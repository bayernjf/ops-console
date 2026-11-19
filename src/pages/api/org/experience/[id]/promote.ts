import type { APIRoute } from 'astro';
import { getContext } from '../../../../../server/context.js';
import { parsePromoteExperienceInput } from '../../../../../server/org-experience-service.js';
import { canPromoteExperience, canViewOrg } from '../../../../../server/rbac.js';
import { badRequest, forbidden } from '../../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../../server/endpoint-json.js';

/**
 * POST /api/org/experience/:id/promote — F4.2 owner-only human review gate.
 * A candidate changes the SOP catalog only through this call; operators may
 * read the queue but cannot promote. zeus owns candidate/target validation,
 * so its 4xx (e.g. EXPERIENCE_NOT_FOUND) passes through unchanged.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.session || !canViewOrg(locals.session.role)) {
    return toErrorResponse(forbidden('org view requires an operating role'));
  }
  if (!canPromoteExperience(locals.session.role)) {
    return toErrorResponse(forbidden('experience promotion requires owner role'));
  }
  const id = params.id;
  if (!id) return toErrorResponse(badRequest('missing experience candidate id'));

  try {
    const raw = await request.text().catch(() => '');
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    const input = parsePromoteExperienceInput(body);
    const candidate = await getContext().zeus.promoteExperience(id, input.skillId);
    return jsonResponse(200, { candidate });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
