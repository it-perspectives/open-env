import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { parseSpec, lintSpec, schema } from '../src/index.js';
const require = createRequire(import.meta.url);
const { sourceModel, diagnosticOffsets, editorCompletions, editorHover } = require('../extensions/vscode/src/language.cjs');
const valid = 'openenv: "0.1.0"\ninfo:\n  title: Demo\n  version: "1"\nvariables:\n  VALUE:\n    description: Value\n    type: string\n';
function diagnostics(source, format = 'yaml') {
  const model = sourceModel(source, format);
  let result;
  try { result = lintSpec(parseSpec(source, { format })); }
  catch (error) { result = { diagnostics: [{ code: error.code, path: '/', message: error.message }] }; }
  return result.diagnostics.map(item => ({ ...item, text: source.slice(...diagnosticOffsets(model, item)) }));
}
for (const [name, text, expected] of [
  ['root', valid + 'extra: true\n', 'extra'],
  ['info', valid.replace('title: Demo', 'title: Demo\n  typo: true'), 'typo'],
  ['variable', valid + '    requred: true\n', 'requred'],
  ['quoted key', valid + '    "requred": true\n', '"requred"'],
  ['escaped pointer', valid + '    "wrong/~key": true\n', '"wrong/~key"'],
  ['unicode', valid.replace('title: Demo', 'title: "😺 Ямл"') + '    лишнее: true\n', 'лишнее'],
]) test(`unknown field precise range: ${name}`, () => {
  const item = diagnostics(text).find(item => item.keyword === 'additionalProperties');
  assert.equal(item.text, expected); assert.match(item.message, /Unknown field/); assert.equal(item.code, 'SCHEMA');
});
test('JSON property ranges include quotes and escaped keys', () => {
  const spec = parseSpec(valid); spec.variables.VALUE['bad/~key'] = true;
  const source = JSON.stringify(spec, null, 2);
  assert.equal(diagnostics(source, 'json').find(d => d.keyword === 'additionalProperties').text, '"bad/~key"');
});
test('invalid values and literal array elements have exact ranges', () => {
  assert.equal(diagnostics(valid.replace('type: string', 'type: wat')).find(d => d.keyword === 'enum').text, 'wat');
  const source = valid.replace('type: string', 'type: array\n    delimiter: ","\n    default: ["ok", 5]');
  assert.ok(diagnostics(source).some(d => d.text === '5'));
});
test('missing properties highlight the containing object', () => {
  const item = diagnostics(valid.replace('    description: Value\n', '')).find(d => d.keyword === 'required');
  assert.equal(item.property, 'description'); assert.match(item.text, /type: string/);
});
test('invalid variable names use key ranges', () => {
  assert.ok(diagnostics(valid.replace('VALUE:', 'BAD-NAME:')).some(d => d.text === 'BAD-NAME'));
});
for (const [name, text, code, expected] of [
  ['duplicate YAML key', valid + 'openenv: "0.1.0"', 'PARSE_DOCUMENT', 'openenv'],
  ['strict JSON comma', '{"a":1,}', 'PARSE_JSON', '}'],
  ['JSON comment', '{/* comment */"a":1}', 'PARSE_JSON', '/* comment */'],
  ['JSON duplicate escaped keys', '{"a":1,"\\u0061":2}', 'PARSE_DOCUMENT', '"\\u0061"'],
  ['JSON merge', '{"<<":1}', 'PARSE_MERGE', '"<<"'],
  ['explicit tag', 'a: !!str hello', 'PARSE_YAML_FEATURE', '!!str'],
  ['alias', 'a: &v hello\nb: *v', 'PARSE_YAML_FEATURE', '*v'],
  ['merge', 'a: {<<: {x: 1}}', 'PARSE_MERGE', '<<'],
  ['non-string key', 'true: value', 'PARSE_KEY', 'true'],
  ['unsafe integer', 'a: 9007199254740992', 'PARSE_NUMBER', '9007199254740992'],
]) test(`syntax location: ${name}`, () => {
  const item = diagnostics(text, name.startsWith('JSON') || name.startsWith('strict JSON') ? 'json' : 'yaml')[0];
  assert.equal(item.code, code); assert.equal(item.text, expected);
});
test('x-* allowed on supported objects, with explanatory hover', () => {
  const source = valid + '    x-owner: team\n';
  assert.deepEqual(diagnostics(source), []);
  assert.match(editorHover(sourceModel(source, 'yaml'), source.indexOf('x-owner') + 2, schema).text, /ignore/);
});
for (const format of ['yaml', 'json']) test(`${format}: completion respects type, existing fields and sensitive`, () => {
  const source = format === 'yaml' ? valid.replace('type: string', 'type: array\n    sensitive: true') + '    ' : '{"variables":{"VALUE":{"description":"v","type":"array","sensitive":true, ';
  const items = editorCompletions(sourceModel(source, format), source.length, schema);
  assert.ok(items.some(i => i.label === 'delimiter' && i.required));
  for (const label of ['type', 'description', 'minimum', 'minLength', 'default', 'examples', 'enum']) assert.ok(!items.some(i => i.label === label), label);
});
for (const [source, format, labels] of [
  ['open', 'yaml', ['openenv']],
  ['info:\n  ti', 'yaml', ['title','version']],
  ['variables:\n  VALUE:\n    type: ', 'yaml', ['"array"','"string"']],
  ['variables:\n  VALUE:\n    required: ', 'yaml', ['true','false']],
  ['{"info":{"ti', 'json', ['title','version']],
  ['{"openenv": ', 'json', ['"0.1.0"']],
  ['{"variables":{"V":{"type": ', 'json', ['"array"']],
]) test(`incomplete ${format} completion: ${source}`, () => {
  const items = editorCompletions(sourceModel(source, format), source.length, schema);
  for (const label of labels) assert.ok(items.some(i => i.label === label));
});
test('hover uses schema documentation and mandatory-field information', () => {
  const hover = editorHover(sourceModel(valid, 'yaml'), valid.indexOf('type:') + 2, schema);
  assert.match(hover.text, /decode/); assert.match(hover.text, /Required/);
});
test('no standard-field suggestions inside extension metadata or block scalar text', () => {
  for (const source of ['x-owner:\n  ', valid + '    x-owner:\n      ', valid.replace('description: Value', 'description: |\n      text\n      ')]) {
    const offset = source.includes('text') ? source.indexOf('text') + 2 : source.length;
    assert.deepEqual(editorCompletions(sourceModel(source, 'yaml'), offset, schema), []);
  }
});

test('flow YAML completion after commas stays in the innermost mapping', () => {
  for (const source of ['variables: { VALUE: { type: array, ', 'variables: { VALUE: { ']) {
    const items = editorCompletions(sourceModel(source, 'yaml'), source.length, schema);
    assert.ok(items.some(item => item.label === 'delimiter'));
    assert.ok(!items.some(item => item.label === '"array"'));
  }
  const completed = 'variables: { VALUE: { type: "array" }}';
  assert.deepEqual(editorCompletions(sourceModel(completed, 'yaml'), completed.length, schema), []);
});
