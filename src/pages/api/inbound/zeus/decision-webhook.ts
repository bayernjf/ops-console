import type { APIRoute } from 'astro';
import { getContext } from '../../../../server/context.js';
import {
  handleInboundDecisionEvent,
  InboundEventLog,
} from '../../../../server/notify/inbound.js';

/**
 * POST /api/inbound/zeus/decision-webhook
 *
 * Inbound receiver for zeus decision lifecycle events (created/late/approved/
 * rejected/timed-out). PUBLIC on purpose: zeus calls it directly with an HMAC
 * signature instead of a console session cookie. Authentication is the
 * x-zeus-signature header; replay idempotency is x-zeus-delivery-id.
 */
let log: InboundEventLog | null = null;

function getLog(): InboundEventLog {
  if (!log) {
    const file = getContext().config.inbound.decisionWebhookLogFile;
    log = new InboundEventLog(file);
    log.load();
  }
  return log;
}

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const result = handleInboundDecisionEvent(
    {
      secret: getContext().config.inbound.decisionWebhookSecret,
      log: getLog(),
      now: () => Date.now(),
    },
    rawBody,
    {
      signature: request.headers.get('x-zeus-signature'),
      deliveryId: request.headers.get('x-zeus-delivery-id'),
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
