import { describe, expect, it, vi } from 'vitest';

/**
 * Regression for the P2 SSRF gap: the webhook URL guard only looked at the
 * scheme, so any host — loopback, RFC1918, link-local metadata endpoints or a
 * DNS name that resolves to one of those — was accepted, and delivery followed
 * redirects. These tests pin the unified guard that both the config write path
 * and the delivery path now use.
 */

import {
  assertWebhookUrlSafe,
  assertWebhookUrlSyntax,
  classifyAddress,
} from '../src/server/net/url-guard.js';
import { deliverWebhook } from '../src/server/notify/webhook.js';
import type { WebhookPayload } from '../src/server/notify/types.js';

const PASSWORD = 'hook-secret-value';
const payload: WebhookPayload = {
  event: 'pending',
  decisionId: 'd-1',
  grade: 'B',
  domain: 'payments',
  intent: 'refund',
  status: 'pending',
  deepLink: '/decisions/d-1',
  message: 'needs review',
};

describe('classifyAddress', () => {
  it.each([
    ['10.1.2.3', '10/8'],
    ['172.16.0.9', '172.16/12'],
    ['172.31.255.254', '172.16/12'],
    ['192.168.0.10', '192.168/16'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this-host'],
    ['255.255.255.255', 'reserved'],
    ['224.0.0.1', 'multicast'],
  ])('blocks IPv4 %s (%s)', (ip, reason) => {
    expect(classifyAddress(ip)).toContain(reason);
  });

  it.each(['::1', '::', 'fd00::1', 'fc00::abcd', 'fe80::1%en0', 'ff00::1'])(
    'blocks IPv6 %s',
    (ip) => {
      expect(classifyAddress(ip)).toBeTruthy();
    },
  );

  it('blocks IPv4-mapped and NAT64 wrappers around private IPv4', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBeTruthy();
    expect(classifyAddress('::ffff:10.0.0.5')).toBeTruthy();
    expect(classifyAddress('64:ff9b::7f00:1')).toBeTruthy(); // 127.0.0.1
    expect(classifyAddress('64:ff9b::a00:2')).toBeTruthy(); // 10.0.0.2
  });

  it('allows public unicast addresses', () => {
    expect(classifyAddress('8.8.8.8')).toBeNull();
    expect(classifyAddress('1.1.1.1')).toBeNull();
    expect(classifyAddress('2606:4700::1111')).toBeNull();
    expect(classifyAddress('::ffff:8.8.8.8')).toBeNull();
  });
});

describe('assertWebhookUrlSyntax', () => {
  it('rejects literal private hosts, including non-canonical IPv4 notations', () => {
    for (const url of [
      'http://10.0.0.5/hook',
      'http://127.0.0.1/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.10/hook',
      'http://[::1]/hook',
      'http://[fe80::1]/hook',
      // WHATWG URL normalizes these to a dotted-quad IPv4 hostname.
      'http://2130706433/hook',
      'http://0x7f.0.0.1/hook',
      'http://0177.0.0.1/hook',
      'http://127.1/hook',
      'http://localhost/hook',
    ]) {
      expect(() => assertWebhookUrlSyntax(url)).toThrow(/webhookUrl/);
    }
  });

  it('keeps rejecting non-http(s) and unparsable values', () => {
    for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
      expect(() => assertWebhookUrlSyntax(url)).toThrow(/webhookUrl/);
    }
  });

  it('accepts public http and https URLs', () => {
    expect(() => assertWebhookUrlSyntax('https://hooks.example.com/t/secret')).not.toThrow();
    expect(() => assertWebhookUrlSyntax('http://api.example.com/hook')).not.toThrow();
  });
});

describe('assertWebhookUrlSafe (resolved)', () => {
  it('rejects a hostname that resolves to a private address (rebinding guard)', async () => {
    await expect(
      assertWebhookUrlSafe('https://internal.example/hook', {
        lookup: async () => [{ address: '10.0.0.7' }, { address: '93.184.216.34' }],
      }),
    ).rejects.toThrow(/non-public/);
  });

  it('rejects when resolution returns only private IPv6', async () => {
    await expect(
      assertWebhookUrlSafe('https://internal.example/hook', {
        lookup: async () => [{ address: 'fd00::1' }],
      }),
    ).rejects.toThrow(/non-public/);
  });

  it('allows a hostname that resolves to public addresses', async () => {
    await expect(
      assertWebhookUrlSafe('https://hooks.example.com/hook', {
        lookup: async () => [{ address: '93.184.216.34' }],
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('honours the explicit private-host opt-in used by local receivers', async () => {
    await expect(assertWebhookUrlSafe('http://127.0.0.1:3023/hook', { allowPrivateHosts: true })).resolves.toBeInstanceOf(URL);
  });
});

describe('deliverWebhook SSRF guards', () => {
  it('refuses to POST to a private literal host before any network call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const outcome = await deliverWebhook(`http://127.0.0.1/hook/${PASSWORD}`, payload, {
      backoffMs: [],
      fetchImpl,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/non-public/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a DNS name that resolves to a private address', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const outcome = await deliverWebhook('https://resolves-private.example/hook', payload, {
      backoffMs: [],
      fetchImpl,
      lookup: async () => [{ address: '192.168.0.20' }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/non-public/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never follows redirects and surfaces the rejection', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      // Real fetch rejects with this shape when redirect: 'error'.
      throw new TypeError(`unexpected redirect (redirect=${String(init?.redirect)})`);
    });
    const outcome = await deliverWebhook('https://hooks.example.com/hook', payload, {
      backoffMs: [],
      fetchImpl,
      lookup: async () => [{ address: '93.184.216.34' }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/unexpected redirect/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('still delivers to an allowed receiver and reports success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const outcome = await deliverWebhook('http://127.0.0.1:3023/hook', payload, {
      backoffMs: [],
      fetchImpl,
      allowPrivateHosts: true,
    });
    expect(outcome).toMatchObject({ ok: true, attempts: 1, httpStatus: 200 });
  });
});
