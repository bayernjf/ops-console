import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.session) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ user: locals.session }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
