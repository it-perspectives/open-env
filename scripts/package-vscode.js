import { createVSIX } from '@vscode/vsce';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const extension = new URL('extensions/vscode/', root);
const manifest = JSON.parse(readFileSync(new URL('package.json', extension), 'utf8'));
const output = new URL('dist/', root);
mkdirSync(output, { recursive: true });

await createVSIX({
  cwd: fileURLToPath(extension),
  packagePath: fileURLToPath(new URL(`openenv-${manifest.version}.vsix`, output)),
  dependencies: false,
});
