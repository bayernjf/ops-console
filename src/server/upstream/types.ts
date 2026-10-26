/**
 * Upstream contract shapes. These mirror the real zeus / commerce-os HTTP
 * contracts (see ../zeus/src/core/decision-service/types.ts and
 * ../commerce-os/src/dashboard/dashboard-service.ts). They are thin pass-through
 * views — the console holds no business rules.
 */

export type Grade = 'D0' | 'D1' | 'D2' | 'D3';
export type DecisionStatus = 'decided' | 'awaiting_approval' | 'blocked' | 'rejected';
export type DecisionMode = 'auto' | 'approve-async' | 'approve-sync' | 'human-led';
export type ApprovalVerdict = 'approve' | 'reject';

export interface Amount {
  value: number;
  currency: string;
}

export interface DecisionRecord {
  id: string;
  intent: string;
  domain: string;
  amount?: Amount;
  riskTags?: string[];
  impact: string;
  reversibility: string;
  proposal?: unknown;
  idempotencyKey?: string;
  grade: Grade;
  mode: DecisionMode;
  status: DecisionStatus;
  ruleId: string;
  gradeReason: string;
  policyVersion: number;
  slaHours?: number;
  createdAt: string;
  updatedAt: string;
  auditSeq: number;
  decidedAt?: string;
  /** Waiting records enter the pending-but-late window at this time. Absent
   *  on records that never breached their SLA (older zeus kernels omit it). */
  lateAt?: string;
  /** Waiting records with an SLA expire at this ISO time. Absent when the
   *  matching rule sets no slaHours (older zeus kernels / D0/D1 rules). */
  timeoutAt?: string;
  result?: {
    outcome: 'auto' | 'approved' | 'rejected' | 'timed-out';
    at: string;
    approver?: string;
    comment?: string;
  };
  approvals: Array<{
    approver: string;
    verdict: ApprovalVerdict;
    comment?: string;
    at: string;
  }>;
}

/** A single grading rule; match shape is owned by zeus policy (opaque here). */
export interface DecisionPolicyRule {
  id: string;
  match: Record<string, unknown>;
  grade: Grade;
}

/** zeus GET /api/v1/policy and POST /api/v1/org/policy/thresholds response. */
export interface DecisionPolicy {
  version: number;
  defaultGrade: Grade;
  rules: DecisionPolicyRule[];
  [key: string]: unknown;
}

/**
 * zeus POST /api/v1/decisions/:id/approval response (its `toResponse` view):
 * the settled summary, NOT the full record. Passed through verbatim.
 */
export interface DecisionApprovalResponse {
  decisionId: string;
  grade: Grade;
  mode: DecisionMode;
  status: DecisionStatus;
  ruleId: string;
  proposal?: unknown;
  auditSeq: number;
}

export interface DashboardMetrics {
  currency: string;
  orders: { total: number; paid: number; completed: number; grossAmount: number };
  refunds: { total: number; succeeded: number; refundedAmount: number };
  content: { published: number };
  netAmount: number;
  generatedAt: string;
}

/** Upstream error shape (both zeus and commerce use {error:{code,message,...}}). */
export interface UpstreamErrorBody {
  error: { code: string; message: string; retryable?: boolean };
}
