import { defineMiddleware } from 'astro:middleware';
import { getContext } from './server/context.js';
import { parseSessionCookie, verifySessionToken } from './server/session.js';
import { startNotifyScheduler } from './server/notify/index.js';

const PUBLIC_PATHS = new Set(['/login', '/healthz']);
const PUBLIC_API_PREFIXES = ['/api/auth/login', '/api/inbound/zeus/decision-webhook'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function json401(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;

  if (isPublic(pathname)) {
    return next();
  }

  const ctxServer = getContext();
  // Start the notification poller once per process (no-op seam until notify lands).
  startNotifyScheduler(ctxServer);

  const raw = parseSessionCookie(ctx.request.headers.get('Cookie'));
  const session = raw ? verifySessionToken(raw, ctxServer.config.sessionSecret) : null;
  ctx.locals.session = session;

  if (!session) {
    if (pathname.startsWith('/api/')) return json401();
    const nextParam = encodeURIComponent(pathname + ctx.url.search);
    return ctx.redirect(`/login?next=${nextParam}`);
  }

  return next();
});
