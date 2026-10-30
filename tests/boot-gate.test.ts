/**
 * Boot gate end-to-end coverage: `scripts/verify-required-env.ts` is wired as
 * npm predev/prestart and must refuse to start (exit 1, naming the variable)
 * when a required secret is missing or empty, and start (exit 0) when every
 * secret is present. Runs the real script in a child process so the exit
 * behavior — not just the thrown error — is what is under test.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-required-env.ts', import.meta.url));

/** Secrets stripped from the inherited env so each case controls them fully. */
const SECRET_NAMES = [
  'OPS_SESSION_SECRET',
  'OPS_OWNER_PASSWORD',
  'OPS_OPERATOR_PASSWORD',
  'ZEUS_INTERNAL_TOKEN',
  'COMMERCE_API_TOKEN',
] as const;

const SECRET_VALUES: Record<(typeof SECRET_NAMES)[number], string> = {
  OPS_SESSION_SECRET: 'boot-gate-session-secret',
  OPS_OWNER_PASSWORD: 'boot-gate-owner-password',
  OPS_OPERATOR_PASSWORD: 'boot-gate-operator-password',
  ZEUS_INTERNAL_TOKEN: 'boot-gate-zeus-token',
  COMMERCE_API_TOKEN: 'boot-gate-commerce-token',
};

interface GateResult {
  code: number | null;
  stderr: string;
}

function runGate(extraEnv: Record<string, string> = {}): Promise<GateResult> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !(SECRET_NAMES as readonly string[]).includes(name)) {
      env[name] = value;
    }
  }
  Object.assign(env, extraEnv);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', SCRIPT], { env });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('boot gate (predev/prestart verify-required-env)', () => {
  it('exits 0 with the required-env confirmation when every secret is present', async () => {
    const { code, stderr } = await runGate(SECRET_VALUES);
    expect(code).toBe(0);
    expect(stderr).toContain('required env OK');
  }, 15000);

  it('exits 1 and names OPS_SESSION_SECRET when no secrets are set', async () => {
    const { code, stderr } = await runGate();
    expect(code).toBe(1);
    expect(stderr).toContain('refusing to start');
    expect(stderr).toContain('Missing required secret env OPS_SESSION_SECRET');
  }, 15000);

  it('exits 1 and names the empty variable instead of starting', async () => {
    const { code, stderr } = await runGate({ ...SECRET_VALUES, OPS_OWNER_PASSWORD: '' });
    expect(code).toBe(1);
    expect(stderr).toContain('Missing required secret env OPS_OWNER_PASSWORD');
  }, 15000);
});
