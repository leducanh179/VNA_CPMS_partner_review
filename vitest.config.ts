import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cpms/domain': fromRoot('./packages/domain/src/index.ts'),
      '@cpms/integrations': fromRoot('./packages/integrations/src/index.ts'),
      '@cpms/ai-contracts': fromRoot('./packages/ai-contracts/src/index.ts'),
      '@cpms/ui': fromRoot('./packages/ui/src/index.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/**/*.spec.ts', 'packages/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
