import { timingSafeEqual } from 'node:crypto';
import type { Config, Role } from './config.js';

/**
 * Authentication (Tier0 M8). No user table, no registration.
 *
 *  - `local`: fixed role credentials from environment, constant-time compared.
 *  - `cf`:    production seam reserved for Cloudflare Access (trust verified
 *             identity headers; JWT assertion verification to be added when the
 *             external Access deployment exists).
 *  - `oidc`:  VPS fallback seam reserved for GitHub OIDC.
 *
 * Only `local` is implemented and verified this milestone; cf/oidc are
 * explicitly documented seams and must not silently grant access.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function authenticateLocal(
  config: Config,
  username: string,
  password: string,
): { username: string; role: Role } | null {
  for (const role of ['owner', 'operator'] as const) {
    const account = config.accounts[role];
    if (safeEqual(username, account.username) && safeEqual(password, account.password)) {
      return { username: account.username, role: account.role };
    }
  }
  return null;
}

export function authenticate(config: Config, username: string, password: string): { username: string; role: Role } | null {
  if (config.authMode === 'local') return authenticateLocal(config, username, password);
  // Reserved seams are not implemented and must fail closed.
  throw new Error(`OPS_AUTH_MODE=${config.authMode} is a reserved seam and is not implemented; use local`);
}
