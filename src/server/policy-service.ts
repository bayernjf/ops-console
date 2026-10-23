import { forbidden } from './errors.js';
import { canChangeThresholds } from './rbac.js';
import type { ServerContext } from './context.js';
import type { DecisionPolicy, Grade } from './upstream/types.js';

/**
 * Policy / thresholds orchestration (Tier0 M8 §3.1). Reading policy is available
 * to any signed-in role; changing thresholds is owner-only and the session
 * username is injected as the zeus actor.
 */

export interface ThresholdsInput {
  d1MaxAmount?: number | undefined;
  d2MaxAmount?: number | undefined;
  defaultGrade?: Grade | undefined;
}

export function getPolicy(ctx: ServerContext): Promise<DecisionPolicy> {
  return ctx.zeus.getPolicy();
}

export async function applyThresholds(
  ctx: ServerContext,
  input: ThresholdsInput,
  session: { username: string; role: 'owner' | 'operator' },
): Promise<DecisionPolicy> {
  if (!canChangeThresholds(session.role)) {
    throw forbidden('only owner may change policy thresholds');
  }
  return ctx.zeus.applyThresholds({
    ...(input.d1MaxAmount !== undefined ? { d1MaxAmount: input.d1MaxAmount } : {}),
    ...(input.d2MaxAmount !== undefined ? { d2MaxAmount: input.d2MaxAmount } : {}),
    ...(input.defaultGrade !== undefined ? { defaultGrade: input.defaultGrade } : {}),
    actor: session.username,
  });
}
