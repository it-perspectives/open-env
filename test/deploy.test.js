import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { deployRelease, deployExtensionRelease } from '../scripts/deploy.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'openenv-deploy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'work');
  const remote = join(directory, 'origin.git');
  mkdirSync(cwd);
  const git = (args, location = cwd) => {
    const result = spawnSync('git', args, {
      cwd: location, encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
    });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git(['init', '--bare', '--initial-branch=main', remote]);
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Release Test']);
  git(['config', 'user.email', 'release@example.invalid']);
  writeFileSync(join(cwd, 'package.json'), '{"name":"release-fixture","version":"0.1.0"}\n');
  writeFileSync(join(cwd, 'README.md'), 'Initial commit.\n');
  git(['add', '.']);
  git(['commit', '-m', 'Initial commit']);
  git(['remote', 'add', 'origin', remote]);
  git(['push', 'origin', 'main']);
  const checks = [];
  // Exercise real Git against a temporary local remote. Packaging checks are
  // covered separately; running npm test here would recursively run this suite.
  const run = (command, args) => {
    if (command === 'git') return git(args);
    checks.push([command, args]);
    return '';
  };
  return { cwd, remote, git, run, checks };
}

function assertNoTag(git) {
  assert.equal(git(['tag', '--list', 'specification-v0.1.0']), '');
  assert.equal(git(['ls-remote', '--refs', 'origin', 'refs/tags/specification-v0.1.0']), '');
}

for (const args of [[], ['0.1.0', 'extra'], ['specification-v0.1.0'], ['01.1.0'], ['0.1'], ['--help']]) {
  test(`deploy rejects invalid arguments ${JSON.stringify(args)} before Git operations`, () => {
    assert.throws(() => deployRelease(args, { run: () => assert.fail('Git must not run') }), /Usage: npm run deploy X\.Y\.Z/);
  });
}

test('deploy checks the release and atomically pushes main and an annotated tag', (t) => {
  const { cwd, remote, git, run, checks } = fixture(t);
  writeFileSync(join(cwd, 'README.md'), 'Release commit.\n');
  git(['commit', '-am', 'Prepare release']);
  const commit = git(['rev-parse', 'HEAD']);
  deployRelease(['0.1.0'], { cwd, run });
  assert.deepEqual(checks, [
    ['npm', ['run', 'release:prepare']],
    [process.execPath, ['scripts/smoke-package.js']]
  ]);
  assert.equal(git(['cat-file', '-t', 'refs/tags/specification-v0.1.0']), 'tag');
  assert.equal(git(['for-each-ref', '--format=%(contents)', 'refs/tags/specification-v0.1.0']), 'OpenENV specification v0.1.0');
  assert.equal(git(['rev-parse', 'refs/heads/main'], remote), commit);
  assert.equal(git(['rev-parse', 'refs/tags/specification-v0.1.0^{}'], remote), commit);
});

test('deploy rejects a version mismatch without creating a tag', (t) => {
  const { cwd, git, run, checks } = fixture(t);
  assert.throws(() => deployRelease(['0.2.0'], { cwd, run }), /does not match package\.json/);
  assert.equal(checks.length, 0);
  assertNoTag(git);
});

test('deploy rejects a branch other than main', (t) => {
  const { cwd, git, run } = fixture(t);
  git(['checkout', '-b', 'feature']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /main branch/);
  assertNoTag(git);
});

test('deploy rejects a detached HEAD', (t) => {
  const { cwd, git, run } = fixture(t);
  git(['checkout', '--detach']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /main branch/);
  assertNoTag(git);
});

for (const filename of ['README.md', 'untracked.txt']) {
  test(`deploy rejects dirty file ${filename}`, (t) => {
    const { cwd, git, run } = fixture(t);
    writeFileSync(join(cwd, filename), 'Uncommitted change.\n');
    assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /Working tree must be clean/);
    assertNoTag(git);
  });
}

test('deploy refuses to overwrite a local tag', (t) => {
  const { cwd, git, run } = fixture(t);
  git(['tag', 'specification-v0.1.0']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /Local tag specification-v0\.1\.0 already exists/);
  assert.equal(git(['cat-file', '-t', 'refs/tags/specification-v0.1.0']), 'commit');
  assert.equal(git(['ls-remote', '--refs', 'origin', 'refs/tags/specification-v0.1.0']), '');
});

test('deploy refuses to overwrite a remote tag', (t) => {
  const { cwd, git, run } = fixture(t);
  git(['tag', 'specification-v0.1.0']);
  git(['push', 'origin', 'refs/tags/specification-v0.1.0']);
  git(['tag', '-d', 'specification-v0.1.0']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /Remote tag specification-v0\.1\.0 already exists/);
  assert.equal(git(['tag', '--list', 'specification-v0.1.0']), '');
});

test('deploy creates no tag when origin is unavailable', (t) => {
  const { cwd, git, run, checks } = fixture(t);
  git(['remote', 'remove', 'origin']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /origin/);
  assert.equal(checks.length, 0);
  assert.equal(git(['tag', '--list', 'specification-v0.1.0']), '');
});

