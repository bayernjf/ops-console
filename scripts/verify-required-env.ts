/**
 * Startup gate: resolve the process config so missing secrets fail the boot
 * with a clear error instead of silently starting on insecure defaults.
 * Wired as npm `predev` / `prestart`; the throw message names the variable.
 */
import { loadConfig } from '../src/server/config.ts';

try {
  loadConfig();
} catch (err) {
  console.error(`[ops-console] refusing to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
console.error('[ops-console] required env OK');
