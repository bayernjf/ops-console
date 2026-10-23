import { callJson } from './http.js';
import type {
  ApprovalVerdict,
  DecisionApprovalResponse,
  DecisionPolicy,
  DecisionRecord,
  DecisionStatus,
} from './types.js';

export interface DecisionListFilter {
  status?: DecisionStatus;
  domain?: string;
}

export interface ApprovalPayload {
  decision: ApprovalVerdict;
  approver: string;
  comment?: string;
}

export interface ThresholdPayload {
  d1MaxAmount?: number;
  d2MaxAmount?: number;
  defaultGrade?: string;
  actor: string;
}

/** Thin typed client over zeus HTTP API v1. No local decision logic. */
export class ZeusUpstream {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async listDecisions(filter: DecisionListFilter = {}): Promise<DecisionRecord[]> {
    const body = await callJson<{ decisions: DecisionRecord[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/decisions',
      { query: { ...(filter.status ? { status: filter.status } : {}), ...(filter.domain ? { domain: filter.domain } : {}) } },
    );
    return body.decisions;
  }

  /** Pending work queues: D1 awaiting_approval, D2/D3 blocked. */
  async listPending(): Promise<DecisionRecord[]> {
    const [asyncPending, blocked] = await Promise.all([
      this.listDecisions({ status: 'awaiting_approval' }),
      this.listDecisions({ status: 'blocked' }),
    ]);
    return [...asyncPending, ...blocked].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** zeus returns the raw DecisionRecord (no {decision} wrapper). */
  async getDecision(id: string): Promise<DecisionRecord> {
    return callJson<DecisionRecord>(
      this.baseUrl,
      this.token,
      `/api/v1/decisions/${encodeURIComponent(id)}`,
    );
  }

  /** zeus returns its settled summary (toResponse), not the full record. */
  async approve(id: string, payload: ApprovalPayload): Promise<DecisionApprovalResponse> {
    return callJson<DecisionApprovalResponse>(
      this.baseUrl,
      this.token,
      `/api/v1/decisions/${encodeURIComponent(id)}/approval`,
      { method: 'POST', body: payload },
    );
  }

  async replay(id: string, format: 'json' | 'text' = 'json'): Promise<unknown> {
    return callJson<unknown>(this.baseUrl, this.token, `/api/v1/decisions/${encodeURIComponent(id)}/replay`, {
      query: { format },
    });
  }

  async getPolicy(): Promise<DecisionPolicy> {
    return callJson<DecisionPolicy>(this.baseUrl, this.token, '/api/v1/policy');
  }

  async applyThresholds(payload: ThresholdPayload): Promise<DecisionPolicy> {
    return callJson<DecisionPolicy>(this.baseUrl, this.token, '/api/v1/org/policy/thresholds', {
      method: 'POST',
      body: payload,
    });
  }
}
