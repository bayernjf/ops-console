import { useState } from 'react';
import type { Grade, OrgScaleTier } from '../server/upstream/types.js';

export interface OrgManagePanelProps {
  organizations: Array<{ id: string; name: string; scaleTier?: string }>;
  departments: Array<{ id: string; organizationId: string; name: string }>;
  positions: Array<{
    id: string;
    organizationId: string;
    departmentId: string;
    name: string;
    agentId?: string | undefined;
  }>;
}

const SCALE_OPTIONS: Array<{ value: OrgScaleTier; label: string }> = [
  { value: 'single', label: '单人' },
  { value: 'small', label: '小团队' },
  { value: 'team', label: '团队' },
  { value: 'division', label: '事业部' },
  { value: 'enterprise', label: '企业' },
];

const GRADES: Grade[] = ['D0', 'D1', 'D2', 'D3'];

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map(item => item.trim())
    .filter(item => item !== '');
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const body = data as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  }
  return `请求失败（${status}）`;
}

const sectionStyle = {
  padding: 16,
  border: 'var(--hair)',
  borderRadius: 8,
  background: 'var(--steel-850)',
  marginBottom: 14,
} as const;

const headingStyle = { fontSize: 14, margin: '0 0 10px' } as const;

/**
 * Tier0 org F2.1 owner-only modeling panel: create organizations, departments
 * and positions, then bind agents. The island only validates form shape; zeus
 * remains the source of truth for ids, parent existence and conflicts. Every
 * successful write reloads the SSR page rather than merging local state.
 */
