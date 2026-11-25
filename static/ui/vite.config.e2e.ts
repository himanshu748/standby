import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Same app, but @forge/bridge is replaced by the fixture mock for filming outside Atlassian.
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@forge/bridge': fileURLToPath(new URL('./e2e/bridge-mock.ts', import.meta.url)),
    },
  },
  server: { port: 4174, strictPort: true },
});
