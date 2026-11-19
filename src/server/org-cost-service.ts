import type { ServerContext } from './context.js';
import type {
  OrgCostDimension,
  OrgCostResponse,
  OrgCostWindow,
} from './upstream/model-hub.js';

const DIMENSIONS: readonly OrgCostDimension[] = ['position', 'department', 'task'];

/**
 * UI selection is a whitelist: anything unknown falls back to the task axis,
 * so a hand-edited query string cannot reach model-hub as an arbitrary value.
 */
export function parseOrgCostDimension(
  raw: string | null | undefined,
): OrgCostDimension {
  const value = raw?.trim() as OrgCostDimension | undefined;
  return value && DIMENSIONS.includes(value) ? value : 'task';
}

/**
 * Tier0 org M3 F3.3 read model: one model-hub admin aggregate per request.
 * No local money arithmetic — the console only renders upstream rows and
 * totals, and fails closed when model-hub is unavailable.
 */
export function loadOrgCosts(
  ctx: ServerContext,
  dimension: OrgCostDimension,
  window: OrgCostWindow = {},
): Promise<OrgCostResponse> {
  return ctx.modelHub.getOrgCosts(dimension, window);
}
