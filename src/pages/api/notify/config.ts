import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { canConfigureNotify } from '../../../server/rbac.js';
import { getNotifyConfig, updateNotifyConfig } from '../../../server/notify/index.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Read current notify config. Login required; webhook URL is masked (host only). */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.session) return json({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }, 401);
  return json({ config: getNotifyConfig() });
};

/** Update notify config. Owner only; operator gets 403. */
export const PUT: APIRoute = async ({ request, locals }) => {
  if (!locals.session) return json({ error: { code: 'UNAUTHORIZED', message: 'authentication required', retryable: false } }, 401);
  if (!canConfigureNotify(locals.session.role)) {
    return json({ error: { code: 'FORBIDDEN', message: 'only owner can configure notifications', retryable: false } }, 403);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'JSON body required', retryable: false } }, 400);
  }
  const patch: { enabled?: boolean; webhookUrl?: string; pollMs?: number; escalationMinutes?: number } = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.webhookUrl === 'string') patch.webhookUrl = body.webhookUrl;
  if (typeof body.pollMs === 'number') patch.pollMs = body.pollMs;
  if (typeof body.escalationMinutes === 'number') patch.escalationMinutes = body.escalationMinutes;

  try {
    getContext(); // ensure scheduler context is live
    const updated = updateNotifyConfig(patch);
    return json({ config: updated });
  } catch (thrown) {
    return json(
      { error: { code: 'VALIDATION_FAILED', message: thrown instanceof Error ? thrown.message : String(thrown), retryable: false } },
      400,
    );
  }
};
