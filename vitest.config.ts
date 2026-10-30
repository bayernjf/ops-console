import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Astro's tsconfig preset sets "jsx": "preserve" (Astro compiles island
  // JSX itself); Vitest's esbuild must use the automatic runtime instead,
  // otherwise JSX in test files resolves to a classic React global.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup-env.ts'],
    testTimeout: 30000,
    pool: 'threads',
  },
});
