/**
 * commerce read-only list wiring tests (refunds / content).
 *
 * Real node:http fake commerce + real fetch. The console is a pure pass-through
 * — these tests pin the exact wrapper shapes commerce now serves:
 *   GET /api/v1/refunds  -> { refunds:[...] }
 *   GET /api/v1/content  -> { content:[...] }   (published projection only)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';

const refunds = [
  {
    id: 'ref_1',
    orderId: 'ord_1',
    lines: [{ orderItemId: 'li_1', qty: 1, amount: 1299 }],
    reason: '质量问题',
    status: 'awaiting_approval',
    decisionId: 'dec_ref_1',
    createdAt: '2026-10-26T10:00:00.000Z',
  },
  {
    id: 'ref_2',
    orderId: 'ord_2',
    lines: [{ orderItemId: 'li_2', qty: 2, amount: 500 }],
    reason: '七天无理由',
    status: 'succeeded',
    decisionId: 'dec_ref_2',
    externalRefundRef: 'ch_ref_99',
    createdAt: '2026-10-25T09:00:00.000Z',
    decidedAt: '2026-10-25T09:05:00.000Z',
  },
];

const content = [
  {
    id: 'ext_content_1',
    productId: 'prd_1',
    channel: 'douyin',
    externalProductId: 'ext_sku_1',
    decisionId: 'dec_list_1',
    listedAt: '2026-10-26T08:00:00.000Z',
  },
];

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ctok') {
      res.writeHead(401); res.end(); return;
    }
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname === '/api/v1/refunds') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refunds }));
      return;
    }
    if (url.pathname === '/api/v1/refunds/ref_1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refund: refunds[0] }));
      return;
    }
    if (url.pathname === '/api/v1/content') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
      return;
    }
    if (url.pathname === '/api/v1/content/ext_content_1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: content[0] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => server.close());

describe('commerce list wiring', () => {
  it('listRefunds returns {refunds} with exact per-field shape', async () => {
    const c = new CommerceUpstream(base, 'ctok');
    const body = await c.listRefunds();
    expect(body.refunds).toHaveLength(2);
    expect(body.refunds[0]).toMatchObject({
      id: 'ref_1',
      orderId: 'ord_1',
      reason: '质量问题',
      status: 'awaiting_approval',
      decisionId: 'dec_ref_1',
    });
    const lines = (body.refunds[0]!.lines as Array<{ orderItemId: string; qty: number; amount: number }>);
    expect(lines[0]).toMatchObject({ orderItemId: 'li_1', qty: 1, amount: 1299 });
    expect(body.refunds[1]!.status).toBe('succeeded');
    expect(body.refunds[1]!.externalRefundRef).toBe('ch_ref_99');
    expect(body.refunds[1]!.decidedAt).toBe('2026-10-25T09:05:00.000Z');
  });

  it('getRefund passes through the {refund} envelope', async () => {
    const c = new CommerceUpstream(base, 'ctok');
    const body = await c.getRefund('ref_1');
    expect(body.refund.id).toBe('ref_1');
    expect(body.refund.status).toBe('awaiting_approval');
  });

  it('listContent returns published projection {content} (no pending rows fabricated)', async () => {
    const c = new CommerceUpstream(base, 'ctok');
    const body = await c.listContent();
    expect(body.content).toHaveLength(1);
    expect(body.content[0]).toMatchObject({
      id: 'ext_content_1',
      productId: 'prd_1',
      channel: 'douyin',
      externalProductId: 'ext_sku_1',
      decisionId: 'dec_list_1',
      listedAt: '2026-10-26T08:00:00.000Z',
    });
  });

  it('getContent passes through the {content} envelope', async () => {
    const c = new CommerceUpstream(base, 'ctok');
    const body = await c.getContent('ext_content_1');
    expect(body.content.id).toBe('ext_content_1');
  });
});
