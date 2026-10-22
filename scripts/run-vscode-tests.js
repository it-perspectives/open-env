import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

// Parent tools may run inside Electron-as-Node; a GUI Extension Host must not inherit this.
delete process.env.ELECTRON_RUN_AS_NODE;
const temporary = mkdtempSync(join(tmpdir(), 'openenv-host-'));
try {
  let executable = process.env.OPENENV_VSCODE_EXECUTABLE || await downloadAndUnzipVSCode({ version: process.env.OPEN_TOOLING_VSCODE_VERSION || process.env.OPENENV_VSCODE_VERSION || 'stable', cachePath: resolve('.vscode-test') });
  // Recent macOS releases renamed the executable from Electron to Code.
  if (process.platform === 'darwin' && !existsSync(executable) && existsSync(join(dirname(executable), 'Code'))) executable = join(dirname(executable), 'Code');
  const extensions = join(temporary, 'extensions');
  const user = join(temporary, 'user');
  const workspace = join(temporary, 'workspace');
  const driver = join(temporary, 'driver');
  for (const path of [extensions, join(user, 'User'), workspace, driver]) mkdirSync(path, { recursive: true });
  writeFileSync(join(driver, 'package.json'), JSON.stringify({ name: 'openenv-host-tests', publisher: 'openenv-tests', version: '0.0.0', engines: { vscode: '^1.100.0' } }));
  writeFileSync(join(user, 'User/settings.json'), JSON.stringify({ 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false }));
  writeFileSync(join(workspace, 'openenv.yaml'), readFileSync('examples/openenv.yaml'));
  const manifest = JSON.parse(readFileSync('extensions/vscode/package.json', 'utf8'));
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const vsix = process.env.OPEN_TOOLING_VSIX || resolve(`dist/openenv-${manifest.version}.vsix`);
  const install = spawnSync(cli, [...args, '--install-extension', vsix, '--extensions-dir', extensions, '--user-data-dir', user], { encoding: 'utf8' });
  if (install.status !== 0) throw new Error(`VSIX installation failed: ${install.stderr || install.stdout}`);
  await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: driver,
    extensionTestsPath: resolve('extensions/vscode/integration/host.cjs'),
    extensionTestsEnv: { OPENENV_TEST_WORKSPACE: workspace },
    launchArgs: [workspace, '--extensions-dir', extensions, '--user-data-dir', user, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--no-sandbox'] });
} catch (error) {
  const { readdirSync, existsSync } = await import('node:fs');
  const logs = join(temporary, 'user/logs');
  function showLogs(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) showLogs(file);
      else if (entry.name === 'exthost.log') {
        const text = readFileSync(file, 'utf8'); const errorStart = text.indexOf('[error]');
        console.error(errorStart < 0 ? text.slice(-500) : text.slice(errorStart, errorStart + 2500));
      }
    }
  }
  showLogs(logs); throw error;
} finally { rmSync(temporary, { recursive: true, force: true }); }
