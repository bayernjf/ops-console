import type { ServerContext } from './context.js';
import { badRequest } from './errors.js';
import type { OrgExperienceSnapshot } from './upstream/types.js';

/**
 * Tier0 org M4 F4.2 read model: rule-derived candidates, the SOP catalog with
 * promoted advisories, and the organization list needed by the filter. One
 * upstream fan-out per request; the console holds no experience rules.
 */
export async function loadOrgExperience(
  ctx: ServerContext,
  organizationId?: string,
): Promise<OrgExperienceSnapshot> {
  const [candidates, sops, organizations] = await Promise.all([
    ctx.zeus.listExperienceCandidates(organizationId),
    ctx.zeus.listSops(organizationId),
    ctx.zeus.listOrganizations(),
  ]);
  return { candidates, sops, organizations };
}

/**
 * Validate the promote body at the console boundary. `skillId` is optional:
 * omitting it asks zeus to promote into the candidate's own skill. Unknown
 * candidates and invalid target skills remain zeus decisions and pass through
 * as upstream 4xx, never re-interpreted here.
 */
export function parsePromoteExperienceInput(raw: unknown): { skillId?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('promote body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  const rawSkillId = body.skillId;
  if (rawSkillId === undefined || rawSkillId === null || rawSkillId === '') return {};
  if (typeof rawSkillId !== 'string') throw badRequest('skillId must be a string');
  const skillId = rawSkillId.trim();
  return skillId ? { skillId } : {};
}
