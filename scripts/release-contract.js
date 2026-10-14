import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { specificationVersion, schema } from '../src/index.js';

export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const specificationTag = version => `specification-v${version}`;
export const extensionTag = version => `extension-v${version}`;
export function schemaUrlForVersion(version) {
  const tag = version === '0.1.0' ? 'v0.1.0' : specificationTag(version);
  return `https://raw.githubusercontent.com/it-perspectives/OpenENV/${tag}/schemas/openenv-${version}.schema.json`;
}
export function validateSpecificationRelease({ metadata = JSON.parse(readFileSync('package.json', 'utf8')), formatVersion = specificationVersion, documentSchema = schema, env = process.env } = {}) {
  if (!versionPattern.test(formatVersion) || metadata.version !== formatVersion || documentSchema.properties.openenv.const !== formatVersion || documentSchema.$id !== schemaUrlForVersion(formatVersion) || documentSchema.properties.$schema.const !== documentSchema.$id) throw new Error('Release versions or schema URLs disagree.');
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== specificationTag(formatVersion)) throw new Error('Release tag must match the specification and package version.');
  return formatVersion;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = validateSpecificationRelease();
    if (process.env.GITHUB_REF_TYPE === 'tag' && execFileSync('git', ['ls-remote', '--refs', 'origin', `refs/tags/v${version}`], { encoding: 'utf8' }).trim()) throw new Error(`Historical tag v${version} already exists. Release a new specification version.`);
    console.log(version);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
