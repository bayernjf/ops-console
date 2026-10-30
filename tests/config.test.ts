import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/server/config.js';

/** Secrets that must never fall back to a hardcoded default. */
const REQUIRED_SECRETS = [
  'OPS_SESSION_SECRET',
  'OPS_OWNER_PASSWORD',
  'OPS_OPERATOR_PASSWORD',
  'ZEUS_INTERNAL_TOKEN',
  'COMMERCE_API_TOKEN',
] as const;

const SECRET_VALUES: Record<(typeof REQUIRED_SECRETS)[number], string> = {
  OPS_SESSION_SECRET: 'test-session-secret',
  OPS_OWNER_PASSWORD: 'test-owner-password',
  OPS_OPERATOR_PASSWORD: 'test-operator-password',
  ZEUS_INTERNAL_TOKEN: 'test-zeus-token',
  COMMERCE_API_TOKEN: 'test-commerce-token',
};

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const name of REQUIRED_SECRETS) {
  ORIGINAL_ENV[name] = process.env[name];
}

beforeEach(() => {
  for (const [name, value] of Object.entries(SECRET_VALUES)) {
    process.env[name] = value;
  }
  resetConfigCache();
});

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetConfigCache();
});

describe('config fail-closed on missing secrets', () => {
  it('loads when every required secret is present', () => {
    const cfg = loadConfig();
    expect(cfg.sessionSecret).toBe('test-session-secret');
    expect(cfg.accounts.owner.password).toBe('test-owner-password');
    expect(cfg.accounts.operator.password).toBe('test-operator-password');
    expect(cfg.zeus.token).toBe('test-zeus-token');
    expect(cfg.commerce.token).toBe('test-commerce-token');
  });

  it('keeps non-sensitive defaults for non-secret config', () => {
    const cfg = loadConfig();
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(3022);
    expect(cfg.accounts.owner.username).toBe('owner');
    expect(cfg.zeus.baseUrl).toBe('http://127.0.0.1:3020');
  });

  for (const name of REQUIRED_SECRETS) {
    it(`refuses to start when ${name} is missing`, () => {
      delete process.env[name];
      resetConfigCache();
      expect(() => loadConfig()).toThrow(new RegExp(`Missing required secret env ${name}`));
    });

    it(`refuses to start when ${name} is empty`, () => {
      process.env[name] = '';
      resetConfigCache();
      expect(() => loadConfig()).toThrow(new RegExp(`Missing required secret env ${name}`));
    });
  }
});
