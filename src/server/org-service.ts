import type { ServerContext } from './context.js';
import type { OrgSnapshot, OrgTask } from './upstream/types.js';

/**
 * Tier0 org M2 read model (F2.1/F2.2). One snapshot per request: organizations,
 * then the departments/positions/tasks of the selected org, fetched in
 * parallel. Read-only projection — the console holds no org rules, no cache; on
 * any upstream failure the caller sees the failure and the page fails closed.
 */
export async function loadOrgSnapshot(
  ctx: ServerContext,
  organizationId?: string,
): Promise<OrgSnapshot> {
  const organizations = await ctx.zeus.listOrganizations();
  const target = organizationId?.trim() || organizations[0]?.id;
  if (!target) return { organizations, departments: [], positions: [], tasks: [] };
  const [departments, positions, tasks] = await Promise.all([
    ctx.zeus.listDepartments(target),
    ctx.zeus.listPositions(target),
    ctx.zeus.listOrgTasks(target),
  ]);
  return { organizations, departments, positions, tasks };
}

/**
 * Queue ordering for the operator: blocked work first (awaiting_decision), then
 * in-flight (running/dispatched), then pending intake, then settled history —
 * newest first within each band.
 */
export function sortOrgQueue(tasks: OrgTask[]): OrgTask[] {
  const rank = (task: OrgTask): number => {
    switch (task.status) {
      case 'awaiting_decision':
        return 0;
      case 'running':
      case 'dispatched':
        return 1;
      case 'pending':
        return 2;
      default:
        return 3;
    }
  };
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/** Counts by status for the queue header. */
export function countByStatus(tasks: OrgTask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}
