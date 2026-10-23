import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: 'ok', service: 'ops-console' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
