import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from './release-notes.js';
import { extensionTag, versionPattern } from './release-contract.js';

export function extensionReleaseMetadata({ cwd = process.cwd(), env = process.env } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'extensions/vscode/package.json'), 'utf8'));
  if (manifest.name !== 'openenv' || manifest.publisher !== 'it-perspectives' || !versionPattern.test(manifest.version)) throw new Error('Unexpected extension identity or version.');
  const tag = extensionTag(manifest.version);
  if (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_REF_NAME !== tag) throw new Error('Extension tag must match the extension manifest version.');
  const notes = extractReleaseNotes(readFileSync(resolve(cwd, 'extensions/vscode/CHANGELOG.md'), 'utf8'), manifest.version);
  return { tag, version: manifest.version, id: `${manifest.publisher}.${manifest.name}`, filename: `openenv-${manifest.version}.vsix`, notes };
}
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status}). ${result.stderr?.trim() || result.error?.message || ''}`);
  return result.stdout.trim();
}
export async function jsonRequest(url, init = {}, request = fetch) {
  const response = await request(url, { ...init, signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Registry/API request failed (${response.status}).`);
  return response.json();
}
export async function storeHasVersion(store, metadata, request = fetch) {
  if (store === 'openvsx') {
    const item = await jsonRequest(`https://open-vsx.org/api/it-perspectives/openenv/${metadata.version}`, {}, request);
    return Boolean(item && item.namespace === 'it-perspectives' && item.name === 'openenv' && item.version === metadata.version);
  }
  const result = await jsonRequest('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: metadata.id }] }], flags: 1 }),
  }, request);
  return Boolean(result?.results?.[0]?.extensions?.some(item => item.publisher?.publisherName === 'it-perspectives' && item.extensionName === 'openenv' && item.versions?.some(v => v.version === metadata.version)));
}
export async function publishStore(store, metadata, { packagePath, execute = run, hasVersion = storeHasVersion, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!['marketplace', 'openvsx'].includes(store)) throw new Error('Unknown store.');
  if (!await hasVersion(store, metadata)) {
    const options = { env: { ...process.env, VSCE_PAT: undefined, OVSX_PAT: undefined } };
    if (store === 'marketplace') execute('node', ['node_modules/@vscode/vsce/vsce', 'publish', '--packagePath', packagePath, '--oidc'], options);
    else execute('node', ['node_modules/ovsx/bin/ovsx', 'publish', packagePath, '--trusted-publishing'], options);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await hasVersion(store, metadata)) return;
    await pause(10000);
  }
  throw new Error(`${store} has not confirmed ${metadata.id}@${metadata.version}. Retry the failed job after registry processing.`);
}

