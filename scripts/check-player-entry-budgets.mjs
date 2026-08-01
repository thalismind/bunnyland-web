#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const distUrl = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', distUrl), 'utf8'));
const compatibilityAssets = new Set([
  'assets/bunnyland-api.js',
  'assets/bunnyland-play.js',
  'assets/bunnyland-responsive.css',
  'assets/bunnyland-themes.css',
  'assets/bunnyland-ui.css',
  'assets/bunnyland-ui.js',
]);
const routes = [
  { html: 'web-tui.html' },
  { html: 'toon-client.html' },
];
const limit = 75 * 1024;

function collectInitial(record, files = new Set()) {
  if (!record) throw new Error('manifest import is missing');
  if (record.file) files.add(record.file);
  for (const css of record.css || []) files.add(css);
  for (const key of record.imports || []) collectInitial(manifest[key], files);
  return files;
}

for (const route of routes) {
  const expected = collectInitial(manifest[route.html], new Set(compatibilityAssets));
  const html = await readFile(new URL(route.html, distUrl), 'utf8');
  const referenced = [...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="\/?([^"?#]+)[^">]*"[^>]*>/g)]
    .map(match => match[1])
    .filter(path => /\.(?:css|js)$/.test(path));
  const unexpected = referenced.filter(path => !expected.has(path));
  if (unexpected.length) {
    throw new Error(`${route.html} references unexpected initial assets: ${unexpected.join(', ')}`);
  }
  const sizes = await Promise.all([...expected].map(async path => {
    const source = await readFile(new URL(path, distUrl));
    return [path, gzipSync(source).length];
  }));
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  if (total > limit) throw new Error(`${route.html} initial JS/CSS is ${total} B gzip; budget is ${limit} B`);
  console.log(`${route.html}: ${total} B gzip across ${sizes.length} initial JS/CSS assets`);
}
