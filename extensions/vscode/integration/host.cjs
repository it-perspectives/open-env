const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await wait(100); }
  throw new Error('Timed out waiting for Open ENV diagnostics.');
}
exports.run = async function () {
  const directory = process.env.OPENENV_TEST_WORKSPACE;
  const uri = vscode.Uri.file(path.join(directory, 'openenv.yaml'));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const extension = vscode.extensions.getExtension('it-perspectives.openenv');
  assert.ok(extension, 'VSIX is installed');
  await until(() => extension.isActive);
  assert.equal(extension.packageJSON.displayName, 'Open ENV');
  const original = document.getText();
  const edited = original.replace('required: true', 'requred: true');
  const replace = async text => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  await replace(edited);
  try { await until(() => vscode.languages.getDiagnostics(uri).some(d => d.source === 'Open ENV' && d.message.includes('requred'))); } catch (error) {
    console.log('Current diagnostics:', JSON.stringify(vscode.languages.getDiagnostics(uri)));
    console.log('Current document version:', document.version, 'has typo:', document.getText().includes('requred'));
    console.log('Packaged validator result:', require(path.join(extension.extensionPath, 'dist/validator.cjs')).lintSpec(require(path.join(extension.extensionPath, 'dist/validator.cjs')).parseSpec(document.getText())));
    throw error;
  }
  const error = vscode.languages.getDiagnostics(uri).find(d => d.message.includes('requred'));
  assert.equal(document.getText(error.range), 'requred');
  assert.equal(document.isDirty, true);
  await replace(original);
  await until(() => !vscode.languages.getDiagnostics(uri).some(d => d.source === 'Open ENV'));
  const keyOffset = original.indexOf('required:');
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, document.positionAt(keyOffset + 2));
  assert.ok(hovers.some(h => h.contents.some(content => content.value?.replaceAll('&nbsp;', ' ').includes('must be present'))), JSON.stringify({language:document.languageId,contents:hovers.flatMap(h=>h.contents.map(c=>({value:c.value, text:String(c), names:Object.getOwnPropertyNames(c)})))}));
  await replace('openenv: "0.1.0"\ninfo:\n  title: test\n  version: "1"\nvariables:\n  VALUE:\n    description: test\n    type: array\n    ');
  const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, document.positionAt(document.getText().length));
  assert.ok(completions.items.some(item => item.label === 'delimiter'));
  assert.ok(!completions.items.some(item => item.label === 'minimum'));
  await replace(original);
  for (const theme of ['Default Light Modern', 'Default Dark Modern', 'Default High Contrast']) {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('openenv.openPreviewToSide', uri);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
  const secondUri = vscode.Uri.file(path.join(directory, 'other/openenv.json'));
  fs.mkdirSync(path.dirname(secondUri.fsPath), { recursive: true });
  fs.writeFileSync(secondUri.fsPath, '{"openenv":"0.1.0","info":{"title":"test","version":"1"},"variables":{},"extra":true}');
  const second = await vscode.workspace.openTextDocument(secondUri);
  await vscode.window.showTextDocument(second);
  await until(() => vscode.languages.getDiagnostics(secondUri).some(d => d.source === 'Open ENV'));
  assert.ok(!vscode.languages.getDiagnostics(uri).some(d => d.source === 'Open ENV'));
  const jsonError = vscode.languages.getDiagnostics(secondUri).find(d => d.message.includes('extra'));
  assert.equal(second.getText(jsonError.range), '"extra"');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await until(() => !vscode.languages.getDiagnostics(secondUri).some(d => d.source === 'Open ENV'));
  console.log('Installed VSIX: automatic validation, unsaved edits, source ranges, completion, hover, themes and document cleanup passed.');
};
