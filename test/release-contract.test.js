import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('pipelines have disjoint tag triggers and validation before builds', () => {
  const spec = readFileSync('.github/workflows/release.yml', 'utf8');
  const extension = readFileSync('.github/workflows/release-extension.yml', 'utf8');
  assert.match(spec, /tags: \['specification-v\*'\]/); assert.match(spec, /needs: validate-tag/);
  assert.match(extension, /tags: \['extension-v\*'\]/); assert.match(extension, /id-token: write/);
  assert.doesNotMatch(spec + extension, /tags: \['v\*'\]/);
});
