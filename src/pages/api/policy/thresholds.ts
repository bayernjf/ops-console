import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { applyThresholds } from '../../../server/policy-service.js';
import { badRequest } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/**
 * PUT /api/policy/thresholds  body { d1MaxAmount?, d2MaxAmount?, defaultGrade? }
 * Owner-only (operator -> 403 FORBIDDEN); actor injected from session.
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const session = locals.session;
    if (!session) throw badRequest('no session');
    const body = (await request.json().catch(() => null)) as {
      d1MaxAmount?: number;
      d2MaxAmount?: number;
      defaultGrade?: string;
    } | null;
    if (body === null) throw badRequest('JSON body required');
    if (body.d1MaxAmount !== undefined && typeof body.d1MaxAmount !== 'number') throw badRequest('d1MaxAmount must be a number');
    if (body.d2MaxAmount !== undefined && typeof body.d2MaxAmount !== 'number') throw badRequest('d2MaxAmount must be a number');
    if (body.defaultGrade !== undefined && !['D0', 'D1', 'D2', 'D3'].includes(body.defaultGrade)) {
      throw badRequest('defaultGrade must be D0|D1|D2|D3');
    }
    const policy = await applyThresholds(
      getContext(),
      {
        ...(body.d1MaxAmount !== undefined ? { d1MaxAmount: body.d1MaxAmount } : {}),
        ...(body.d2MaxAmount !== undefined ? { d2MaxAmount: body.d2MaxAmount } : {}),
        ...(body.defaultGrade !== undefined ? { defaultGrade: body.defaultGrade as 'D0' | 'D1' | 'D2' | 'D3' } : {}),
      },
      session,
    );
    return jsonResponse(200, policy);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
