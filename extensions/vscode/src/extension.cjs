const { randomBytes } = require('node:crypto');
const { renderPreview } = require('./render.cjs');
const { sourceModel, diagnosticOffsets, editorCompletions, editorHover } = require('./language.cjs');
const supported = uri => /(?:^|\/)openenv\.(yaml|yml|json)$/.test(uri.path);

function createExtension(vscode, validator) {
  const panels = new Map();
  const states = new Map();
  const closedResources = new Set();
  let diagnostics;
  let activated = false;
  let disposed = false;
  const toRange = (document, offsets, expand = false) => {
    const length = document.getText().length;
    const start = Math.min(length, Math.max(0, offsets[0]));
    const end = Math.min(length, Math.max(start + (expand ? 1 : 0), offsets[1]));
    return new vscode.Range(document.positionAt(start), document.positionAt(end));
  };
  function update(document) {
    const key = document.uri.toString();
    const previous = states.get(key);
    clearTimeout(previous?.timer);
    const source = document.getText();
    if (previous?.source === source) return previous;
    const format = document.uri.path.endsWith('.json') ? 'json' : 'yaml';
    let spec, result;
    try {
      spec = validator.parseSpec(source, { format });
      result = validator.lintSpec(spec);
    } catch (error) {
      result = { valid: false, diagnostics: [{ severity: 'error', code: error.code || 'PREVIEW_ERROR', path: '/', message: error.code ? error.message : 'Unable to validate this document.' }] };
    }
    let model;
    try {
      model = Buffer.byteLength(source, 'utf8') <= 1024 * 1024 ? sourceModel(source, format) : { source: '', format, entries: new Map() };
    } catch {
      model = { source, format, entries: new Map() };
    }
    const state = { document, source, spec, result, model };
    states.set(key, state);
    if (diagnostics) diagnostics.set(document.uri, result.diagnostics.map(item => {
      const diagnostic = new vscode.Diagnostic(toRange(document, diagnosticOffsets(model, item), true), item.message,
        item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'Open ENV'; diagnostic.code = item.code;
      return diagnostic;
    }));
    const panel = panels.get(key)?.panel;
    if (panel) panel.webview.html = renderPreview(spec, result, randomBytes(16).toString('hex'));
    return state;
  }
  function changed(event) {
    const document = event.document;
    if (!supported(document.uri) || disposed || closedResources.has(document.uri.toString())) return;
    const key = document.uri.toString();
    const state = states.get(key) || { document };
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { if (!disposed) update(document); }, 180);
    states.set(key, state);
  }
  function close(document) {
    const key = document.uri.toString();
    clearTimeout(states.get(key)?.timer);
    states.delete(key); diagnostics?.delete(document.uri);
    panels.get(key)?.panel.dispose();
  }
  async function openPreview(uri) {
    const resource = uri || vscode.window.activeTextEditor?.document.uri;
    if (!resource || !supported(resource)) {
      vscode.window.showInformationMessage('Open openenv.yaml, openenv.yml or openenv.json to preview its contract.');
      return;
    }
    const key = resource.toString();
    if (panels.has(key)) { panels.get(key).panel.reveal(vscode.ViewColumn.Beside); return; }
    const document = await vscode.workspace.openTextDocument(resource);
    if (disposed) return;
    if (panels.has(key)) { panels.get(key).panel.reveal(vscode.ViewColumn.Beside); return; }
    const panel = vscode.window.createWebviewPanel('openenv.preview', 'Open ENV Preview', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
    // Also supports standalone dependency-injected preview lifecycle tests.
    const listener = activated ? undefined : vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === key) changed({ document });
    });
    panel.onDidDispose(() => {
      listener?.dispose(); panels.delete(key);
      if (!activated) { clearTimeout(states.get(key)?.timer); states.delete(key); }
    });
    panels.set(key, { panel });
    const state = update(document);
    panel.webview.html = renderPreview(state.spec, state.result, randomBytes(16).toString('hex'));
  }
  function activate(context) {
    activated = true;
    diagnostics = vscode.languages.createDiagnosticCollection('openenv');
    const selector = ['**/openenv.yaml', '**/openenv.yml', '**/openenv.json'].map(pattern => ({ pattern }));
    context.subscriptions.push(diagnostics,
      vscode.commands.registerCommand('openenv.openPreviewToSide', openPreview),
      vscode.workspace.onDidOpenTextDocument(document => { closedResources.delete(document.uri.toString()); if (supported(document.uri)) update(document); }),
      vscode.workspace.onDidChangeTextDocument(changed),
      vscode.workspace.onDidCloseTextDocument(document => { close(document); closedResources.delete(document.uri.toString()); }),
      vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems(document, position) {
        if (!supported(document.uri)) return [];
        const state = update(document);
        return editorCompletions(state.model, document.offsetAt(position), validator.schema).map(item => {
          const completion = new vscode.CompletionItem(item.label, vscode.CompletionItemKind.Property);
          completion.range = toRange(document, item.range);
          completion.insertText = item.insertText;
          completion.detail = item.required ? 'Required' : undefined;
          const markdown = new vscode.MarkdownString(); markdown.appendText(item.description);
          completion.documentation = markdown;
          return completion;
        });
      } }, ':', '"', ' '),
      vscode.languages.registerHoverProvider(selector, { provideHover(document, position) {
        if (!supported(document.uri)) return undefined;
        const item = editorHover(update(document).model, document.offsetAt(position), validator.schema);
        if (!item) return undefined;
        const markdown = new vscode.MarkdownString(); markdown.appendText(item.text);
        return new vscode.Hover(markdown, toRange(document, item.range));
      } }),
      { dispose() {
        disposed = true;
        for (const state of states.values()) clearTimeout(state.timer);
        for (const { panel } of [...panels.values()]) panel.dispose();
        states.clear(); closedResources.clear();
      } });
    // VS Code language services may retain a TextDocument after its last tab closes.
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
      for (const tab of event.closed) {
        const uri = tab.input?.uri;
        if (!uri || !supported(uri)) continue;
        const key = uri.toString();
        if (vscode.window.tabGroups.all.some(group => group.tabs.some(other => other.input?.uri?.toString() === key))) continue;
        closedResources.add(key);
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === key);
        if (document) close(document);
      }
      for (const tab of event.opened) {
        const uri = tab.input?.uri;
        if (!uri || !supported(uri)) continue;
        const key = uri.toString(); closedResources.delete(key);
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === key);
        if (document) update(document);
      }
    }));
    for (const document of vscode.workspace.textDocuments) if (supported(document.uri)) update(document);
  }
  return { activate, openPreview };
}
function activate(context) {
  createExtension(require('vscode'), require('../dist/validator.cjs')).activate(context);
}
module.exports = { activate, createExtension, supported };
