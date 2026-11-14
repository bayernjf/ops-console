import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import { meetingsUpstream } from '../../../../server/upstream/meetings.js';
import { toErrorResponse } from '../../../../server/endpoint-json.js';

/** GET /api/meetings/:id/markdown — minutes as a downloadable .md file. */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  try {
    const markdown = await meetingsUpstream(getContext().config).markdown(id);
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${id}.md"`,
      },
    });
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
