import { forbidden, badRequest } from './errors.js';
import { canApprove } from './rbac.js';
import type { ServerContext } from './context.js';
import type {
  ApprovalVerdict,
  DecisionApprovalResponse,
  DecisionRecord,
  DecisionStatus,
  Grade,
} from './upstream/types.js';

/**
 * Approval workbench orchestration (Tier0 M8 §3.1). Pure TS, no HTTP here:
 * endpoints stay thin wrappers. The console holds no business rules — it only
 * (a) enforces the minimal RBAC gate, (b) injects the session username as the
 * approver, and (c) passes zeus responses through verbatim (no local status
 * judgement).
 */

const STATUSES: readonly DecisionStatus[] = ['decided', 'awaiting_approval', 'blocked', 'rejected'];
const GRADES: readonly Grade[] = ['D0', 'D1', 'D2', 'D3'];

export interface ListApprovalsQuery {
  status?: string | undefined;
  grade?: string | undefined;
  domain?: string | undefined;
}

export interface DecideApprovalInput {
  decision: ApprovalVerdict;
  comment?: string | undefined;
}

export interface SessionIdentity {
  username: string;
  role: 'owner' | 'operator';
}

function applyGradeFilter(records: DecisionRecord[], grade: string | undefined): DecisionRecord[] {
  if (!grade) return records;
  return records.filter((r) => r.grade === grade);
}

function byCreatedAtDesc(a: DecisionRecord, b: DecisionRecord): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Pending work queue by default: D1 awaiting_approval + D2/D3 blocked.
 * An explicit single status may be requested; grade is filtered locally (zeus
 * exposes no grade query); domain is forwarded to zeus.
 */
export async function listApprovals(
  ctx: ServerContext,
  query: ListApprovalsQuery = {},
): Promise<DecisionRecord[]> {
  const domain = query.domain && query.domain.trim().length > 0 ? query.domain.trim() : undefined;
  const grade = query.grade && query.grade.trim().length > 0 ? query.grade.trim() : undefined;
  if (grade !== undefined && !GRADES.includes(grade as Grade)) {
    throw badRequest(`grade must be one of D0|D1|D2|D3, got ${JSON.stringify(query.grade)}`);
  }

  if (query.status !== undefined && query.status !== '') {
    if (!STATUSES.includes(query.status as DecisionStatus)) {
      throw badRequest(`status must be one of decided|awaiting_approval|blocked|rejected, got ${JSON.stringify(query.status)}`);
    }
    const records = await ctx.zeus.listDecisions({ status: query.status as DecisionStatus, ...(domain ? { domain } : {}) });
    return applyGradeFilter(records, grade).sort(byCreatedAtDesc);
  }

  const [asyncPending, blocked] = await Promise.all([
    ctx.zeus.listDecisions({ status: 'awaiting_approval', ...(domain ? { domain } : {}) }),
    ctx.zeus.listDecisions({ status: 'blocked', ...(domain ? { domain } : {}) }),
  ]);
  return applyGradeFilter([...asyncPending, ...blocked], grade).sort(byCreatedAtDesc);
}

export function getApproval(ctx: ServerContext, id: string): Promise<DecisionRecord> {
  return ctx.zeus.getDecision(id);
}

export function getReplay(
  ctx: ServerContext,
  id: string,
  format: 'json' | 'text' = 'json',
): Promise<unknown> {
  return ctx.zeus.replay(id, format);
}

/**
 * Approve / reject. The decision's grade is fetched first so RBAC can be
 * enforced here (D3 is owner-only) BEFORE touching zeus. Any further state
 * conflict (already decided, timeout, …) comes from zeus and is passed
 * through unchanged.
 */
export async function decideApproval(
  ctx: ServerContext,
  id: string,
  input: DecideApprovalInput,
  session: SessionIdentity,
): Promise<DecisionApprovalResponse> {
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw badRequest(`decision must be approve|reject, got ${JSON.stringify(input.decision)}`);
  }
  // 404 / upstream failures pass through from this call.
  const decision = await ctx.zeus.getDecision(id);
  if (!canApprove(session.role, decision.grade)) {
    throw forbidden(`${session.role} is not allowed to approve ${decision.grade} decisions`);
  }
  return ctx.zeus.approve(id, {
    decision: input.decision,
    approver: session.username,
    ...(input.comment && input.comment.length > 0 ? { comment: input.comment } : {}),
  });
}
