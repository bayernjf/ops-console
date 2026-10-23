import { describe, expect, it, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import { UpstreamError } from '../src/server/upstream/http.js';
import { createContext } from '../src/server/context.js';
import {
  approveListing,
  createProduct,
  decideRefund,
  importOrders,
  listInventory,
  listOrders,
  listProducts,
  rejectListing,
  requestRefund,
  setInventory,
  submitListing,
} from '../src/server/commerce-ops-service.js';

/**
 * Batch-2 controlled writes over a node:http fake commerce + fake zeus on
 * localhost; the real typed clients (global fetch) hit them, so the full
 * network path is exercised. No function mocks.
 */

const OWNER = { username: 'owner', role: 'owner' as const };
const OPERATOR = { username: 'operator', role: 'operator' as const };

interface FakeState {
  commerce: Server;
  zeus: Server;
  commerceBase: string;
  zeusBase: string;
  commerceCalls: {
    approveListing: unknown[];
    rejectListing: unknown[];
    refundDecision: unknown[];
    inventory: unknown[];
  };
  grades: Record<string, string>;
}

async function startFakes(): Promise<FakeState> {
  const state: FakeState = {
    commerce: null as unknown as Server,
    zeus: null as unknown as Server,
    commerceBase: '',
    zeusBase: '',
    commerceCalls: { approveListing: [], rejectListing: [], refundDecision: [], inventory: [] },
    grades: { dec_list: 'D3', dec_ref: 'D2', 'dec_ref_d3': 'D3' },
  };

  const commerce = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const json = (status: number, b: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (req.headers.authorization !== 'Bearer test-commerce-token') return json(401, { error: { code: 'UNAUTHORIZED' } });

      if (req.method === 'GET' && url.pathname === '/api/v1/products') return json(200, { products: [{ id: 'prd_1', title: '演示', skus: [{ skuCode: 'S1' }] }] });
      if (req.method === 'POST' && url.pathname === '/api/v1/products') return json(201, { product: { id: 'prd_new', ...body } });
      if (req.method === 'GET' && url.pathname === '/api/v1/channel-accounts') return json(200, { accounts: [{ id: 'acc_1', channel: 'sandbox-douyin' }] });

      if (req.method === 'POST' && url.pathname === '/api/v1/listings') {
        return json(423, { submission: { productId: body.productId, channelAccountId: body.channelAccountId, decisionId: 'dec_list', grade: 'D3', status: 'awaiting_approval' } });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/listings/dec_list/approve') {
        state.commerceCalls.approveListing.push(body);
        return json(200, { submission: { decisionId: 'dec_list', status: 'listed', externalProductId: 'dy-1' } });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/listings/dec_list/reject') {
        state.commerceCalls.rejectListing.push(body);
        return json(200, { result: { decisionId: 'dec_list', status: 'rejected' } });
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/orders') return json(200, { orders: [{ id: 'ord_1', status: 'paid', totalAmount: 1299 }] });
      if (req.method === 'POST' && url.pathname === '/api/v1/orders/import') {
        return json(201, { result: { imported: [{ id: 'ord_1' }], skipped: [] } });
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/refunds') {
        return json(423, { refund: { id: 'ref_1', orderId: body.orderId, decisionId: 'dec_ref', status: 'awaiting_approval' } });
      }
      const refundMatch = url.pathname.match(/^\/api\/v1\/refunds\/([^/]+)\/decision$/);
      if (req.method === 'POST' && refundMatch) {
        state.commerceCalls.refundDecision.push({ id: refundMatch[1], ...body });
        return json(200, { refund: { id: refundMatch[1], status: 'succeeded' } });
      }
      const refundGet = url.pathname.match(/^\/api\/v1\/refunds\/([^/]+)$/);
      if (req.method === 'GET' && refundGet) {
        const decisionId = refundGet[1] === 'ref_d3' ? 'dec_ref_d3' : 'dec_ref';
        return json(200, { refund: { id: refundGet[1], status: 'awaiting_approval', decisionId } });
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/inventory') return json(200, { inventory: [{ skuId: 'sku_1', qtyAvailable: 5 }] });
      if (req.method === 'POST' && url.pathname === '/api/v1/inventory') {
        state.commerceCalls.inventory.push(body);
        return json(201, { inventory: { skuId: body.skuId, qtyAvailable: body.qty } });
      }
      return json(404, { error: { code: 'ROUTE_MISSING', message: url.pathname } });
    });
  });

  const zeus = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, b: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    const m = url.pathname.match(/^\/api\/v1\/decisions\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const grade = state.grades[m[1]!];
      if (!grade) return json(404, { code: 'DECISION_NOT_FOUND', message: m[1]!, retryable: false });
      return json(200, { id: m[1], grade, status: 'blocked', ruleId: 'x', createdAt: '2026-01-01T00:00:00Z' });
    }
    return json(404, { code: 'ROUTE_MISSING' });
  });

  await Promise.all([
    new Promise<void>((r) => commerce.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => zeus.listen(0, '127.0.0.1', r)),
  ]);
  state.commerce = commerce;
  state.zeus = zeus;
  state.commerceBase = `http://127.0.0.1:${(commerce.address() as AddressInfo).port}`;
  state.zeusBase = `http://127.0.0.1:${(zeus.address() as AddressInfo).port}`;
  return state;
}

