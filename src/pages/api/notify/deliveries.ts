import type { APIRoute } from 'astro';
import { listDeliveries } from '../../../server/notify/index.js';

/** Recent delivery records (most recent first). Login required. */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.session) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const limit = 100;
  return new Response(JSON.stringify({ deliveries: listDeliveries().slice(0, limit) }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
