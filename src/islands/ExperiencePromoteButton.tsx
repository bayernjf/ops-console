import { useState } from 'react';

export interface ExperiencePromoteButtonProps {
  candidateId: string;
  defaultSkillId?: string | undefined;
  /** Skill ids present in the SOP catalog; the target of a promotion. */
  skills: string[];
}

/**
 * Tier0 org M4 F4.2 human review gate, owner-only. The button posts to
 * /api/org/experience/:id/promote and reloads so the SSR candidate table and
 * SOP advisories re-read the same upstream truth. Upstream 4xx messages are
 * surfaced verbatim; the console never invents a promotion result.
 */
export default function ExperiencePromoteButton({
  candidateId,
  defaultSkillId,
  skills,
}: ExperiencePromoteButtonProps) {
  const [skillId, setSkillId] = useState(defaultSkillId ?? skills[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/org/experience/${encodeURIComponent(candidateId)}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(skillId ? { skillId } : {}),
        },
      );
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? `提升失败（${response.status}）`);
      }
      window.location.reload();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {skills.length > 1 ? (
        <select
          aria-label="目标岗位技能"
          value={skillId}
          onChange={event => setSkillId(event.target.value)}
        >
          {skills.map(skill => (
            <option key={skill} value={skill}>{skill}</option>
          ))}
        </select>
      ) : skillId ? (
        <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>→ {skillId}</span>
      ) : null}
      <button
        className="btn btn--primary"
        type="button"
        disabled={busy}
        onClick={() => void promote()}
      >
        {busy ? '提升中…' : '提升到 SOP'}
      </button>
      {error ? (
        <span role="alert" style={{ color: 'var(--alert)', fontSize: 12 }}>{error}</span>
      ) : null}
    </div>
  );
}
