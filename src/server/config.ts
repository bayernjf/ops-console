/**
 * Process configuration, resolved from environment only. No secrets are ever
 * exposed to the browser: this module is server-only.
 */

export type Role = 'owner' | 'operator';
export type AuthMode = 'local' | 'cf' | 'oidc';

function required(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Secrets must never fall back to a hardcoded default: if the variable is
 * missing the process fails to start with a clear, actionable error.
 */
function requiredSecret(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required secret env ${name}: refusing to start with an insecure default. ` +
        `Set it via the environment (see .env.example).`,
    );
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export interface RoleAccount {
  username: string;
  password: string;
  role: Role;
}

export interface Config {
  host: string;
  port: number;
  sessionSecret: string;
  authMode: AuthMode;
  accounts: Record<Role, RoleAccount>;
  zeus: { baseUrl: string; token: string };
  commerce: { baseUrl: string; token: string };
  publicBaseUrl: string;
  notify: {
    enabled: boolean;
    webhookUrl: string;
    pollMs: number;
    listRefreshMs: number;
    escalationMinutes: number;
    storeFile: string;
  };
  inbound: {
    /** Shared HMAC secret for zeus -> console decision webhook. Empty disables. */
    decisionWebhookSecret: string;
    /** Durable log of accepted inbound decision events. */
    decisionWebhookLogFile: string;
  };
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const authMode = required('OPS_AUTH_MODE', 'local') as AuthMode;
  if (!['local', 'cf', 'oidc'].includes(authMode)) {
    throw new Error(`OPS_AUTH_MODE must be local|cf|oidc, got ${authMode}`);
  }
  const cfg: Config = {
    host: required('OPS_HOST', '127.0.0.1'),
    port: intEnv('OPS_PORT', 3022),
    sessionSecret: requiredSecret('OPS_SESSION_SECRET'),
    authMode,
    accounts: {
      owner: {
        username: required('OPS_OWNER_USERNAME', 'owner'),
        password: requiredSecret('OPS_OWNER_PASSWORD'),
        role: 'owner',
      },
      operator: {
        username: required('OPS_OPERATOR_USERNAME', 'operator'),
        password: requiredSecret('OPS_OPERATOR_PASSWORD'),
        role: 'operator',
      },
    },
    zeus: {
      baseUrl: required('ZEUS_BASE_URL', 'http://127.0.0.1:3020'),
      token: requiredSecret('ZEUS_INTERNAL_TOKEN'),
    },
    commerce: {
      baseUrl: required('COMMERCE_BASE_URL', 'http://127.0.0.1:3021'),
      token: requiredSecret('COMMERCE_API_TOKEN'),
    },
    publicBaseUrl: required('OPS_PUBLIC_BASE_URL', 'http://127.0.0.1:3022'),
    notify: {
      enabled: boolEnv('OPS_NOTIFY_ENABLED', true),
      webhookUrl: required('OPS_NOTIFY_WEBHOOK_URL', 'http://127.0.0.1:3023/hook'),
      pollMs: intEnv('OPS_NOTIFY_POLL_MS', 5000),
      listRefreshMs: intEnv('OPS_NOTIFY_LIST_REFRESH_MS', 20000),
      escalationMinutes: intEnv('OPS_NOTIFY_ESCALATION_MINUTES', 15),
      storeFile: required('OPS_NOTIFY_STORE_FILE', './data/notify-deliveries.jsonl'),
    },
    inbound: {
      decisionWebhookSecret: required('OPS_DECISION_WEBHOOK_SECRET', ''),
      decisionWebhookLogFile: required('OPS_DECISION_WEBHOOK_LOG', './data/inbound-decision-events.jsonl'),
    },
  };
  cached = cfg;
  return cfg;
}

/** Test-only hook. */
export function resetConfigCache(): void {
  cached = null;
}