export default function OrgManagePanel({
  organizations,
  departments,
  positions,
}: OrgManagePanelProps) {
  const firstOrgId = organizations[0]?.id ?? '';
  const firstDepartmentId = (orgId: string): string =>
    departments.find(dept => dept.organizationId === orgId)?.id ?? '';

  const [orgName, setOrgName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [scaleTier, setScaleTier] = useState<OrgScaleTier>('small');
  const [parentOrgId, setParentOrgId] = useState('');
  const [concurrencyLimit, setConcurrencyLimit] = useState('2');

  const [deptOrgId, setDeptOrgId] = useState(firstOrgId);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [deptParentId, setDeptParentId] = useState('');

  const [posOrgId, setPosOrgId] = useState(firstOrgId);
  const [posDeptId, setPosDeptId] = useState(firstDepartmentId(firstOrgId));
  const [posName, setPosName] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [requiredSkills, setRequiredSkills] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [decisionScope, setDecisionScope] = useState<Grade>('D2');

  const [agentDrafts, setAgentDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(positions.map(position => [position.id, position.agentId ?? ''])),
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ section: string; message: string } | null>(null);

  const deptOptions = departments.filter(dept => dept.organizationId === deptOrgId);
  const posDepartments = departments.filter(dept => dept.organizationId === posOrgId);
  const departmentName = new Map(departments.map(dept => [dept.id, dept.name]));

  async function submit(
    section: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (busy) return;
    setBusy(section);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, response.status));
      window.location.reload();
    } catch (thrown) {
      setError({
        section,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      });
    } finally {
      setBusy(null);
    }
  }

  function errorFor(section: string): string | null {
    return error?.section === section ? error.message : null;
  }

  function createOrganization(): void {
    const limit = Number(concurrencyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
      setError({ section: 'org', message: '并发上限必须是 1–8 的整数' });
      return;
    }
    const body: Record<string, unknown> = { name: orgName.trim(), scaleTier };
    if (orgId.trim()) body.id = orgId.trim();
    if (parentOrgId) body.parentId = parentOrgId;
    body.concurrencyLimit = limit;
    void submit('org', '/api/org/manage/organizations', body);
  }

  function createDepartment(): void {
    const body: Record<string, unknown> = {
      organizationId: deptOrgId,
      name: deptName.trim(),
      mission: deptMission.trim(),
    };
    if (deptParentId) body.parentId = deptParentId;
    void submit('dept', '/api/org/manage/departments', body);
  }

  function createPosition(): void {
    const body: Record<string, unknown> = {
      organizationId: posOrgId,
      departmentId: posDeptId,
      name: posName.trim(),
      decisionScope,
    };
    const responsibilitiesList = splitList(responsibilities);
    const skillsList = splitList(requiredSkills);
    const toolsList = splitList(allowedTools);
    if (responsibilitiesList.length) body.responsibilities = responsibilitiesList;
    if (skillsList.length) body.requiredSkills = skillsList;
    if (toolsList.length) body.allowedTools = toolsList;
    void submit('pos', '/api/org/manage/positions', body);
  }

  function bindAgent(positionId: string): void {
    const agentId = (agentDrafts[positionId] ?? '').trim();
    if (!agentId) {
      setError({ section: `assign:${positionId}`, message: '请填写 agentId' });
      return;
    }
    void submit(
      `assign:${positionId}`,
      `/api/org/manage/positions/${encodeURIComponent(positionId)}/assign-agent`,
      { agentId },
    );
  }

  return (
    <>
      <section style={sectionStyle}>
        <h2 style={headingStyle}>创建组织</h2>
        <form
          className="form-row"
          onSubmit={event => {
            event.preventDefault();
            createOrganization();
          }}
        >
          <label>
            名称
            <input
              value={orgName}
              placeholder="例如：内容运营组"
              onChange={event => setOrgName(event.target.value)}
            />
          </label>
          <label>
            ID（可选）
            <input
              value={orgId}
              placeholder="org:content"
              onChange={event => setOrgId(event.target.value)}
            />
          </label>
          <label>
            规模
            <select
              value={scaleTier}
              onChange={event => setScaleTier(event.target.value as OrgScaleTier)}
            >
              {SCALE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            上级组织（可选）
            <select value={parentOrgId} onChange={event => setParentOrgId(event.target.value)}>
              <option value="">无</option>
              {organizations.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>
          <label>
            并发上限
            <input
              type="number"
              min="1"
              max="8"
              value={concurrencyLimit}
              onChange={event => setConcurrencyLimit(event.target.value)}
            />
          </label>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy !== null || !orgName.trim()}
          >
            {busy === 'org' ? '创建中…' : '创建组织'}
          </button>
        </form>
        {errorFor('org') ? (
          <p style={{ color: 'var(--alert)', margin: 0 }} role="alert">{errorFor('org')}</p>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>创建部门</h2>
        {organizations.length === 0 ? (
          <p className="hint">先创建组织，再创建部门。</p>
        ) : (
          <form
            className="form-row"
            onSubmit={event => {
              event.preventDefault();
              createDepartment();
            }}
          >
            <label>
              组织
              <select
                value={deptOrgId}
                onChange={event => {
                  setDeptOrgId(event.target.value);
                  setDeptParentId('');
                }}
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input
                value={deptName}
                placeholder="例如：内容生产部"
                onChange={event => setDeptName(event.target.value)}
              />
            </label>
            <label>
              使命
              <input
                value={deptMission}
                placeholder="该部门负责什么"
                onChange={event => setDeptMission(event.target.value)}
              />
            </label>
            <label>
              上级部门（可选）
              <select value={deptParentId} onChange={event => setDeptParentId(event.target.value)}>
                <option value="">无</option>
                {deptOptions.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={busy !== null || !deptOrgId || !deptName.trim() || !deptMission.trim()}
            >
              {busy === 'dept' ? '创建中…' : '创建部门'}
            </button>
          </form>
        )}
        {errorFor('dept') ? (
          <p style={{ color: 'var(--alert)', margin: 0 }} role="alert">{errorFor('dept')}</p>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>创建岗位</h2>
        {organizations.length === 0 || departments.length === 0 ? (
          <p className="hint">先创建组织和部门，再创建岗位。</p>
        ) : (
          <form
            className="form-row"
            onSubmit={event => {
              event.preventDefault();
              createPosition();
            }}
          >
            <label>
              组织
              <select
                value={posOrgId}
                onChange={event => {
                  const nextOrg = event.target.value;
                  setPosOrgId(nextOrg);
                  setPosDeptId(firstDepartmentId(nextOrg));
                }}
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label>
              部门
              <select value={posDeptId} onChange={event => setPosDeptId(event.target.value)}>
                {posDepartments.length === 0 ? <option value="">该组织暂无部门</option> : null}
                {posDepartments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input
                value={posName}
                placeholder="例如：内容策划"
                onChange={event => setPosName(event.target.value)}
              />
            </label>
            <label>
              决策档
              <select
                value={decisionScope}
                onChange={event => setDecisionScope(event.target.value as Grade)}
              >
                {GRADES.map(grade => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
            </label>
            <label>
              职责（逗号分隔）
              <input
                value={responsibilities}
                placeholder="选题, 撰稿, 校对"
                onChange={event => setResponsibilities(event.target.value)}
              />
            </label>
            <label>
              必需技能（逗号分隔）
              <input
                value={requiredSkills}
                placeholder="copywriting, seo"
                onChange={event => setRequiredSkills(event.target.value)}
              />
            </label>
            <label>
              允许工具（逗号分隔）
              <input
                value={allowedTools}
                placeholder="web-search, editor"
                onChange={event => setAllowedTools(event.target.value)}
              />
            </label>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={busy !== null || !posOrgId || !posDeptId || !posName.trim()}
            >
              {busy === 'pos' ? '创建中…' : '创建岗位'}
            </button>
          </form>
        )}
        {errorFor('pos') ? (
          <p style={{ color: 'var(--alert)', margin: 0 }} role="alert">{errorFor('pos')}</p>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>绑定 agent</h2>
        {positions.length === 0 ? (
          <p className="hint">还没有岗位可绑定。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>岗位</th>
                  <th>部门</th>
                  <th>当前 agent</th>
                  <th>绑定 / 换绑</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(position => (
                  <tr key={position.id}>
                    <td>{position.name}<br /><span className="hint">{position.id}</span></td>
                    <td>{departmentName.get(position.departmentId) ?? position.departmentId}</td>
                    <td>{position.agentId ?? '未绑定'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={agentDrafts[position.id] ?? ''}
                          placeholder="agentId"
                          onChange={event => {
                            const value = event.target.value;
                            setAgentDrafts(current => ({ ...current, [position.id]: value }));
                          }}
                        />
                        <button
                          className="btn"
                          type="button"
                          disabled={busy !== null}
                          onClick={() => bindAgent(position.id)}
                        >
                          {busy === `assign:${position.id}` ? '绑定中…' : '绑定'}
                        </button>
                      </div>
                      {errorFor(`assign:${position.id}`) ? (
                        <p style={{ color: 'var(--alert)', margin: '4px 0 0' }} role="alert">
                          {errorFor(`assign:${position.id}`)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
