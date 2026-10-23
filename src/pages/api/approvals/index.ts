import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listApprovals } from '../../../server/approvals-service.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/** GET /api/approvals?status=&grade=&domain= — pending queue by default. */
export const GET: APIRoute = async ({ url }) => {
  try {
    const decisions = await listApprovals(getContext(), {
      status: url.searchParams.get('status') ?? undefined,
      grade: url.searchParams.get('grade') ?? undefined,
      domain: url.searchParams.get('domain') ?? undefined,
    });
    return jsonResponse(200, { decisions });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
