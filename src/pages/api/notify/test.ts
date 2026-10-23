import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { canConfigureNotify } from '../../../server/rbac.js';
import { sendTestNotification } from '../../../server/notify/index.js';

/** Immediately deliver one synthetic test card. Owner only. */
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.session) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!canConfigureNotify(locals.session.role)) {
    return new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'only owner can send test notifications', retryable: false } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  try {
    const record = await sendTestNotification(getContext());
    return new Response(JSON.stringify({ delivery: record }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (thrown) {
    return new Response(
      JSON.stringify({
        error: { code: 'UPSTREAM_UNAVAILABLE', message: thrown instanceof Error ? thrown.message : String(thrown), retryable: true },
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