for (const failure of ['npm', process.execPath]) {
  test(`deploy creates no tag if release check ${failure} fails`, (t) => {
    const { cwd, git, run } = fixture(t);
    assert.throws(() => deployRelease(['0.1.0'], {
      cwd, run: (command, args, options) => {
        if (command === failure) throw new Error('Release check failed.');
        return run(command, args, options);
      }
    }), /Release check failed/);
    assertNoTag(git);
  });
}

test('deploy catches uncommitted changes made during release checks', (t) => {
  const { cwd, git, run } = fixture(t);
  assert.throws(() => deployRelease(['0.1.0'], {
    cwd, run: (command, args, options) => {
      if (command === 'npm') writeFileSync(join(cwd, 'README.md'), 'Changed during checks.\n');
      return run(command, args, options);
    }
  }), /Working tree must be clean/);
  assertNoTag(git);
});

test('deploy catches a new commit made during release checks', (t) => {
  const { cwd, git, run } = fixture(t);
  assert.throws(() => deployRelease(['0.1.0'], {
    cwd, run: (command, args, options) => {
      if (command === 'npm') {
        writeFileSync(join(cwd, 'README.md'), 'Changed during checks.\n');
        git(['commit', '-am', 'New commit during checks']);
      }
      return run(command, args, options);
    }
  }), /HEAD changed/);
  assertNoTag(git);
});

test('a rejected main push leaves the remote tag absent and retains the local tag', (t) => {
  const { cwd, remote, git, run } = fixture(t);
  git(['checkout', '-b', 'competing']);
  writeFileSync(join(cwd, 'README.md'), 'New remote commit.\n');
  git(['commit', '-am', 'Advance remote main']);
  const remoteCommit = git(['rev-parse', 'HEAD']);
  git(['push', 'origin', 'HEAD:refs/heads/main']);
  git(['checkout', 'main']);
  assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /Local tag specification-v0\.1\.0 is retained/);
  assert.equal(git(['cat-file', '-t', 'refs/tags/specification-v0.1.0']), 'tag');
  assert.equal(git(['ls-remote', '--refs', 'origin', 'refs/tags/specification-v0.1.0']), '');
  assert.equal(git(['rev-parse', 'refs/heads/main'], remote), remoteCommit);
});

for (const remoteTag of [false, true]) {
  test(`deploy blocks historical tag (remote=${remoteTag})`, t => {
    const { cwd, git, run, checks } = fixture(t);
    git(['tag', 'v0.1.0']);
    if (remoteTag) { git(['push', 'origin', 'refs/tags/v0.1.0']); git(['tag', '-d', 'v0.1.0']); }
    assert.throws(() => deployRelease(['0.1.0'], { cwd, run }), /Historical tag/);
    assert.equal(checks.length, 0);
    assertNoTag(git);
  });
}
for (const scenario of ['success', 'local-tag', 'remote-tag', 'failed-check', 'atomic-rejection', 'version', 'dirty', 'branch', 'changed-head']) {
  test(`extension deployment: ${scenario}`, t => {
    const { cwd, remote, git, run, checks } = fixture(t);
    mkdirSync(join(cwd, 'extensions/vscode'), { recursive: true });
    writeFileSync(join(cwd, 'extensions/vscode/package.json'), '{"version":"0.2.0"}');
    writeFileSync(join(cwd, 'extensions/vscode/CHANGELOG.md'), '## 0.2.0 — Editor support\n\nValidate contracts.\n');
    git(['add', '.']); git(['commit', '-m', 'Extension release']);
    if (scenario === 'local-tag' || scenario === 'remote-tag') {
      git(['tag', 'extension-v0.2.0']);
      if (scenario === 'remote-tag') { git(['push', 'origin', 'refs/tags/extension-v0.2.0']); git(['tag', '-d', 'extension-v0.2.0']); }
    }
    if (scenario === 'dirty') writeFileSync(join(cwd, 'README.md'), 'dirty');
    if (scenario === 'branch') git(['checkout', '-b', 'feature']);
    const wrapped = (command, args, options) => {
      if (command !== 'git' && scenario === 'failed-check') throw new Error('test failure');
      if (command !== 'git' && scenario === 'atomic-rejection' && checks.length === 0) {
        writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      }
      if (command !== 'git' && scenario === 'changed-head' && checks.length === 0) { writeFileSync(join(cwd, 'README.md'), 'changed'); git(['commit', '-am', 'Changed head']); }
      return run(command, args, options);
    };
    if (scenario === 'success') {
      assert.equal(deployExtensionRelease(['0.2.0'], { cwd, run: wrapped }), 'extension-v0.2.0');
      assert.equal(git(['cat-file', '-t', 'refs/tags/extension-v0.2.0']), 'tag');
      assert.equal(git(['rev-parse', 'refs/tags/extension-v0.2.0^{}'], remote), git(['rev-parse', 'HEAD']));
      assert.deepEqual(checks.map(([, args]) => args[1]), ['verify', 'previews:verify', 'vscode:package', 'vscode:test']);
    } else {
      assert.throws(() => deployExtensionRelease([scenario === 'version' ? '0.3.0' : '0.2.0'], { cwd, run: wrapped }));
      if (scenario === 'atomic-rejection') {
        assert.equal(git(['cat-file', '-t', 'refs/tags/extension-v0.2.0']), 'tag');
        assert.equal(git(['ls-remote', '--refs', 'origin', 'refs/tags/extension-v0.2.0']), '');
      }
    }
  });
}
