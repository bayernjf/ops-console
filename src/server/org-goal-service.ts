import type { ServerContext } from './context.js';
import { badRequest } from './errors.js';
import type {
  ConsoleGoalStatus,
  CreateOrgGoalInput,
  OrgGoalPeriod,
  OrgGoalSchedule,
  OrgGoalSnapshot,
  OrgGoalStatus,
  UpdateOrgGoalStatusInput,
} from './upstream/types.js';

const PERIODS: readonly OrgGoalPeriod[] = ['daily', 'weekly', 'once'];
const STATUSES: readonly OrgGoalStatus[] = ['active', 'paused', 'done', 'archived'];
const CONSOLE_GOAL_STATUSES: readonly ConsoleGoalStatus[] = ['active', 'paused', 'archived'];

/**
 * Tier0 org M5 F5.1/F5.3 read model: goals, the code-owned template catalog,
 * and the organization list needed by the create form. One upstream fan-out
 * per request; no local goal logic or cache.
 */
export async function loadOrgGoals(
  ctx: ServerContext,
  organizationId?: string,
): Promise<OrgGoalSnapshot> {
  const [goals, templates, organizations] = await Promise.all([
    ctx.zeus.listOrgGoals(organizationId),
    ctx.zeus.listGoalTemplates(),
    ctx.zeus.listOrganizations(),
  ]);
  return { goals, templates, organizations };
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

function parseSchedule(raw: unknown, period: OrgGoalPeriod | undefined): OrgGoalSchedule | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('schedule must be an object');
  }
  const body = raw as Record<string, unknown>;
  const hourUtc = body.hourUtc;
  const minuteUtc = body.minuteUtc;
  if (!Number.isInteger(hourUtc) || (hourUtc as number) < 0 || (hourUtc as number) > 23) {
    throw badRequest('schedule.hourUtc must be an integer between 0 and 23');
  }
  if (!Number.isInteger(minuteUtc) || (minuteUtc as number) < 0 || (minuteUtc as number) > 59) {
    throw badRequest('schedule.minuteUtc must be an integer between 0 and 59');
  }

  let weekdayUtc: number | undefined;
  if (body.weekdayUtc !== undefined && body.weekdayUtc !== null) {
    if (
      !Number.isInteger(body.weekdayUtc) ||
      (body.weekdayUtc as number) < 0 ||
      (body.weekdayUtc as number) > 6
    ) {
      throw badRequest('schedule.weekdayUtc must be an integer between 0 and 6');
    }
    weekdayUtc = body.weekdayUtc as number;
  }

  if (period === 'weekly' && weekdayUtc === undefined) {
    throw badRequest('weekly goals require schedule.weekdayUtc');
  }

  return {
    hourUtc: hourUtc as number,
    minuteUtc: minuteUtc as number,
    ...(weekdayUtc !== undefined ? { weekdayUtc } : {}),
  };
}

/**
 * Validate the create-goal form body at the console boundary. Semantics that
 * need the org's own state (template existence, period/schedule coupling) are
 * still decided by zeus; this only rejects malformed input before the call.
 */
export function parseCreateGoalInput(raw: unknown): CreateOrgGoalInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('goal body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;

  const organizationId = optionalString(body, 'organizationId', 'organizationId');
  if (!organizationId) throw badRequest('organizationId is required');
  const title = optionalString(body, 'title', 'title');
  if (!title) throw badRequest('title is required');

  const period = body.period as OrgGoalPeriod | undefined;
  if (period !== undefined && !PERIODS.includes(period)) {
    throw badRequest(`period must be one of ${PERIODS.join(', ')}`);
  }
  const status = body.status as OrgGoalStatus | undefined;
  if (status !== undefined && !STATUSES.includes(status)) {
    throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
  }

  const projectId = optionalString(body, 'projectId', 'projectId');
  const templateRef = optionalString(body, 'templateRef', 'templateRef');
  if (templateRef && body.taskTemplate !== undefined) {
    throw badRequest('templateRef and taskTemplate are mutually exclusive');
  }

  let taskTemplate: Record<string, unknown> | undefined;
  if (body.taskTemplate !== undefined && body.taskTemplate !== null) {
    if (typeof body.taskTemplate !== 'object' || Array.isArray(body.taskTemplate)) {
      throw badRequest('taskTemplate must be an object');
    }
    taskTemplate = body.taskTemplate as Record<string, unknown>;
  }

  const schedule = parseSchedule(body.schedule, period);

  return {
    organizationId,
    title,
    ...(period !== undefined ? { period } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(templateRef !== undefined ? { templateRef } : {}),
    ...(taskTemplate !== undefined ? { taskTemplate } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
  };
}

/**
 * Validate the status-only PATCH body at the console boundary. The console
 * deliberately exposes pause/resume/archive and not title/period/schedule
 * edits yet, so any extra field is rejected instead of silently forwarded.
 * zeus remains the owner of the actual transition and its 4xx passes through.
 */
export function parseUpdateGoalStatusInput(raw: unknown): UpdateOrgGoalStatusInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('goal status body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  const extra = Object.keys(body).filter(field => field !== 'status');
  if (extra.length > 0) {
    throw badRequest(`only status can be updated from the console (got ${extra.join(', ')})`);
  }
  const status = body.status;
  if (typeof status !== 'string' || !CONSOLE_GOAL_STATUSES.includes(status as ConsoleGoalStatus)) {
    throw badRequest(`status must be one of ${CONSOLE_GOAL_STATUSES.join(', ')}`);
  }
  return { status: status as ConsoleGoalStatus };
}
