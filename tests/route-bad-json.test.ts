import { describe, expect, it, vi } from 'vitest';

/**
 * P2-6 regression: the commerce write routes used to call `request.json()`
 * bare, so a malformed JSON body threw SyntaxError into the toErrorResponse
 * fallback and came out as 500 INTERNAL_ERROR — a client bug masquerading as
 * a server failure (retry amplification, polluted error alerts). Every write
 * route must answer 400 VALIDATION_FAILED instead.
 *
 * The real route handlers are driven with a real Request whose body is
 * invalid JSON. context.js is stubbed with a throwing getContext to prove the
 * 400 fires before any upstream/service work can happen (reaching it would
 * surface as a 500 and fail the test). No function mocks otherwise.
 */

vi.mock('../src/server/context.js', () => ({
  getContext: () => {
    throw new Error('getContext reached before body validation');
  },
  createContext: (overrides: unknown) => overrides,
}));

import { POST as importOrders } from '../src/pages/api/orders/import.js';
import { POST as requestRefund } from '../src/pages/api/refunds/index.js';
import { POST as setInventory } from '../src/pages/api/inventory/index.js';
import { POST as createProduct } from '../src/pages/api/products/index.js';
import { POST as submitListing } from '../src/pages/api/listings/index.js';
import { POST as decideRefund } from '../src/pages/api/refunds/[id]/decision.js';

type Route = (ctx: unknown) => Promise<Response>;

const SESSION = { username: 'operator', role: 'operator', exp: Date.now() + 60_000 };

function badJsonCtx(path: string, params: Record<string, string> = {}): unknown {
  return {
    request: new Request(`http://127.0.0.1:3022${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }),
    params,
    locals: { session: SESSION },
  };
}

const WRITE_ROUTES: Array<{ name: string; path: string; route: Route }> = [
  { name: 'POST /api/orders/import', path: '/api/orders/import', route: importOrders as Route },
  { name: 'POST /api/refunds', path: '/api/refunds', route: requestRefund as Route },
  { name: 'POST /api/inventory', path: '/api/inventory', route: setInventory as Route },
  { name: 'POST /api/products', path: '/api/products', route: createProduct as Route },
  { name: 'POST /api/listings', path: '/api/listings', route: submitListing as Route },
  // Covered by the P1 verdict guard (null body -> verdict badRequest); pinned
  // here so the whole P2-6 surface is guarded in one place.
  { name: 'POST /api/refunds/:id/decision', path: '/api/refunds/ref_1/decision', route: decideRefund as Route },
];

describe('write routes reject a malformed JSON body with 400 (P2-6)', () => {
  for (const { name, path, route } of WRITE_ROUTES) {
    it(`${name} -> 400 VALIDATION_FAILED, never 500`, async () => {
      const res = await route(badJsonCtx(path, { id: 'ref_1' }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });
  }

  it('a valid JSON body does NOT hit the body guard (guard is not vacuous)', async () => {
    // The request fails later (context stub throws -> 500), which proves the
    // 400 path above is triggered by the malformed body, not unconditionally.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = {
      request: new Request('http://127.0.0.1:3022/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuId: 'sku_1', qty: 3 }),
      }),
      params: {},
      locals: { session: SESSION },
    };
    const res = await setInventory(ctx as never);
    expect(res.status).not.toBe(400);
  });
});
