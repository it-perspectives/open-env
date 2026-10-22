import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { schema } from '../src/index.js';
import { validateSpecificationRelease, schemaUrlForVersion } from '../scripts/release-contract.js';
const valid = { metadata: { version: '0.1.0' }, env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'specification-v0.1.0' } };
test('specification release accepts exact new tag and historical schema URL', () => assert.equal(validateSpecificationRelease(valid), '0.1.0'));
for (const tag of ['v0.1.0', 'extension-v0.1.0', 'specification-v0.2.0', 'specification-v01.1.0', 'specification-v0.1.0-beta', 'specification-v0.1.0-extra']) test(`reject wrong specification tag ${tag}`, () => assert.throws(() => validateSpecificationRelease({ ...valid, env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag } }), /tag/));
test('new specification versions require prefixed immutable schema URLs', () => {
  const next = structuredClone(schema); next.properties.openenv.const = '0.1.1'; next.$id = schemaUrlForVersion('0.1.1'); next.properties.$schema.const = next.$id;
  assert.equal(validateSpecificationRelease({ metadata: { version: '0.1.1' }, formatVersion: '0.1.1', documentSchema: next, env: {} }), '0.1.1');
  next.$id = next.$id.replace('specification-v', 'v');
  assert.throws(() => validateSpecificationRelease({ metadata: { version: '0.1.1' }, formatVersion: '0.1.1', documentSchema: next, env: {} }), /URLs/);
});
test('CI and disjoint release callers pin the same complete tooling contract', () => {
  const read = name => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
  const ci = read('ci');
  const spec = read('release');
  const extension = read('release-extension');
  const pin = '0ac78fd5a1bc8c567d453e36e8e13224df62d74d';
  assert.deepEqual(spec.on.push.tags, ['specification-v*', 'website-v*']);
  assert.deepEqual(extension.on.push.tags, ['extension-v*']);
  assert.equal(ci.permissions.contents, 'read');
  for (const [workflow, job, called] of [[ci, 'verify', 'verify'], [spec, 'release', 'release'], [extension, 'release', 'release']]) {
    assert.deepEqual(Object.keys(workflow.jobs), [job]);
    assert.equal(workflow.jobs[job].uses, `it-perspectives/open-tooling/.github/workflows/${called}.yml@${pin}`);
    assert.deepEqual(workflow.jobs[job].with, { 'tooling-ref': pin, 'require-complete': true });
  }
  for (const workflow of [spec, extension]) {
    assert.equal(workflow.permissions.contents, 'write');
    assert.equal(workflow.permissions['id-token'], 'write');
    assert.equal(workflow.permissions.packages, 'write');
  }
  const manifest = JSON.parse(readFileSync('.open-project.json', 'utf8'));
  assert.equal(manifest.products.website.verify, 'tooling:verify-site');
  assert.deepEqual(manifest.publishing, { npm: false, marketplace: true, openVSX: true });
});
