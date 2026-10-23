import type { APIRoute } from 'astro';
import { authenticate } from '../../../server/auth.js';
import { getContext } from '../../../server/context.js';
import { SESSION_COOKIE, createSessionToken } from '../../../server/session.js';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const { config } = getContext();
  const user = authenticate(config, username, password);
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'invalid credentials', retryable: false } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const token = createSessionToken({ username: user.username, role: user.role }, config.sessionSecret);
  const secure = config.publicBaseUrl.startsWith('https://');
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: 60 * 60 * 12,
  });
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
