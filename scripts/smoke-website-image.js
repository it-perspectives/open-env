import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const [argument, ...extra] = process.argv.slice(2);
const image = argument || process.env.OPEN_TOOLING_IMAGE;
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (!image || extra.length || image.startsWith('-')) {
  throw new Error('Usage: node scripts/smoke-website-image.js IMAGE');
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Docker command failed.');
  return result.stdout.trim();
}

let container;
try {
  container = docker(['run', '--detach', '--publish', '127.0.0.1::8080', image]);
  const binding = docker(['port', container, '8080/tcp']);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  const deadline = Date.now() + 30_000;

  while (true) {
    try {
      const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (health.ok) break;
    } catch { /* Nginx may still be starting. */ }
    if (Date.now() >= deadline) throw new Error(`Website container failed to start:\n${docker(['logs', container])}`);
    await setTimeout(250);
  }

  for (const path of ['/', '/contract/', '/types/', '/quickstart/', '/vscode/']) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /OpenENV/, path);
  }
  const schema = await fetch(`${origin}/openenv-${version}.schema.json`);
  assert.equal(schema.status, 200);
  assert.equal((await schema.json()).properties.openenv.const, version);
  assert.equal((await fetch(`${origin}/openenv.yaml`)).status, 200);
  assert.equal((await fetch(`${origin}/missing-page/`)).status, 404);
  assert.equal(docker(['inspect', '--format', '{{.Config.User}}', container]), '101:101');
  console.log('Website container: five static routes, schema, example, 404 and non-root runtime passed.');
} finally {
  if (container) docker(['rm', '--force', container]);
}
