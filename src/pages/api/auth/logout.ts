import type { APIRoute } from 'astro';
import { SESSION_COOKIE, clearSessionCookie } from '../../../server/session.js';

export const POST: APIRoute = async ({ cookies }) => {
  cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
};
