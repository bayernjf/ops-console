import { callJson } from './http.js';
import type { DashboardMetrics } from './types.js';

/** A generic commerce row; exact columns are owned by commerce-os. */
export type CommerceRow = Record<string, unknown>;

/**
 * Thin typed client over commerce-os HTTP API v1. Request bodies are passed
 * through verbatim; the console does not recompute or validate business data.
 */
export class CommerceUpstream {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return callJson<T>(this.baseUrl, this.token, path, query ? { query } : {});
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return callJson<T>(this.baseUrl, this.token, path, { method: 'POST', body });
  }

  // ---- Dashboard / events (read-only) -----------------------------------
  async dashboard(): Promise<DashboardMetrics> {
    const body = await this.get<{ metrics: DashboardMetrics }>('/api/v1/dashboard');
    return body.metrics;
  }

  async events(filter: { eventType?: string; refType?: string; refId?: string } = {}): Promise<{ events: CommerceRow[] }> {
    return this.get<{ events: CommerceRow[] }>('/api/v1/events', {
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
      ...(filter.refType ? { refType: filter.refType } : {}),
      ...(filter.refId ? { refId: filter.refId } : {}),
    });
  }

  // ---- Catalog -----------------------------------------------------------
  listProducts(): Promise<{ products: CommerceRow[] }> {
    return this.get('/api/v1/products');
  }
  getProduct(id: string): Promise<{ product: CommerceRow }> {
    return this.get(`/api/v1/products/${encodeURIComponent(id)}`);
  }
  createProduct(body: unknown): Promise<{ product: CommerceRow }> {
    return this.post('/api/v1/products', body);
  }
  listCategories(): Promise<{ categories: CommerceRow[] }> {
    return this.get('/api/v1/categories');
  }
  createCategory(body: unknown): Promise<{ category: CommerceRow }> {
    return this.post('/api/v1/categories', body);
  }

  // ---- Orders ------------------------------------------------------------
  listOrders(): Promise<{ orders: CommerceRow[] }> {
    return this.get('/api/v1/orders');
  }
  getOrder(id: string): Promise<{ order: CommerceRow }> {
    return this.get(`/api/v1/orders/${encodeURIComponent(id)}`);
  }
  importOrders(body: { channelAccountId: string; since?: string }): Promise<{ result: unknown }> {
    return this.post('/api/v1/orders/import', body);
  }

  // ---- Inventory ---------------------------------------------------------
  listInventory(): Promise<{ inventory: CommerceRow[] }> {
    return this.get('/api/v1/inventory');
  }
  setInventory(body: { skuId: string; qty: number }): Promise<{ inventory: CommerceRow }> {
    return this.post('/api/v1/inventory', body);
  }

  // ---- Refunds -----------------------------------------------------------
  listRefunds(): Promise<{ refunds: CommerceRow[] }> {
    return this.get('/api/v1/refunds');
  }
  getRefund(id: string): Promise<{ refund: CommerceRow }> {
    return this.get(`/api/v1/refunds/${encodeURIComponent(id)}`);
  }
  requestRefund(body: {
    orderId: string;
    lines: Array<{ orderItemId?: string | undefined; qty?: number | undefined; amount?: number | undefined }>;
    reason: string;
  }): Promise<{ refund: CommerceRow }> {
    return this.post('/api/v1/refunds', body);
  }
  decideRefund(id: string, body: { verdict: 'approve' | 'reject'; approver: string; comment?: string }): Promise<{ refund: CommerceRow }> {
    return this.post(`/api/v1/refunds/${encodeURIComponent(id)}/decision`, body);
  }

  // ---- Listings / content ------------------------------------------------
  submitListing(body: {
    productId: string;
    channelAccountId: string;
    contentType: string;
    sellingPoints?: unknown;
    constraints?: unknown;
  }): Promise<{ submission: CommerceRow }> {
    return this.post('/api/v1/listings', body);
  }
  approveListing(decisionId: string, body: { approver: string; comment?: string }): Promise<{ submission: CommerceRow }> {
    return this.post(`/api/v1/listings/${encodeURIComponent(decisionId)}/approve`, body);
  }
  rejectListing(decisionId: string, body: { approver: string; comment?: string }): Promise<{ result: unknown }> {
    return this.post(`/api/v1/listings/${encodeURIComponent(decisionId)}/reject`, body);
  }

  // ---- Content (published projection only) --------------------------------
  listContent(): Promise<{ content: CommerceRow[] }> {
    return this.get('/api/v1/content');
  }
  getContent(id: string): Promise<{ content: CommerceRow }> {
    return this.get(`/api/v1/content/${encodeURIComponent(id)}`);
  }

  // ---- Channel accounts --------------------------------------------------
  listChannelAccounts(): Promise<{ accounts: CommerceRow[] }> {
    return this.get('/api/v1/channel-accounts');
  }
  createChannelAccount(body: unknown): Promise<{ account: CommerceRow }> {
    return this.post('/api/v1/channel-accounts', body);
  }
}
