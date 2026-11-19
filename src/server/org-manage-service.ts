import type { ServerContext } from './context.js';
import { badRequest } from './errors.js';
import type {
  AssignAgentInput,
  CreateDepartmentInput,
  CreateOrganizationInput,
  CreatePositionInput,
  Grade,
  OrgManageSnapshot,
  OrgScaleTier,
} from './upstream/types.js';

const SCALE_TIERS: readonly OrgScaleTier[] = ['single', 'small', 'team', 'division', 'enterprise'];
const GRADES: readonly Grade[] = ['D0', 'D1', 'D2', 'D3'];

/**
 * Tier0 org F2.1 read model for the owner-only modeling page: organizations,
 * departments and positions in one upstream fan-out. No local roster logic.
 */
export async function loadOrgManageSnapshot(ctx: ServerContext): Promise<OrgManageSnapshot> {
  const [organizations, departments, positions] = await Promise.all([
    ctx.zeus.listOrganizations(),
    ctx.zeus.listDepartments(),
    ctx.zeus.listPositions(),
  ]);
  return { organizations, departments, positions };
}

function bodyObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('org body must be a JSON object');
  }
  return raw as Record<string, unknown>;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  label: string,
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw badRequest(`${label} must be a string`);
  return raw.trim() || undefined;
}

function requiredString(body: Record<string, unknown>, field: string, label: string): string {
  const value = optionalString(body, field, label);
  if (!value) throw badRequest(`${label} is required`);
  return value;
}

function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
  label: string,
): string[] | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw badRequest(`${label} must be an array of strings`);
  const values = raw.map((item, index) => {
    if (typeof item !== 'string') throw badRequest(`${label}[${index}] must be a string`);
    return item.trim();
  });
  return values.filter(value => value !== '');
}

/**
 * Validate the owner-only organization create body. `id` is optional (zeus
 * derives a slug); `scaleTier`/`concurrencyLimit` are optional and stay within
 * zeus's own bounds (1..8). Parent existence remains a zeus decision.
 */
export function parseCreateOrganizationInput(raw: unknown): CreateOrganizationInput {
  const body = bodyObject(raw);
  const name = requiredString(body, 'name', 'name');
  const id = optionalString(body, 'id', 'id');
  const scaleTier = body.scaleTier;
  if (scaleTier !== undefined && !SCALE_TIERS.includes(scaleTier as OrgScaleTier)) {
    throw badRequest(`scaleTier must be one of ${SCALE_TIERS.join(', ')}`);
  }
  const parentId = optionalString(body, 'parentId', 'parentId');

  let concurrencyLimit: number | undefined;
  if (body.concurrencyLimit !== undefined && body.concurrencyLimit !== null) {
    if (
      !Number.isInteger(body.concurrencyLimit) ||
      (body.concurrencyLimit as number) < 1 ||
      (body.concurrencyLimit as number) > 8
    ) {
      throw badRequest('concurrencyLimit must be an integer between 1 and 8');
    }
    concurrencyLimit = body.concurrencyLimit as number;
  }

  return {
    ...(id !== undefined ? { id } : {}),
    name,
    ...(scaleTier !== undefined ? { scaleTier: scaleTier as OrgScaleTier } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(concurrencyLimit !== undefined ? { concurrencyLimit } : {}),
  };
}

export function parseCreateDepartmentInput(raw: unknown): CreateDepartmentInput {
  const body = bodyObject(raw);
  const organizationId = requiredString(body, 'organizationId', 'organizationId');
  const name = requiredString(body, 'name', 'name');
  const mission = requiredString(body, 'mission', 'mission');
  const id = optionalString(body, 'id', 'id');
  const parentId = optionalString(body, 'parentId', 'parentId');
  return {
    organizationId,
    name,
    mission,
    ...(id !== undefined ? { id } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

export function parseCreatePositionInput(raw: unknown): CreatePositionInput {
  const body = bodyObject(raw);
  const organizationId = requiredString(body, 'organizationId', 'organizationId');
  const departmentId = requiredString(body, 'departmentId', 'departmentId');
  const name = requiredString(body, 'name', 'name');
  const decisionScope = body.decisionScope;
  if (decisionScope !== undefined && !GRADES.includes(decisionScope as Grade)) {
    throw badRequest(`decisionScope must be one of ${GRADES.join(', ')}`);
  }
  const responsibilities = optionalStringArray(body, 'responsibilities', 'responsibilities');
  const requiredSkills = optionalStringArray(body, 'requiredSkills', 'requiredSkills');
  const allowedTools = optionalStringArray(body, 'allowedTools', 'allowedTools');
  const id = optionalString(body, 'id', 'id');
  return {
    organizationId,
    departmentId,
    name,
    ...(id !== undefined ? { id } : {}),
    ...(decisionScope !== undefined ? { decisionScope: decisionScope as Grade } : {}),
    ...(responsibilities !== undefined ? { responsibilities } : {}),
    ...(requiredSkills !== undefined ? { requiredSkills } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
  };
}

export function parseAssignAgentInput(raw: unknown): AssignAgentInput {
  const body = bodyObject(raw);
  return { agentId: requiredString(body, 'agentId', 'agentId') };
}
