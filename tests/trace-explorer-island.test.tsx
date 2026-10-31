// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TraceExplorer from '../src/islands/TraceExplorer';
import type { TraceQueryResult, TraceTree } from '../src/server/upstream/types';

/**
 * Tier0 M2 W2-5 island coverage: filters render with reachable labels, results
 * render the zeus pass-through fields (traceId / agent / latency / micros /
 * error count), the span tree expands, the empty and error states are
 * announced (role="status" / role="alert"), and filter submission refetches
 * with the verbatim query string. No SSE/WS: the island only polls.
 */

interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

function fakeJson(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const TREE: TraceTree = {
  traceId: 'run-1',
  root: {
    traceId: 'run-1',
    spanId: 'run-1',
    kind: 'intent',
    startedAt: '2026-10-31T00:00:00.000Z',
    events: [],
  },
  spans: [
    {
      traceId: 'run-1',
      spanId: 'br-1',
      parentSpanId: 'run-1',
      kind: 'branch',
      vassal: 'atlas',
      startedAt: '2026-10-31T00:00:00.100Z',
      endedAt: '2026-10-31T00:00:02.000Z',
      events: [],
    },
    {
      traceId: 'run-1',
      spanId: 'm-1',
      parentSpanId: 'br-1',
      kind: 'model',
      startedAt: '2026-10-31T00:00:00.200Z',
      endedAt: '2026-10-31T00:00:01.400Z',
      events: [],
      call: {
        backend: 'hub',
        model: 'gemini-3-pro',
        tokensIn: 100,
        tokensOut: 50,
        costMicros: 12345,
        latencyMs: 1200,
      },
    },
    {
      traceId: 'run-1',
      spanId: 'm-2',
      parentSpanId: 'br-1',
      kind: 'model',
      startedAt: '2026-10-31T00:00:01.500Z',
      endedAt: '2026-10-31T00:00:01.800Z',
      events: [],
      call: {
        backend: 'hub',
        model: 'gemini-3-flash',
        tokensIn: 10,
        tokensOut: 5,
        costMicros: 1000,
        latencyMs: 300,
        error: 'model call failed: 500',
      },
    },
  ],
};

const RESULT: TraceQueryResult = {
  traces: [TREE],
  summary: { totalLatencyMs: 1500, totalCostMicros: 13345, errorCount: 1, count: 1 },
};

describe('TraceExplorer island', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<FakeResponse>>();
    fetchMock.mockResolvedValue(fakeJson(200, RESULT));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the filter form with labelled controls and the aggregate meta', async () => {
    render(<TraceExplorer initial={RESULT} refreshMs={20000} />);
    expect(screen.getByLabelText('Agent')).toBeTruthy();
    expect(screen.getByLabelText('起始时间')).toBeTruthy();
    expect(screen.getByLabelText('截止时间')).toBeTruthy();
    expect(screen.getByLabelText('最小成本（micros）')).toBeTruthy();
    expect(screen.getByLabelText('最大成本（micros）')).toBeTruthy();
    expect(screen.getByLabelText('Trace ID')).toBeTruthy();
    expect(screen.getByLabelText('条数上限')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/命中 1 条/)).toBeTruthy());
    expect(screen.getByText(/总成本 13,345 micros/)).toBeTruthy();
    expect(screen.getByText(/错误 1 次/)).toBeTruthy();
  });

  it('renders result rows from the zeus pass-through payload', async () => {
    render(<TraceExplorer initial={RESULT} refreshMs={20000} />);
    await waitFor(() => expect(screen.getByText('run-1')).toBeTruthy());
    expect(screen.getByText('atlas')).toBeTruthy();
    // Per-tree summary mirrors zeus summarizeTree: 1200+300=1500ms, 12345+1000 micros.
    expect(screen.getByText('13,345')).toBeTruthy();
    expect(screen.getByText('1s')).toBeTruthy();
  });

  it('expands the span tree with kind tags and model call details', async () => {
    render(<TraceExplorer initial={RESULT} refreshMs={20000} />);
    const toggle = screen.getByRole('button', { name: '展开' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('hub / gemini-3-pro')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('hub / gemini-3-pro')).toBeTruthy();
    expect(screen.getByText('hub / gemini-3-flash')).toBeTruthy();
    // 'atlas' shows both in the agent column and as the branch span name.
    expect(screen.getAllByText('atlas').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('model call failed: 500')).toBeTruthy();
    const kinds = screen.getAllByText('model');
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/tokens 100\/50/)).toBeTruthy();
    expect(screen.getByText(/12,345 micros/)).toBeTruthy();
  });

  it('refetches with the verbatim query string when filters are applied', async () => {
    render(<TraceExplorer initial={RESULT} refreshMs={20000} />);
    // Wait out the mount refetch so the submit button reads 查询 again.
    await screen.findByRole('button', { name: '查询' });
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'atlas' } });
    fireEvent.change(screen.getByLabelText('条数上限'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain('/api/traces?agent=atlas&limit=25');
    });
  });

  it('shows the empty state when zeus returns no traces', () => {
    // Mount refetch must see the same empty shape so the state is stable.
    fetchMock.mockResolvedValue(
      fakeJson(200, { traces: [], summary: { totalLatencyMs: 0, totalCostMicros: 0, errorCount: 0, count: 0 } }),
    );
    render(
      <TraceExplorer
        initial={{ traces: [], summary: { totalLatencyMs: 0, totalCostMicros: 0, errorCount: 0, count: 0 } }}
        refreshMs={20000}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('当前过滤条件下没有 trace');
  });

  it('announces failures via role=alert and keeps prior results (fail-closed UI)', async () => {
    render(<TraceExplorer initial={RESULT} refreshMs={20000} />);
    await waitFor(() => expect(screen.getByText('run-1')).toBeTruthy());
    fetchMock.mockResolvedValue(fakeJson(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'upstream unreachable' } }));
    fireEvent.click(screen.getByRole('button', { name: '手动刷新' }));
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toContain('503 UPSTREAM_UNAVAILABLE');
    // Prior results stay on screen; the console never fabricates a clean slate.
    expect(screen.getByText('run-1')).toBeTruthy();
  });
});
