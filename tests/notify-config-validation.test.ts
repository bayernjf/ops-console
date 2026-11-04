import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * P2-4 regression: the owner-only webhookUrl runtime update accepted ANY
 * string, so a stolen owner session (or an operator bug) could silently point
 * the decision-intel outbound channel at a file:/ftp:/javascript: URL or an
 * unparsable string. updateNotifyConfig must now reject everything that is
 * not an absolute http(s) URL, and the PUT route must map that to 400.
 *
 * Wiring is exercised through the real scheduler singleton, started with
 * enabled=false so no poller timers are ever created.
 */

import {
  assertValidWebhookUrl,
  getNotifyConfig,
  startNotifyScheduler,
  updateNotifyConfig,
} from '../src/server/notify/index.js';
import { loadConfig } from '../src/server/config.js';
import { ZeusUpstream } from '../src/server/upstream/zeus.js';
import { CommerceUpstream } from '../src/server/upstream/commerce.js';
import type { ServerContext } from '../src/server/context.js';
import { PUT as putNotifyConfig } from '../src/pages/api/notify/config.js';
import type { SessionPayload } from '../src/server/session.js';

describe('assertValidWebhookUrl (pure)', () => {
  it('accepts absolute http(s) URLs with a public host', () => {
    expect(() => assertValidWebhookUrl('https://hooks.example.com/t/secret')).not.toThrow();
    expect(() => assertValidWebhookUrl('http://api.example.com/hook')).not.toThrow();
  });

  it('rejects loopback and private literals unless explicitly opted in', () => {
    expect(() => assertValidWebhookUrl('http://127.0.0.1:3023/hook')).toThrow(/non-public/);
    expect(() => assertValidWebhookUrl('http://10.0.0.5/hook')).toThrow(/non-public/);
    expect(() => assertValidWebhookUrl('http://localhost:3023/hook')).toThrow(/localhost/);
    expect(() =>
      assertValidWebhookUrl('http://127.0.0.1:3023/hook', { allowPrivateHosts: true }),
    ).not.toThrow();
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', ''])(
    'rejects %s',
    (bad) => {
      expect(() => assertValidWebhookUrl(bad)).toThrow(/webhookUrl/);
    },
  );
});

describe('updateNotifyConfig webhookUrl guard (wired through the scheduler)', () => {
  beforeAll(() => {
    const config = loadConfig();
    const tmp = mkdtempSync(join(tmpdir(), 'ops-notify-test-'));
    const ctx: ServerContext = {
      config: {
        ...config,
        notify: {
          ...config.notify,
          enabled: false, // rebuildPoller() then never starts a timer
          webhookUrl: 'https://hooks.example.com/original',
          storeFile: join(tmp, 'deliveries.jsonl'),
        },
      },
      zeus: new ZeusUpstream('http://127.0.0.1:1', 't'),
      commerce: new CommerceUpstream('http://127.0.0.1:1', 't'),
    };
    startNotifyScheduler(ctx);
  });

  it('rejects a non-http(s) webhookUrl and keeps the previous value', () => {
    expect(() => updateNotifyConfig({ webhookUrl: 'ftp://evil.example/exfil' })).toThrow(
      /http or https/,
    );
    expect(getNotifyConfig().webhookUrl).toBe('https://hooks.example.com');
  });

  it('rejects an unparsable webhookUrl', () => {
    expect(() => updateNotifyConfig({ webhookUrl: 'not a url' })).toThrow(/absolute URL/);
    expect(getNotifyConfig().webhookUrl).toBe('https://hooks.example.com');
  });

  it('accepts a valid https webhookUrl', () => {
    updateNotifyConfig({ webhookUrl: 'https://notify.example.com/hook' });
    expect(getNotifyConfig().webhookUrl).toBe('https://notify.example.com');
  });

  it('PUT /api/notify/config maps the rejection to 400, not 500', async () => {
    const session: SessionPayload = { username: 'owner', role: 'owner', exp: Date.now() + 60_000 };
    const res = await putNotifyConfig({
      request: new Request('http://127.0.0.1:3022/api/notify/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: 'file:///etc/passwd' }),
      }),
      locals: { session },
    } as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('http or https');
  });
});
