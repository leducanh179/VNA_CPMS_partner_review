import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  return {
    envDir: '../../',
    plugins: [react()],
    resolve: {
      alias: {
        '@cpms/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
        '@cpms/ui': fileURLToPath(new URL('../../packages/ui/src/index.tsx', import.meta.url)),
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_TARGET ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
