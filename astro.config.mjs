import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// Single-process SSR console (Tier0 M8). Pages and API endpoints run in one
// Node process; zeus/commerce bearer tokens live only server-side.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { host: '127.0.0.1', port: 3022 },
  trailingSlash: 'ignore',
  vite: {
    define: {
      // Ensure no server-only module is accidentally imported by islands.
    },
  },
});
