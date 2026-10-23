import { loadConfig, type Config } from './config.js';
import { CommerceUpstream } from './upstream/commerce.js';
import { ZeusUpstream } from './upstream/zeus.js';

export interface ServerContext {
  config: Config;
  zeus: ZeusUpstream;
  commerce: CommerceUpstream;
}

let instance: ServerContext | null = null;

/** Singleton upstream clients; process-local, tokens stay server-side. */
export function getContext(): ServerContext {
  if (instance) return instance;
  const config = loadConfig();
  instance = {
    config,
    zeus: new ZeusUpstream(config.zeus.baseUrl, config.zeus.token),
    commerce: new CommerceUpstream(config.commerce.baseUrl, config.commerce.token),
  };
  return instance;
}

/** Test-only factory. */
export function createContext(overrides: { zeus: ZeusUpstream; commerce: CommerceUpstream; config?: Config }): ServerContext {
  const config = overrides.config ?? loadConfig();
  return { config, zeus: overrides.zeus, commerce: overrides.commerce };
}
