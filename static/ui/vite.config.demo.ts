import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { walkthrough } from '../../src/proof/walkthrough';
import type { Seed } from '../../src/proof/world';

const root = fileURLToPath(new URL('.', import.meta.url));
const seed = JSON.parse(readFileSync(new URL('../../test/fixtures/seed-team.json', import.meta.url), 'utf8')) as Seed;
const { sample, invoke } = walkthrough(seed);

export default defineConfig({
  root,
  plugins: [react(), {
    name: 'standby-walkthrough',
    transformIndexHtml: () => [{
      tag: 'aside',
      attrs: { 'aria-label': 'Local walkthrough', style: 'padding: 0.65rem 1rem; background: #fff2cc; color: #29231a;' },
      children: `Local walkthrough with sample data. Choose ${sample.person.name} and use ${sample.window.from} to ${sample.window.to}. Jira and Confluence actions are simulated.`,
      injectTo: 'body-prepend',
    }],
    configureServer(server) {
      server.middlewares.use('/__standby_demo', async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Use POST to run a walkthrough action.' }));
          return;
        }
        try {
          let body = '';
          for await (const chunk of request) body += chunk;
          const { name, payload } = JSON.parse(body) as { name: string; payload: unknown };
          response.end(JSON.stringify(await invoke(name, payload)));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  }],
  resolve: { alias: { '@forge/bridge': fileURLToPath(new URL('./demo/bridge.ts', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
