/**
 * Test-process env seed. config.ts now refuses to start without secret env
 * (fail-closed); tests that build a real server context via loadConfig need
 * placeholders. `??=` so config.test.ts can still exercise missing/empty.
 */
process.env.OPS_SESSION_SECRET ??= 'vitest-session-secret';
process.env.OPS_OWNER_PASSWORD ??= 'vitest-owner-password';
process.env.OPS_OPERATOR_PASSWORD ??= 'vitest-operator-password';
process.env.ZEUS_INTERNAL_TOKEN ??= 'vitest-zeus-token';
process.env.COMMERCE_API_TOKEN ??= 'vitest-commerce-token';