export function createReleaseService({ metadata, commit, cwd = process.cwd(), api, execute = run, hasVersion = storeHasVersion }) {
  const directory = resolve(cwd, 'dist/vscode-release');
  const vsix = resolve(directory, metadata.filename);
  const descriptor = resolve(directory, 'extension-release.json');
  const checksum = resolve(directory, 'SHA256SUMS');
  const notes = resolve(directory, 'release-notes.md');
  const local = () => JSON.parse(readFileSync(descriptor, 'utf8'));
  const verify = () => {
    const info = local();
    if (info.commit !== commit || info.tag !== metadata.tag || info.version !== metadata.version || info.id !== metadata.id || info.filename !== metadata.filename || info.sha256 !== sha256(readFileSync(vsix))) throw new Error('Saved VSIX identity, commit or checksum differs from this release.');
    if (readFileSync(notes, 'utf8') !== metadata.notes) throw new Error('Saved release notes differ from this commit.');
    if (readFileSync(checksum, 'utf8') !== `${info.sha256}  ${metadata.filename}\n`) throw new Error('Saved checksum file differs from the VSIX.');
    // Verify the embedded manifest as well as its external descriptor.
    const manifest = JSON.parse(execute('unzip', ['-p', vsix, 'extension/package.json']));
    if (`${manifest.publisher}.${manifest.name}` !== metadata.id || manifest.version !== metadata.version) throw new Error('VSIX manifest does not match the release.');
    return info;
  };
  async function getRelease() {
    return api(`/releases/tags/${metadata.tag}`);
  }
  async function download(release) {
    if (release.target_commitish !== commit) throw new Error('Existing GitHub release targets another commit.');
    mkdirSync(directory, { recursive: true });
    execute('gh', ['release', 'download', metadata.tag, '--dir', directory, '--clobber', '--pattern', metadata.filename, '--pattern', 'extension-release.json', '--pattern', 'SHA256SUMS', '--pattern', 'release-notes.md']);
    return verify();
  }
  return {
    async stage() {
      const existing = await getRelease();
      if (existing) { await download(existing); return; }
      mkdirSync(directory, { recursive: true });
      const buffer = readFileSync(resolve(cwd, 'dist', metadata.filename));
      const info = { tag: metadata.tag, version: metadata.version, id: metadata.id, filename: metadata.filename, commit, sha256: sha256(buffer) };
      writeFileSync(vsix, buffer); writeFileSync(descriptor, JSON.stringify(info, null, 2) + '\n');
      writeFileSync(checksum, `${info.sha256}  ${metadata.filename}\n`); writeFileSync(notes, metadata.notes);
      verify();
      execute('gh', ['release', 'create', metadata.tag, vsix, descriptor, checksum, notes, '--verify-tag', '--draft', '--target', commit, '--title', `Open ENV ${metadata.version}`, '--notes-file', notes]);
    },
    async publish(store) {
      const release = await getRelease();
      if (!release) throw new Error('Missing staged GitHub release.');
      const info = await download(release);
      await publishStore(store, metadata, { packagePath: vsix, execute, hasVersion });
      const receiptPath = resolve(directory, `${store}-published.json`);
      writeFileSync(receiptPath, JSON.stringify({ ...info, store }, null, 2) + '\n');
      execute('gh', ['release', 'upload', metadata.tag, receiptPath, '--clobber']);
    },
    async finalize() {
      const release = await getRelease();
      if (!release) throw new Error('Missing staged GitHub release.');
      const info = await download(release);
      for (const store of ['marketplace', 'openvsx']) {
        if (!release.assets.some(asset => asset.name === `${store}-published.json`)) throw new Error(`Missing ${store} publication receipt.`);
        execute('gh', ['release', 'download', metadata.tag, '--dir', directory, '--clobber', '--pattern', `${store}-published.json`]);
        const receipt = JSON.parse(readFileSync(resolve(directory, `${store}-published.json`), 'utf8'));
        if (receipt.store !== store || Object.entries(info).some(([key, value]) => receipt[key] !== value)) throw new Error(`${store} receipt does not match the staged VSIX.`);
        if (!await hasVersion(store, metadata)) throw new Error(`${store} version is not visible.`);
      }
      execute('gh', ['release', 'edit', metadata.tag, '--draft=false']);
      console.log(`Marketplace: https://marketplace.visualstudio.com/items?itemName=${metadata.id}`);
      console.log(`Open VSX: https://open-vsx.org/extension/it-perspectives/openenv`);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const metadata = extensionReleaseMetadata();
    const command = process.argv[2];
    if (command === 'check') console.log(metadata.version);
    else {
      if (!process.env.GITHUB_REPOSITORY || !process.env.GH_TOKEN) throw new Error('GitHub repository and workflow token are required.');
      const commit = run('git', ['rev-parse', 'HEAD']);
      const api = path => jsonRequest(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
      const service = createReleaseService({ metadata, commit, api });
      if (command === 'stage') await service.stage();
      else if (command === 'publish') await service.publish(process.argv[3]);
      else if (command === 'finalize') await service.finalize();
      else throw new Error('Usage: vscode-release.js check|stage|publish marketplace|publish openvsx|finalize');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
