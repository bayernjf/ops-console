export type NotifyEvent = 'pending' | 'timeout' | 'escalation' | 'channel_failure';
export type DeliveryStatus = 'delivered' | 'pending' | 'failed';

/** One notification delivery attempt record (deduplicated by decisionId+event). */
export interface DeliveryRecord {
  decisionId: string;
  event: NotifyEvent;
  grade: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  httpStatus?: number;
  deepLink: string;
  error?: string;
}

export interface WebhookPayload {
  event: NotifyEvent;
  decisionId: string;
  grade: string;
  domain: string;
  intent: string;
  amount?: { value: number; currency: string };
  ruleId?: string;
  status: string;
  createdAt?: string;
  timeoutAt?: string;
  deepLink: string;
  message: string;
}

export interface NotifyConfigView {
  enabled: boolean;
  webhookUrl: string;
  pollMs: number;
  escalationMinutes: number;
}

/** Internal: runtime (mutable, in-process) notify config seeded from env. */
export interface NotifyRuntimeConfig {
  enabled: boolean;
  webhookUrl: string;
  pollMs: number;
  escalationMinutes: number;
  storeFile: string;
  publicBaseUrl: string;
}

/** Outcome of one webhook delivery attempt sequence. */
export interface DeliveryOutcome {
  ok: boolean;
  attempts: number;
  httpStatus?: number;
  error?: string;
}