let fake: FakeState;
function ctx() {
  return createContext({
    zeus: new ZeusUpstream(fake.zeusBase, 'test-zeus-token'),
    commerce: new CommerceUpstream(fake.commerceBase, 'test-commerce-token'),
  });
}

afterAll(async () => {
  await new Promise<void>((res) => fake.commerce.close(() => res()));
  await new Promise<void>((res) => fake.zeus.close(() => res()));
});

describe('commerce controlled writes (fake upstream over real HTTP)', () => {
  it('lists products / orders / inventory verbatim', async () => {
    fake = await startFakes();
    expect((await listProducts(ctx())).products).toHaveLength(1);
    expect((await listOrders(ctx())).orders).toHaveLength(1);
    expect((await listInventory(ctx())).inventory).toHaveLength(1);
  });

  it('createProduct validates input before touching upstream; passes through on success', async () => {
    await expect(createProduct(ctx(), { title: '', skus: [] }, OPERATOR)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    const result = await createProduct(ctx(), { title: '演示', channelAccountId: 'acc_1', skus: [{ skuCode: 'S1', price: 10 }] }, OPERATOR);
    expect(result.product).toMatchObject({ id: 'prd_new', title: '演示' });
  });

  it('submitListing surfaces 423 as a normal pending hold (not swallowed)', async () => {
    const thrown = await submitListing(ctx(), { productId: 'prd_1', channelAccountId: 'acc_1' }, OPERATOR).catch((e) => e);
    expect(thrown).toBeInstanceOf(UpstreamError);
    expect(thrown.status).toBe(423);
    expect(thrown.body).toMatchObject({ submission: { decisionId: 'dec_list', grade: 'D3', status: 'awaiting_approval' } });
  });

  it('operator approving a D3 listing -> 403 and commerce endpoint never called', async () => {
    const before = fake.commerceCalls.approveListing.length;
    await expect(approveListing(ctx(), 'dec_list', {}, OPERATOR)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fake.commerceCalls.approveListing.length).toBe(before);
  });

  it('owner approves the listing through commerce with approver injected; result passed through', async () => {
    const result = await approveListing(ctx(), 'dec_list', { comment: 'ok' }, OWNER);
    expect(result.submission).toMatchObject({ status: 'listed', externalProductId: 'dy-1' });
    expect(fake.commerceCalls.approveListing.at(-1)).toMatchObject({ approver: 'owner', comment: 'ok' });

    const rejected = await rejectListing(ctx(), 'dec_list', {}, OWNER);
    expect(rejected.result).toMatchObject({ status: 'rejected' });
    expect(fake.commerceCalls.rejectListing.at(-1)).toMatchObject({ approver: 'owner' });
  });

  it('importOrders passes the channel pull through (idempotency belongs to commerce)', async () => {
    const result = await importOrders(ctx(), { channelAccountId: 'acc_1' }, OPERATOR);
    expect((result.result as { imported: unknown[] }).imported).toHaveLength(1);
    await expect(importOrders(ctx(), { channelAccountId: '' }, OWNER)).rejects.toMatchObject({ status: 400 });
  });

  it('requestRefund surfaces 423; operator may settle a D2 refund; approver injected', async () => {
    const held = await requestRefund(ctx(), { orderId: 'ord_1', lines: [{ orderItemId: 'li_1' }], reason: 'x' }, OPERATOR).catch((e) => e);
    expect(held).toBeInstanceOf(UpstreamError);
    expect(held.status).toBe(423);

    const settled = await decideRefund(ctx(), 'ref_1', { verdict: 'approve' }, OPERATOR);
    expect(settled.refund).toMatchObject({ status: 'succeeded' });
    expect(fake.commerceCalls.refundDecision.at(-1)).toMatchObject({ id: 'ref_1', verdict: 'approve', approver: 'operator' });
  });

  it('operator cannot settle a D3-grade refund (RBAC via zeus grade lookup)', async () => {
    const before = fake.commerceCalls.refundDecision.length;
    await expect(decideRefund(ctx(), 'ref_d3', { verdict: 'approve' }, OPERATOR)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fake.commerceCalls.refundDecision.length).toBe(before);
  });

  it('setInventory validates negative qty and passes adjustments through', async () => {
    await expect(setInventory(ctx(), { skuId: 'sku_1', qty: -3 }, OPERATOR)).rejects.toMatchObject({ status: 400 });
    const row = await setInventory(ctx(), { skuId: 'sku_1', qty: 8 }, OPERATOR);
    expect(row.inventory).toMatchObject({ skuId: 'sku_1', qtyAvailable: 8 });
  });

  it('unreachable commerce -> 503 UPSTREAM_UNAVAILABLE', async () => {
    const dead = createContext({
      zeus: new ZeusUpstream(fake.zeusBase, 't'),
      commerce: new CommerceUpstream('http://127.0.0.1:1', 't'),
    });
    await expect(listProducts(dead)).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
  });
});
