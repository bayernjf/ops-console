import { useState } from 'react';
import type { OrgGoalPeriod } from '../server/upstream/types.js';

export interface OrgGoalCreateFormProps {
  organizations: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; title: string }>;
  initialOrganizationId: string;
}

/**
 * Tier0 org M5 F5.1 create form. Only shape is checked here; zeus owns
 * schedule/template semantics. A successful create reloads so the SSR table
 * shows the new goal with the same upstream truth as everything else.
 */
export default function OrgGoalCreateForm({
  organizations,
  templates,
  initialOrganizationId,
}: OrgGoalCreateFormProps) {
  const [organizationId, setOrganizationId] = useState(
    initialOrganizationId || organizations[0]?.id || '',
  );
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState<OrgGoalPeriod>('daily');
  const [templateRef, setTemplateRef] = useState('');
  const [hourUtc, setHourUtc] = useState('8');
  const [minuteUtc, setMinuteUtc] = useState('0');
  const [weekdayUtc, setWeekdayUtc] = useState('1');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { organizationId, title, period };
      if (templateRef) body.templateRef = templateRef;
      if (projectId.trim()) body.projectId = projectId.trim();
      if (period !== 'once') {
        body.schedule = {
          hourUtc: Number(hourUtc),
          minuteUtc: Number(minuteUtc),
          ...(period === 'weekly' ? { weekdayUtc: Number(weekdayUtc) } : {}),
        };
      }

      const response = await fetch('/api/org/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? `创建失败（${response.status}）`);
      }
      window.location.reload();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        padding: 16,
        border: 'var(--hair)',
        borderRadius: 8,
        background: 'var(--steel-850)',
        marginBottom: 14,
      }}
    >
      <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>登记目标</h2>
      <form
        className="form-row"
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          组织
          <select
            value={organizationId}
            onChange={event => setOrganizationId(event.target.value)}
          >
            {organizations.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </label>
        <label>
          标题
          <input
            value={title}
            placeholder="例如：每日经营日报"
            onChange={event => setTitle(event.target.value)}
          />
        </label>
        <label>
          周期
          <select
            value={period}
            onChange={event => setPeriod(event.target.value as OrgGoalPeriod)}
          >
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
            <option value="once">手动（不排班）</option>
          </select>
        </label>
        <label>
          模板
          <select value={templateRef} onChange={event => setTemplateRef(event.target.value)}>
            <option value="">无（单任务）</option>
            {templates.map(template => (
              <option key={template.id} value={template.id}>{template.title}</option>
            ))}
          </select>
        </label>
        {period !== 'once' ? (
          <>
            <label>
              UTC 时
              <input
                type="number"
                min="0"
                max="23"
                value={hourUtc}
                onChange={event => setHourUtc(event.target.value)}
              />
            </label>
            <label>
              UTC 分
              <input
                type="number"
                min="0"
                max="59"
                value={minuteUtc}
                onChange={event => setMinuteUtc(event.target.value)}
              />
            </label>
          </>
        ) : null}
        {period === 'weekly' ? (
          <label>
            星期（UTC）
            <select value={weekdayUtc} onChange={event => setWeekdayUtc(event.target.value)}>
              <option value="0">周日</option>
              <option value="1">周一</option>
              <option value="2">周二</option>
              <option value="3">周三</option>
              <option value="4">周四</option>
              <option value="5">周五</option>
              <option value="6">周六</option>
            </select>
          </label>
        ) : null}
        <label>
          Hub 项目（可选）
          <input
            value={projectId}
            placeholder="project id"
            onChange={event => setProjectId(event.target.value)}
          />
        </label>
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy || !organizationId || !title.trim()}
        >
          {busy ? '创建中…' : '创建目标'}
        </button>
      </form>
      {error ? <p style={{ color: 'var(--alert)', margin: 0 }} role="alert">{error}</p> : null}
    </section>
  );
}
