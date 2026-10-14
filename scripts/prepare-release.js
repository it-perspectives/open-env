import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { specificationVersion } from '../src/index.js';
import { validateSpecificationRelease } from './release-contract.js';
import { extractReleaseNotes } from './release-notes.js';

const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
validateSpecificationRelease({ metadata });
const releaseNotes = extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), specificationVersion);
mkdirSync('dist', { recursive: true });
const run = (command, args) => {
  const output = spawnSync(command, args, { encoding: 'utf8' });
  if (output.status !== 0) throw new Error(`${command} failed: ${output.stderr}`);
  return output.stdout;
};
const files = ['README.md', 'SPEC.md', 'CHANGELOG.md', 'LICENSE', 'package.json', 'package-lock.json', 'schemas', 'examples', 'docs', 'src', 'bin', 'scripts', 'test'];
const archive = `openenv-${specificationVersion}.tar.gz`;
run('tar', ['-czf', join('dist', archive), ...files]);
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', 'dist']));
// npm <=11 returns an array; npm 12 returns metadata keyed by package name.
const packageInfo = Array.isArray(packed) ? packed[0] : packed[metadata.name];
if (!packageInfo || packageInfo.version !== specificationVersion || typeof packageInfo.filename !== 'string') throw new Error('Unexpected npm pack metadata.');
const npmPackage = packageInfo.filename;
copyFileSync('SPEC.md', 'dist/SPEC.md');
copyFileSync('CHANGELOG.md', 'dist/CHANGELOG.md');
writeFileSync('dist/release-notes.md', releaseNotes);
const schemaFile = `openenv-${specificationVersion}.schema.json`;
copyFileSync(join('schemas', schemaFile), join('dist', schemaFile));
const artifacts = [archive, npmPackage, 'SPEC.md', schemaFile, 'CHANGELOG.md', 'release-notes.md'];
for (const filename of readdirSync('examples')) {
  copyFileSync(join('examples', filename), join('dist', filename));
  artifacts.push(filename);
}
writeFileSync('dist/SHA256SUMS', artifacts.sort().map((filename) => `${createHash('sha256').update(readFileSync(join('dist', filename))).digest('hex')}  ${filename}\n`).join(''));
process.stdout.write(`Prepared OpenENV ${specificationVersion} release assets in dist/.\n`);
