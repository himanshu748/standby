import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Forge serves the bundle from a sub-path, so assets must be relative.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
