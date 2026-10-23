import { forbidden, badRequest } from './errors.js';
import { canApprove, canDoControlledAction } from './rbac.js';
import type { ServerContext } from './context.js';

/**
 * Controlled-write orchestration over commerce-os (Tier0 M8 第二批).
 *
 * Integration constraint (must stay true): decisions raised by commerce
 * (listing D3 / refund D2) only execute their side effect — publishing to the
 * channel or calling the channel refund API — when commerce's OWN endpoints
 * are called (`/api/v1/listings/:decisionId/approve|reject`,
 * `/api/v1/refunds/:id/decision`). The generic zeus approval workbench must
 * NOT be used to settle commerce-raised decisions, otherwise the business
 * action never happens. All operations below therefore call the commerce
 * client; zeus is touched only to read the decision grade for RBAC.
 *
 * RBAC: any signed-in operator may perform controlled actions; settling a
 * D3-grade decision (listing approval) is owner-only. The session username is
 * injected as approver/operator — never trusted from the client.
 */

export interface SessionIdentity {
  username: string;
  role: 'owner' | 'operator';
}

function requireOperable(session: SessionIdentity): void {
  if (!canDoControlledAction(session.role)) {
    throw forbidden(`${session.role} may not perform controlled operations`);
  }
}

/** RBAC gate keyed off the zeus decision that commerce parked. */
async function requireGradeAllowed(
  ctx: ServerContext,
  decisionId: string,
  session: SessionIdentity,
  action: string,
): Promise<void> {
  // 404 / 503 pass through from here unchanged.
  const decision = await ctx.zeus.getDecision(decisionId);
  if (!canApprove(session.role, decision.grade)) {
    throw forbidden(`${session.role} may not ${action} ${decision.grade} decisions`);
  }
}

// ---- Products / channel accounts ---------------------------------------

export function listProducts(ctx: ServerContext) {
  return ctx.commerce.listProducts();
}

export function getProduct(ctx: ServerContext, id: string) {
  return ctx.commerce.getProduct(id);
}

export function listChannelAccounts(ctx: ServerContext) {
  return ctx.commerce.listChannelAccounts();
}

export async function createProduct(
  ctx: ServerContext,
  input: {
    title: string;
    channelAccountId?: string | undefined;
    attributes?: Record<string, unknown> | undefined;
    skus: Array<{ skuCode: string; specs?: Record<string, unknown> | undefined; price: number; currency?: string | undefined }>;
  },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (!input.title?.trim()) throw badRequest('title is required');
  if (!Array.isArray(input.skus) || input.skus.length === 0) throw badRequest('at least one sku is required');
  return ctx.commerce.createProduct(input);
}

// ---- Listings (content publish; D3 owner-only settle) --------------------

export async function submitListing(
  ctx: ServerContext,
  input: {
    productId: string;
    channelAccountId: string;
    contentType?: string | undefined;
    sellingPoints?: string[] | undefined;
  },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (!input.productId) throw badRequest('productId is required');
  if (!input.channelAccountId) throw badRequest('channelAccountId is required');
  // 423 awaiting_approval is a normal hold, surfaced by the caller as-is.
  return ctx.commerce.submitListing({
    productId: input.productId,
    channelAccountId: input.channelAccountId,
    contentType: input.contentType ?? 'detail',
    ...(input.sellingPoints ? { sellingPoints: input.sellingPoints } : {}),
  });
}

export async function approveListing(
  ctx: ServerContext,
  decisionId: string,
  input: { comment?: string | undefined },
  session: SessionIdentity,
) {
  requireOperable(session);
  await requireGradeAllowed(ctx, decisionId, session, 'approve');
  return ctx.commerce.approveListing(decisionId, {
    approver: session.username,
    ...(input.comment ? { comment: input.comment } : {}),
  });
}

export async function rejectListing(
  ctx: ServerContext,
  decisionId: string,
  input: { comment?: string | undefined },
  session: SessionIdentity,
) {
  requireOperable(session);
  await requireGradeAllowed(ctx, decisionId, session, 'reject');
  return ctx.commerce.rejectListing(decisionId, {
    approver: session.username,
    ...(input.comment ? { comment: input.comment } : {}),
  });
}

// ---- Orders --------------------------------------------------------------

export function listOrders(ctx: ServerContext) {
  return ctx.commerce.listOrders();
}

export function getOrder(ctx: ServerContext, id: string) {
  return ctx.commerce.getOrder(id);
}

export async function importOrders(
  ctx: ServerContext,
  input: { channelAccountId: string; since?: string | undefined },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (!input.channelAccountId) throw badRequest('channelAccountId is required');
  return ctx.commerce.importOrders({ channelAccountId: input.channelAccountId, ...(input.since ? { since: input.since } : {}) });
}

// ---- Refunds (D2 settle: owner and operator both allowed) ----------------

export function getRefund(ctx: ServerContext, id: string) {
  return ctx.commerce.getRefund(id);
}

export async function requestRefund(
  ctx: ServerContext,
  input: {
    orderId: string;
    lines: Array<{ orderItemId?: string | undefined; qty?: number | undefined; amount?: number | undefined }>;
    reason: string;
  },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (!input.orderId) throw badRequest('orderId is required');
  if (!input.reason?.trim()) throw badRequest('reason is required');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw badRequest('at least one line is required');
  // 423 awaiting_approval is a normal hold, surfaced by the caller as-is.
  return ctx.commerce.requestRefund({ orderId: input.orderId, lines: input.lines, reason: input.reason });
}

export async function decideRefund(
  ctx: ServerContext,
  refundId: string,
  input: { verdict: 'approve' | 'reject'; comment?: string | undefined },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (input.verdict !== 'approve' && input.verdict !== 'reject') {
    throw badRequest("verdict must be 'approve' or 'reject'");
  }
  // RBAC: look up the parked zeus decision (a refund can in principle be any
  // grade). No decisionId means nothing to gate; commerce validates state.
  const refund = await ctx.commerce.getRefund(refundId);
  const decisionId = (refund as { refund: { decisionId?: string } }).refund.decisionId;
  if (decisionId) {
    await requireGradeAllowed(ctx, decisionId, session, input.verdict);
  }
  return ctx.commerce.decideRefund(refundId, {
    verdict: input.verdict,
    approver: session.username,
    ...(input.comment ? { comment: input.comment } : {}),
  });
}

// ---- Inventory -------------------------------------------------------------

export function listInventory(ctx: ServerContext) {
  return ctx.commerce.listInventory();
}

export async function setInventory(
  ctx: ServerContext,
  input: { skuId: string; qty: number },
  session: SessionIdentity,
) {
  requireOperable(session);
  if (!input.skuId) throw badRequest('skuId is required');
  if (!Number.isInteger(input.qty) || input.qty < 0) throw badRequest('qty must be a non-negative integer');
  return ctx.commerce.setInventory({ skuId: input.skuId, qty: input.qty });
}
