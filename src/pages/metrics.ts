import type { APIRoute } from 'astro';
import { listDeliveries } from '../server/notify/index.js';
import {
  buildOpsConsoleMetricsSnapshot,
  PROMETHEUS_CONTENT_TYPE,
  renderPrometheusMetrics,
} from '../server/metrics.js';

/**
 * Prometheus scrapes `/metrics` from the local tier0-net. This endpoint is
 * outside authentication (see middleware PUBLIC_PATHS) and exposes aggregate
 * counts only: no decision id, deep link, webhook URL or error text.
 */
export const GET: APIRoute = () => {
  const snapshot = buildOpsConsoleMetricsSnapshot(listDeliveries());
  return new Response(renderPrometheusMetrics(snapshot), {
    status: 200,
    headers: {
      'Content-Type': PROMETHEUS_CONTENT_TYPE,
      'Cache-Control': 'no-store',
    },
  });
};
