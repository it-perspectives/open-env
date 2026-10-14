import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionReleaseMetadata, publishStore, storeHasVersion, jsonRequest, createReleaseService } from '../scripts/vscode-release.js';
const metadata = extensionReleaseMetadata({ env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'extension-v0.2.0' } });
for (const tag of ['v0.2.0','specification-v0.2.0','extension-v0.3.0','extension-v0.2.0-beta']) test(`extension rejects tag ${tag}`, () => assert.throws(() => extensionReleaseMetadata({ env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag } }), /tag/));
for (const store of ['marketplace','openvsx']) {
  test(`${store}: publish identical VSIX with mandatory OIDC`, async () => {
    const calls = []; let exists = false;
    await publishStore(store, metadata, { packagePath: '/saved/release.vsix', execute(command, args, options) { calls.push([command, args]); assert.equal(options.env.VSCE_PAT, undefined); assert.equal(options.env.OVSX_PAT, undefined); exists = true; }, hasVersion: async () => exists });
    assert.equal(calls.length, 1); assert.ok(calls[0][1].includes('/saved/release.vsix'));
    assert.ok(calls[0][1].includes(store === 'marketplace' ? '--oidc' : '--trusted-publishing'));
    assert.ok(!calls[0][1].includes('--pat'));
    await publishStore(store, metadata, { packagePath: '/saved/release.vsix', execute() { assert.fail('already published'); }, hasVersion: async () => true });
  });
  test(`${store}: authentication failure propagates without fallback`, async () => {
    let calls = 0;
    await assert.rejects(publishStore(store, metadata, { packagePath: 'release.vsix', hasVersion: async () => false, execute() { calls++; throw new Error('OIDC rejected'); } }), /OIDC rejected/);
    assert.equal(calls, 1);
  });
}
test('partial publication retries only missing store and handles registry delay', async () => {
  const calls = []; const exists = new Set(['marketplace']); let probes = 0;
  const options = { packagePath: 'saved.vsix', execute(_, args) { calls.push(args); }, hasVersion: async store => exists.has(store) || ++probes > 2, pause: async () => {} };
  await publishStore('marketplace', metadata, options); await publishStore('openvsx', metadata, options);
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('--trusted-publishing'));
});
test('registry timeout remains retryable failure', async () => {
  await assert.rejects(publishStore('openvsx', metadata, { hasVersion: async () => false, execute() {}, pause: async () => {} }), /has not confirmed/);
});
test('metadata checks match publisher/name and exact version', async () => {
  const request = data => async () => ({ ok: true, status: 200, json: async () => data });
  assert.equal(await storeHasVersion('openvsx', metadata, request({ namespace: 'it-perspectives', name: 'openenv', version: '0.2.0' })), true);
  assert.equal(await storeHasVersion('openvsx', metadata, request({ namespace: 'other', name: 'openenv', version: '0.2.0' })), false);
  const item = { publisher: { publisherName: 'it-perspectives' }, extensionName: 'openenv', versions: [{version:'0.2.0'}] };
  assert.equal(await storeHasVersion('marketplace', metadata, request({results:[{extensions:[item]}]})), true);
  item.versions[0].version = '0.1.0';
  assert.equal(await storeHasVersion('marketplace', metadata, request({results:[{extensions:[item]}]})), false);
  await assert.rejects(jsonRequest('test', {}, async () => ({status:403,ok:false})), /403/);
});
function serviceFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'openenv-release-')); t.after(() => rmSync(cwd, {recursive:true,force:true}));
  mkdirSync(join(cwd,'dist')); writeFileSync(join(cwd,'dist',metadata.filename), 'immutable package');
  let release; const assets = new Map(); const calls = []; const stores = new Set();
  const execute = (command,args) => {
    calls.push([command,args]);
    if (command === 'unzip') return JSON.stringify({publisher:'it-perspectives',name:'openenv',version:'0.2.0'});
    if (command === 'node') { stores.add(args[0].includes('ovsx') ? 'openvsx' : 'marketplace'); return ''; }
    if (args[1] === 'create') { release = {target_commitish:'commit', draft:true, assets:[]}; for(const file of args.slice(3,7)) assets.set(file.split('/').at(-1),readFileSync(file)); }
    if (args[1] === 'download') { for (const [name,buffer] of assets) writeFileSync(join(cwd,'dist/vscode-release',name),buffer); }
    if (args[1] === 'upload') { const file=args[3]; const name=file.split('/').at(-1); assets.set(name,readFileSync(file)); release.assets.push({name}); }
    if (args[1] === 'edit') release.draft=false;
    return '';
  };
  return { cwd, assets, calls, stores, getRelease:()=>release, service:createReleaseService({metadata,commit:'commit',cwd,execute,api:async()=>release,hasVersion:async store=>stores.has(store)}) };
}
test('stage stores immutable assets, retry reuses saved VSIX, finalize waits for both stores', async t => {
  const f=serviceFixture(t); await f.service.stage();
  const original=f.assets.get(metadata.filename).toString();
  writeFileSync(join(f.cwd,'dist',metadata.filename),'rebuilt different zip');
  await f.service.stage(); assert.equal(f.assets.get(metadata.filename).toString(),original);
  await f.service.publish('marketplace'); await assert.rejects(f.service.finalize(),/Missing openvsx/);
  assert.equal(f.getRelease().draft,true);
  await f.service.publish('openvsx'); await f.service.finalize(); assert.equal(f.getRelease().draft,false);
  assert.equal(f.calls.filter(([cmd,args])=>cmd==='node'&&args.includes('publish')).length,2);
});
test('saved assets cannot be replaced by another commit or modified VSIX', async t => {
  const f=serviceFixture(t); await f.service.stage(); f.assets.set(metadata.filename,Buffer.from('tampered'));
  await assert.rejects(f.service.stage(),/checksum/);
  f.getRelease().target_commitish='other'; await assert.rejects(f.service.stage(),/another commit/);
});

test('finalization rejects receipts for a different package', async t => {
  const f=serviceFixture(t); await f.service.stage();
  await f.service.publish('marketplace'); await f.service.publish('openvsx');
  const receipt=JSON.parse(f.assets.get('openvsx-published.json').toString()); receipt.sha256='wrong';
  f.assets.set('openvsx-published.json',Buffer.from(JSON.stringify(receipt)));
  await assert.rejects(f.service.finalize(),/receipt does not match/);
  assert.equal(f.getRelease().draft,true);
});
