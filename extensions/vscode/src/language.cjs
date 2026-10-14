const { parseAllDocuments, isMap, isSeq, isScalar, isAlias, visit } = require('yaml');
const { parseTree, getLocation } = require('jsonc-parser');
const encode = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = parts => parts.length ? '/' + parts.map(encode).join('/') : '';
const parent = path => path.slice(0, path.lastIndexOf('/'));
const parts = path => path ? path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')) : [];
const range = node => node?.range ? node.range.slice(0, 2) : [0, 0];

// Location parsing only supplies editor positions. parseSpec/lintSpec remain authoritative.
function sourceModel(source, format) {
  const entries = new Map();
  const errors = [];
  if (format === 'json') {
    let duplicateRange, featureRange;
    const root = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
    function walk(node, path, key) {
      if (!node) return;
      const entry = { key, value: [node.offset, node.offset + node.length], kind: node.type, keys: [], literal: node.value };
      entries.set(path, entry);
      if (node.type === 'object') for (const property of node.children || []) {
        const [name, value] = property.children;
        if (entry.keys.includes(name.value) && !duplicateRange) duplicateRange = [name.offset, name.offset + name.length];
        if (name.value === '<<' && !featureRange) featureRange = [name.offset, name.offset + name.length];
        entry.keys.push(name.value);
        walk(value, path + '/' + encode(name.value), [name.offset, name.offset + name.length]);
        if (!value) entries.set(path + '/' + encode(name.value), { key: [name.offset, name.offset + name.length], value: [property.offset + property.length, property.offset + property.length], kind: 'null', keys: [] });
      }
      if (node.type === 'array') (node.children || []).forEach((child, index) => walk(child, path + '/' + index));
    }
    walk(root, '');
    return { source, format, entries, featureRange, syntaxRange: errors[0] ? [errors[0].offset, errors[0].offset + Math.max(1, errors[0].length)] : duplicateRange };
  }
  const docs = parseAllDocuments(source, { version: '1.2', uniqueKeys: true, prettyErrors: false, logLevel: 'silent', keepSourceTokens: true });
  const doc = docs[0];
  function walk(node, path, key) {
    const entry = { key, value: node ? range(node) : [key?.[1] || 0, key?.[1] || 0], kind: isMap(node) ? 'object' : isSeq(node) ? 'array' : 'scalar', keys: [], literal: isScalar(node) ? node.value : undefined };
    entries.set(path, entry);
    if (isMap(node)) for (const pair of node.items) {
      if (!isScalar(pair.key)) continue;
      entry.keys.push(String(pair.key.value));
      walk(pair.value, path + '/' + encode(pair.key.value), range(pair.key));
    }
    if (isSeq(node)) node.items.forEach((child, index) => walk(child, path + '/' + index));
  }
  if (doc) walk(doc.contents, '');
  const syntax = doc?.errors[0] || doc?.warnings[0];
  let featureRange, invalidKeyRange;
  if (doc) visit(doc, (_, node) => {
    if (!invalidKeyRange && isMap(node)) invalidKeyRange = node.items.find(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string')?.key?.range?.slice(0, 2);
    if (!featureRange && (isAlias(node) || node?.tag || (isScalar(node) && node.value === '<<'))) featureRange = range(node);
    if (node?.tag && featureRange?.[0] === range(node)[0]) {
      const prefix = source.slice(source.lastIndexOf('\n', range(node)[0] - 1) + 1, range(node)[0]);
      const tag = /!\S+\s*$/.exec(prefix);
      if (tag) featureRange = [range(node)[0] - tag[0].length, range(node)[0] - tag[0].length + tag[0].trimEnd().length];
    }
  });
  const duplicate = syntax?.code === 'DUPLICATE_KEY' ? [...entries.values()].find(e => e.key && e.key[0] === syntax.pos[0])?.key : undefined;
  return { source, format, entries, syntaxRange: duplicate || syntax?.pos, featureRange, invalidKeyRange, documentRange: docs[1]?.range?.slice(0, 2), yamlVersionRange: source.startsWith('%YAML') ? [0, source.indexOf('\n') < 0 ? source.length : source.indexOf('\n')] : undefined };
}

function diagnosticOffsets(model, item) {
  if (item.code.startsWith('PARSE_')) {
    if (item.code === 'PARSE_YAML_FEATURE' || item.code === 'PARSE_MERGE') return model.featureRange || [0, 1];
    if (item.code === 'PARSE_DOCUMENT_COUNT') return model.documentRange || [0, 1];
    if (item.code === 'PARSE_YAML_VERSION') return model.yamlVersionRange || [0, 1];
    if (item.code === 'PARSE_NUMBER') {
      for (const entry of model.entries.values()) if (typeof entry.literal === 'number' && (!Number.isFinite(entry.literal) || Number.isInteger(entry.literal) && !Number.isSafeInteger(entry.literal))) return entry.value;
    }
    if (item.code === 'PARSE_KEY') return model.invalidKeyRange || [0, 1];
    return model.syntaxRange || [0, 1];
  }
  let path = item.path === '/' ? '' : item.path;
  if (item.property && item.keyword !== 'required') path += '/' + encode(item.property);
  // Semantic errors identify the variable; narrow those to the relevant field.
  if (item.code === 'CONSTRAINT_INVALID') path += '/pattern';
  if (item.code === 'CONSTRAINT_RANGE') path += model.entries.has(path + '/maximum') ? '/maximum' : '/maxLength';
  let entry = model.entries.get(path);
  if (item.keyword === 'additionalProperties' || item.keyword === 'propertyNames' || item.property && item.keyword === 'pattern' || item.code === 'ENV_NAME_CASE') return entry?.key || entry?.value || [0, 1];
  while (!entry && path) { path = parent(path); entry = model.entries.get(path); }
  return entry?.value || [0, 1];
}

function definition(schema, path) {
  const p = parts(path);
  if (!p.length) return schema;
  if (p[0] === 'info' && p.length <= 2) return p.length === 1 ? schema.properties.info : schema.properties.info.properties[p[1]];
  if (p[0] === 'variables') {
    if (p.length === 1) return schema.properties.variables;
    if (p.length === 2) return schema.$defs.variable;
    return p.length === 3 ? schema.$defs.variable.properties[p[2]] : undefined;
  }
  return p.length === 1 ? schema.properties[p[0]] : undefined;
}

function contextAt(model, offset) {
  const { source, format, entries } = model;
  if (format === 'json') {
    const loc = getLocation(source, offset);
    const path = pointer(loc.path);
    return { key: loc.isAtPropertyKey, path: loc.isAtPropertyKey ? parent(path) : path, token: loc.previousNode ? [loc.previousNode.offset, loc.previousNode.offset + loc.previousNode.length] : [offset, offset] };
  }
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = source.indexOf('\n', offset);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const before = source.slice(lineStart, offset);
  if (/^\s*#/.test(before) || /\s+#/.test(before) || /^\s*-/.test(line)) return null;
  const flow = [...entries].filter(([, entry]) => entry.kind === 'object' && source[entry.value[0]] === '{' && entry.value[0] < offset && offset <= entry.value[1]).sort((a, b) => b[1].value[0] - a[1].value[0])[0];
  if (flow) {
    const [path, container] = flow;
    const preceding = [...entries].filter(([child, entry]) => parent(child) === path && entry.key && entry.key[0] < offset).at(-1)?.[1];
    const tailStart = preceding ? preceding.value[1] : container.value[0] + 1;
    const tail = source.slice(tailStart, offset);
    if (preceding ? /^\s*,\s*$/.test(tail) : /^\s*$/.test(tail)) return { key: true, path, token: [offset, offset] };
  }
  // Existing key/value spans also support flow-style YAML maps and quoted keys.
  for (const [path, entry] of [...entries].reverse()) if (entry.key && entry.key[0] >= lineStart && entry.key[0] <= offset) {
    if (offset <= entry.key[1]) return { key: true, path: parent(path), token: entry.key };
    const between = source.slice(entry.key[1], offset);
    if (/^\s*:\s*[^\n]*$/.test(between) && (offset <= entry.value[1] || /^\s*$/.test(source.slice(entry.value[1], offset)))) return { key: false, path, token: entry.value };
  }
  for (const entry of entries.values()) if (entry.kind === 'scalar' && entry.value[0] < lineStart && offset < entry.value[1]) return null;
  // A blank or partially typed block key may extend beyond the parent's AST range.
  const indent = /^\s*/.exec(line)[0].length;
  const stack = [];
  const keys = [...entries].filter(([, e]) => e.key && e.key[0] < lineStart).sort((a, b) => a[1].key[0] - b[1].key[0]);
  for (const [path, entry] of keys) {
    const start = source.lastIndexOf('\n', entry.key[0] - 1) + 1;
    const column = entry.key[0] - start;
    if (/\S/.test(source.slice(start, entry.key[0]))) continue;
    while (stack.length && stack.at(-1).column >= column) stack.pop();
    stack.push({ path, column });
  }
  while (stack.length && stack.at(-1).column >= indent) stack.pop();
  return { key: true, path: stack.at(-1)?.path || '', token: [lineStart + indent, lineStart + line.length] };
}

function editorCompletions(model, offset, schema) {
  const context = contextAt(model, offset);
  if (!context) return [];
  const def = definition(schema, context.path);
  if (!def) return [];
  if (!context.key) {
    const values = def.const !== undefined ? [def.const] : def.enum || (def.type === 'boolean' ? [true, false] : []);
    return values.map(value => ({ label: JSON.stringify(value), insertText: JSON.stringify(value), range: context.token, description: def.description || '' }));
  }
  let fields = Object.entries(def.properties || {});
  const existing = model.entries.get(context.path)?.keys || [];
  const type = model.entries.get(context.path + '/type')?.literal;
  const sensitive = model.entries.get(context.path + '/sensitive')?.literal;
  fields = fields.filter(([name]) => {
    const current = model.source.slice(...context.token).replace(/^['"]|['"]$/g, '');
    if (existing.includes(name) && name !== current) return false;
    if (type && ['format', 'pattern', 'minLength', 'maxLength'].includes(name) && type !== 'string') return false;
    if (type && ['minimum', 'maximum'].includes(name) && !['integer', 'number'].includes(type)) return false;
    if (type && name === 'delimiter' && type !== 'array') return false;
    if (sensitive === true && ['default', 'examples', 'enum'].includes(name)) return false;
    return true;
  });
  const hasColon = /^\s*:/.test(model.source.slice(context.token[1]));
  return fields.map(([name, field]) => ({ label: name,
    insertText: (model.format === 'json' ? JSON.stringify(name) : name) + (hasColon ? '' : ': '),
    range: context.token, description: field.description || '', required: def.required?.includes(name) || name === 'delimiter' && type === 'array' }));
}

function editorHover(model, offset, schema) {
  for (const [path, entry] of model.entries) if (entry.key && entry.key[0] <= offset && offset <= entry.key[1]) {
    const p = parts(path);
    const name = p.at(-1);
    if (/^x-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && (p.length === 1 || p[0] === 'info' && p.length === 2 || p[0] === 'variables' && p.length === 3)) return { range: entry.key, text: 'Extension metadata. Consumers ignore unrecognized x-* properties; these do not change standard OpenENV fields.' };
    const def = definition(schema, path);
    if (!def?.description) return null;
    const required = definition(schema, parent(path))?.required?.includes(name) || name === 'delimiter' && model.entries.get(parent(path) + '/type')?.literal === 'array';
    return { range: entry.key, text: `${def.description}${required ? '\n\nRequired field.' : ''}` };
  }
  return null;
}
module.exports = { sourceModel, diagnosticOffsets, editorCompletions, editorHover, contextAt };
