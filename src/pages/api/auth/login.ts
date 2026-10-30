import type { APIRoute } from 'astro';
import { authenticate } from '../../../server/auth.js';
import { getContext } from '../../../server/context.js';
import { jsonResponse } from '../../../server/endpoint-json.js';
import { loginKey, loginThrottle } from '../../../server/login-throttle.js';
import { SESSION_COOKIE, createSessionToken } from '../../../server/session.js';

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const key = loginKey(clientAddress, request.headers.get('x-forwarded-for'));
  if (loginThrottle.remaining(key) <= 0) {
    return jsonResponse(429, {
      error: {
        code: 'RATE_LIMITED',
        message: 'too many failed login attempts; retry in 15 minutes',
        retryable: true,
      },
    });
  }

  const { config } = getContext();
  const user = authenticate(config, username, password);
  if (!user) {
    loginThrottle.recordFailure(key);
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
