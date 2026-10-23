import type { Role } from './config.js';
import type { Grade } from './upstream/types.js';

/**
 * Minimal RBAC matrix (Tier0 M8, single tenant):
 *  - owner:    approves D1/D2/D3, changes thresholds, configures notifications.
 *  - operator: operates and approves D1/D2; cannot change thresholds and
 *              cannot approve D3.
 */
export function canApprove(role: Role, grade: Grade): boolean {
  if (role === 'owner') return true;
  return grade === 'D1' || grade === 'D2';
}

export function canChangeThresholds(role: Role): boolean {
  return role === 'owner';
}

export function canConfigureNotify(role: Role): boolean {
  return role === 'owner';
}

/** Channel-account registration carries credential references: owner only. */
export function canManageChannelAccounts(role: Role): boolean {
  return role === 'owner';
}

export function canDoControlledAction(role: Role): boolean {
  return role === 'owner' || role === 'operator';
}
