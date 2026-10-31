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

/**
 * TracePort v1 span model (bayjf zeus-core-TracePort规范v1 §2/§5), mirroring
 * zeus src/observability/trace.ts + trace-query.ts. Read-only pass-through
 * views: payload text is already redacted and bounded (D-4) by zeus before it
 * leaves the process — the console never re-stores it.
 */
export type TraceSpanKind =
  | 'intent'
  | 'branch'
  | 'dag-node'
  | 'decide'
  | 'tool'
  | 'model'
  | 'decision-step';

/** Model-call facts carried by a model span (TracePort v1 §2). */
export interface TraceModelCall {
  backend: string;
  model: string;
  /** Decision primitive that drove the call (noul/choice/score). */
  kind?: string;
  tokensIn?: number;
  tokensOut?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  tokensEstimated?: boolean;
  /** Family-wide cost unit; micros share the model-hub unit. */
  costMicros?: number | null;
  latencyMs?: number;
  error?: string;
}

/** Decision-step facts carried by a decision-step span (TracePort v1 §2). */
export interface TraceDecisionStep {
  name: 'fanout' | 'aggregate' | 'arbitration' | 'judge';
  vassals?: string[];
  conclusion?: string;
  latencyMs?: number;
}

export interface TraceSpan {
  traceId: string;
  /** Branch runId; the intent root uses the intent id. */
  spanId: string;
  parentSpanId?: string;
  kind: TraceSpanKind;
  vassal?: string;
  skill?: string;
  realm?: string;
  startedAt: string;
  endedAt?: string;
  outcome?: string;
  /** One-line summary of the call fact (already-redacted on zeus side). */
  summary?: string;
  call?: TraceModelCall;
  step?: TraceDecisionStep;
  events: Array<{ kind: string; at: string; detail?: string }>;
}

/** tree.root is the intent span; tree.spans holds the descendants (flat). */
export interface TraceTree {
  traceId: string;
  root: TraceSpan;
  spans: TraceSpan[];
}

/** Aggregate decision-call facts of one query result (TracePort v1 §5). */
export interface TraceSummary {
  /** Sum of the measured model-call latencies in the returned trees. */
  totalLatencyMs: number;
  /** Sum of model-call costs in micros; calls without a known price add 0. */
  totalCostMicros: number;
  /** Model calls that ended in an error. */
  errorCount: number;
}

/** zeus GET /api/v1/traces response: matched span trees + aggregate summary. */
export interface TraceQueryResult {
  traces: TraceTree[];
  summary: TraceSummary & { count: number };
}

/**
 * zeus GET /api/v1/traces query parameters (TracePort v1 §5). Values stay
 * strings so the BFF forwards them verbatim; zeus owns validation (400
 * invalid_request passes through unchanged).
 */
export interface TraceListFilter {
  agent?: string;
  /** ISO timestamp lower bound. */
  from?: string;
  /** ISO timestamp upper bound. */
  to?: string;
  minCostMicros?: string;
  maxCostMicros?: string;
  traceId?: string;
  limit?: string;
}
