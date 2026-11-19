import { callJson } from './http.js';
import type {
  ApprovalVerdict,
  AssignAgentInput,
  ConsoleGoalStatus,
  CreateDepartmentInput,
  CreateOrgGoalInput,
  CreateOrganizationInput,
  CreatePositionInput,
  DecisionApprovalResponse,
  DecisionPolicy,
  DecisionRecord,
  DecisionStatus,
  ExperienceCandidate,
  OrgDepartment,
  OrgGoal,
  OrgGoalTemplate,
  OrgOrganization,
  OrgPosition,
  OrgTask,
  PositionSopView,
  TraceListFilter,
  TraceQueryResult,
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

  /**
   * TracePort v1 §5 (D-5): cross-intent trace query over zeus GET
   * /api/v1/traces (bearer-gated; payloads are redacted and bounded on the
   * zeus side per D-4). Pure pass-through: filters forward verbatim, zeus
   * owns validation and its 400 invalid_request responses pass through
   * unchanged, transport failures fail closed as 503.
   */
  async getTraces(filter: TraceListFilter = {}): Promise<TraceQueryResult> {
    return callJson<TraceQueryResult>(this.baseUrl, this.token, '/api/v1/traces', {
      query: {
        ...(filter.agent ? { agent: filter.agent } : {}),
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        ...(filter.minCostMicros ? { min_cost_micros: filter.minCostMicros } : {}),
        ...(filter.maxCostMicros ? { max_cost_micros: filter.maxCostMicros } : {}),
        ...(filter.traceId ? { trace_id: filter.traceId } : {}),
        ...(filter.limit ? { limit: filter.limit } : {}),
      },
    });
  }

  async applyThresholds(payload: ThresholdPayload): Promise<DecisionPolicy> {
    return callJson<DecisionPolicy>(this.baseUrl, this.token, '/api/v1/org/policy/thresholds', {
      method: 'POST',
      body: payload,
    });
  }

  /** Tier0 org M2 F2.1: organization list (bearer, read-only). */
  async listOrganizations(): Promise<OrgOrganization[]> {
    const body = await callJson<{ organizations: OrgOrganization[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/organizations',
    );
    return body.organizations;
  }

  async listDepartments(organizationId?: string): Promise<OrgDepartment[]> {
    const body = await callJson<{ departments: OrgDepartment[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/departments',
      { query: organizationId ? { organizationId } : {} },
    );
    return body.departments;
  }

  async listPositions(organizationId?: string): Promise<OrgPosition[]> {
    const body = await callJson<{ positions: OrgPosition[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/positions',
      { query: organizationId ? { organizationId } : {} },
    );
    return body.positions;
  }

  /** Tier0 org F2.1: create an organization (owner-only at the console edge). */
  async createOrganization(input: CreateOrganizationInput): Promise<OrgOrganization> {
    return callJson<OrgOrganization>(this.baseUrl, this.token, '/api/v1/org/organizations', {
      method: 'POST',
      body: input,
    });
  }

  async createDepartment(input: CreateDepartmentInput): Promise<OrgDepartment> {
    return callJson<OrgDepartment>(this.baseUrl, this.token, '/api/v1/org/departments', {
      method: 'POST',
      body: input,
    });
  }

  async createPosition(input: CreatePositionInput): Promise<OrgPosition> {
    return callJson<OrgPosition>(this.baseUrl, this.token, '/api/v1/org/positions', {
      method: 'POST',
      body: input,
    });
  }

  /** Bind or rebind an agent to a position; zeus validates both ids. */
  async assignAgent(positionId: string, agentId: string): Promise<OrgPosition> {
    const payload: AssignAgentInput = { agentId };
    return callJson<OrgPosition>(
      this.baseUrl,
      this.token,
      `/api/v1/org/positions/${encodeURIComponent(positionId)}/assign-agent`,
      { method: 'POST', body: payload },
    );
  }

  /** Tier0 org M2 F2.2: task queue projection (belt of GET /api/v1/org/tasks). */
  async listOrgTasks(organizationId?: string): Promise<OrgTask[]> {
    const body = await callJson<{ tasks: OrgTask[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/tasks',
      { query: organizationId ? { organizationId } : {} },
    );
    return body.tasks;
  }

  /** F5.1: registered goals for one organization (read-only projection). */
  async listOrgGoals(organizationId?: string): Promise<OrgGoal[]> {
    const body = await callJson<{ goals: OrgGoal[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/goals',
      { query: organizationId ? { organizationId } : {} },
    );
    return body.goals;
  }

  /** F5.3: code-owned built-in template catalog. */
  async listGoalTemplates(): Promise<OrgGoalTemplate[]> {
    const body = await callJson<{ templates: OrgGoalTemplate[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/goal-templates',
    );
    return body.templates;
  }

  /** F5.1: register a goal; zeus validates schedule/template semantics. */
  async createOrgGoal(input: CreateOrgGoalInput): Promise<OrgGoal> {
    return callJson<OrgGoal>(this.baseUrl, this.token, '/api/v1/org/goals', {
      method: 'POST',
      body: input,
    });
  }

  /**
   * F5.1 status transition: pause/resume/archive a goal. Only the status
   * field is sent — title, period, schedule and templates stay untouched.
   * zeus re-validates the retained schedule against the goal's period.
   */
  async updateOrgGoalStatus(id: string, status: ConsoleGoalStatus): Promise<OrgGoal> {
    return callJson<OrgGoal>(
      this.baseUrl,
      this.token,
      `/api/v1/org/goals/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { status } },
    );
  }

  /** F4.2: rule-derived experience candidates (read-only projection). */
  async listExperienceCandidates(organizationId?: string): Promise<ExperienceCandidate[]> {
    const body = await callJson<{ candidates: ExperienceCandidate[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/experience',
      { query: organizationId ? { organizationId } : {} },
    );
    return body.candidates;
  }

  /**
   * F4.2 human review gate: promote one pending candidate into the SOP
   * catalog. zeus owns the gate; a missing candidate or unknown target skill
   * comes back as its own 4xx and is passed through unchanged.
   */
  async promoteExperience(id: string, skillId?: string): Promise<ExperienceCandidate> {
    return callJson<ExperienceCandidate>(
      this.baseUrl,
      this.token,
      `/api/v1/org/experience/${encodeURIComponent(id)}/promote`,
      { method: 'POST', body: skillId ? { skillId } : {} },
    );
  }

  /** F4.2: static SOP catalog with promoted advisories, optionally filtered. */
  async listSops(organizationId?: string, skillId?: string): Promise<PositionSopView[]> {
    const body = await callJson<{ sops: PositionSopView[] }>(
      this.baseUrl,
      this.token,
      '/api/v1/org/sops',
      {
        query: {
          ...(organizationId ? { organizationId } : {}),
          ...(skillId ? { skillId } : {}),
        },
      },
    );
    return body.sops;
  }

  /**
   * Tier0 org F2.3: settle-and-resume an org task blocked on a human-review
   * decision. zeus approves/rejects the decision and resumes the task in one
   * atomic call; the settled decision rides back on the response. The plain
   * approval route must not be used for these decisions - it would leave the
   * task awaiting_decision forever.
   */
  async resumeOrgTask(
    taskId: string,
    payload: ApprovalPayload,
  ): Promise<{ task: OrgTask; decision?: DecisionRecord }> {
    return callJson<{ task: OrgTask; decision?: DecisionRecord }>(
      this.baseUrl,
      this.token,
      `/api/v1/org/tasks/${encodeURIComponent(taskId)}/resume`,
      { method: 'POST', body: payload },
    );
  }
}
