import type { ServerContext } from './context.js';
import type { DashboardMetrics } from './upstream/types.js';

/**
 * Read-only operating dashboard (Tier0 M8 §3.2). The console recomputes
 * nothing: commerce `GET /api/v1/dashboard` metrics are returned verbatim.
 */
export function getDashboardMetrics(ctx: ServerContext): Promise<DashboardMetrics> {
  return ctx.commerce.dashboard();
}
