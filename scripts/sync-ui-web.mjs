import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const assets = [
  'bunnyland-api.js',
  'bunnyland-play.js',
  'bunnyland-ui.css',
  'bunnyland-ui.js',
];

mkdirSync(join(root, 'assets'), { recursive: true });
for (const asset of assets) {
  const source = fileURLToPath(import.meta.resolve(`@bunnyland/ui-web/assets/${asset}`));
  const target = join(root, 'assets', asset);
  if (check) {
    if (!existsSync(target) || readFileSync(source, 'utf8') !== readFileSync(target, 'utf8')) {
      throw new Error(`assets/${asset} is not synced with @bunnyland/ui-web`);
    }
  } else {
    copyFileSync(source, target);
  }
}
