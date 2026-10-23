import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { getReplay } from '../../../../server/approvals-service.js';
import { badRequest } from '../../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../../server/endpoint-json.js';

/** GET /api/approvals/:id/replay?format=json|text — evidence/replay bundle. */
export const GET: APIRoute = async ({ params, url }) => {
  try {
    const format = url.searchParams.get('format') ?? 'json';
    if (format !== 'json' && format !== 'text') {
      throw badRequest(`format must be json|text, got ${JSON.stringify(format)}`);
    }
    const replay = await getReplay(getContext(), params.id ?? '', format);
    return jsonResponse(200, { replay });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
