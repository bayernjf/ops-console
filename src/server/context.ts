import { loadConfig, type Config } from './config.js';
import { CommerceUpstream } from './upstream/commerce.js';
import { ModelHubUpstream } from './upstream/model-hub.js';
import { ZeusUpstream } from './upstream/zeus.js';

export interface ServerContext {
  config: Config;
  zeus: ZeusUpstream;
  commerce: CommerceUpstream;
  modelHub: ModelHubUpstream;
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
    modelHub: new ModelHubUpstream(
      config.modelHub.baseUrl,
      config.modelHub.username,
      config.modelHub.password,
    ),
  };
  return instance;
}

/** Test-only factory. */
export function createContext(overrides: {
  zeus: ZeusUpstream;
  commerce: CommerceUpstream;
  modelHub?: ModelHubUpstream;
  config?: Config;
}): ServerContext {
  const config = overrides.config ?? loadConfig();
  return {
    config,
    zeus: overrides.zeus,
    commerce: overrides.commerce,
    modelHub:
      overrides.modelHub ??
      new ModelHubUpstream(
        config.modelHub.baseUrl,
        config.modelHub.username,
        config.modelHub.password,
      ),
  };
}
