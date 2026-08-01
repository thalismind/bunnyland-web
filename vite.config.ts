import { cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const pages = Object.fromEntries(
  readdirSync(root)
    .filter((name) => name.endsWith('.html'))
    .map((name) => [name.slice(0, -5), resolve(root, name)]),
);

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'bunnyland-static-assets',
      closeBundle() {
        for (const path of ['assets', 'docs', 'examples']) {
          cpSync(resolve(root, path), resolve(root, 'dist', path), { recursive: true });
        }
        for (const path of ['config.json', 'favicon.png', 'robots.txt', 'LICENSE', 'README.md']) {
          cpSync(resolve(root, path), resolve(root, 'dist', path));
        }
      },
    },
  ],
  build: {
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: { input: pages },
    // Do not publish original sources to the CDN in production builds.
    sourcemap: false,
  },
});
