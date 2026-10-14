import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isAlias, isMap, isScalar, parseAllDocuments, visit } from 'yaml';

export const specificationVersion = '0.1.0';
export const schema = JSON.parse(readFileSync(new URL('../schemas/openenv-0.1.0.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validateSpec = ajv.compile(schema);
const constraints = ['type', 'enum', 'format', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum'];
const own = (object, key) => Object.hasOwn(object, key);
const pointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const diagnostic = (code, path, message, severity = 'error') => ({ severity, code, path, message });
const result = (diagnostics) => ({ valid: !diagnostics.some((item) => item.severity === 'error'), diagnostics });

export class SpecParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecParseError';
    this.code = code;
  }
}

/** Parse a single JSON-compatible YAML 1.2 or strict JSON document. */
export function parseSpec(source, { format = 'yaml' } = {}) {
  if (typeof source !== 'string' || !['yaml', 'json'].includes(format)) {
    throw new SpecParseError('PARSE_INPUT', 'Expected text and format "yaml" or "json".');
  }
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) {
    throw new SpecParseError('PARSE_SIZE', 'Documents must not exceed 1 MiB.');
  }
  if (format === 'json') {
    try { JSON.parse(source); } catch {
      throw new SpecParseError('PARSE_JSON', 'Invalid JSON syntax.');
    }
  }
  const documents = parseAllDocuments(source, { version: '1.2', uniqueKeys: true, prettyErrors: false, logLevel: 'silent' });
  if (documents.length !== 1) {
    throw new SpecParseError('PARSE_DOCUMENT_COUNT', 'Expected exactly one document.');
  }
  const [document] = documents;
  if (document.errors.length || document.warnings.length) {
    throw new SpecParseError('PARSE_DOCUMENT', 'Invalid document, duplicate keys, or unsupported YAML syntax.');
  }
  if (document.directives.yaml.version !== '1.2') {
    throw new SpecParseError('PARSE_YAML_VERSION', 'Only YAML 1.2 is supported.');
  }
  visit(document, (_, node) => {
    if (isAlias(node) || node?.tag) {
      throw new SpecParseError('PARSE_YAML_FEATURE', 'Aliases and explicit YAML tags are not supported.');
    }
    if (isMap(node) && node.items.some((pair) => !isScalar(pair.key) || typeof pair.key.value !== 'string')) {
      throw new SpecParseError('PARSE_KEY', 'Mapping keys must be strings.');
    }
    if (isMap(node) && node.items.some((pair) => pair.key.value === '<<')) {
      throw new SpecParseError('PARSE_MERGE', 'The reserved YAML merge key "<<" is not supported.');
    }
  });
  const value = document.toJS();
  assertJsonValue(value);
  return value;
}

function assertJsonValue(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new SpecParseError('PARSE_NUMBER', 'Numbers must be finite; integers must be within the safe integer range.');
  }
  if (Array.isArray(value)) value.forEach(assertJsonValue);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertJsonValue);
}

function valueSchema(variable, includeEnum = true) {
  const value = Object.fromEntries(constraints.filter((key) => own(variable, key) && (includeEnum || key !== 'enum')).map((key) => [key, variable[key]]));
  if (variable.type === 'array') value.items = { type: 'string' };
  return value;
}

/** Validate the document shape and cross-field semantics without changing it. */
export function lintSpec(spec) {
  if (!validateSpec(spec)) {
    return result(validateSpec.errors.map((error) => {
      const property = error.params.additionalProperty ?? error.params.missingProperty ?? error.params.propertyName ?? error.propertyName;
      const message = error.keyword === 'additionalProperties'
        ? `Unknown field ${JSON.stringify(property)}. This field is not supported by OpenENV ${specificationVersion}.`
        : error.message;
      return { ...diagnostic('SCHEMA', error.instancePath || '/', message), keyword: error.keyword,
        ...(property === undefined ? {} : { property }) };
    }));
  }
  const diagnostics = [];
  for (const [name, variable] of Object.entries(spec.variables)) {
    const path = `/variables/${pointer(name)}`;
    if (name !== name.toUpperCase()) diagnostics.push(diagnostic('ENV_NAME_CASE', path, 'Uppercase variable names are recommended.', 'warning'));
    if (variable.sensitive && (own(variable, 'default') || own(variable, 'examples') || own(variable, 'enum'))) {
      diagnostics.push(diagnostic('SENSITIVE_LITERAL', path, 'Sensitive variables must not declare defaults, examples, or enumerated values.'));
    }
    for (const [lower, upper] of [['minimum', 'maximum'], ['minLength', 'maxLength']]) {
      if (own(variable, lower) && own(variable, upper) && variable[lower] > variable[upper]) {
        diagnostics.push(diagnostic('CONSTRAINT_RANGE', path, `${lower} must not exceed ${upper}.`));
      }
    }
    let validateValue;
    let validateEnumValue;
    try {
      validateValue = ajv.compile(valueSchema(variable));
      validateEnumValue = ajv.compile(valueSchema(variable, false));
    } catch {
      diagnostics.push(diagnostic('CONSTRAINT_INVALID', path, 'Invalid value constraint (for example, an invalid regular expression).'));
      continue;
    }
    const checkLiteral = (value, suffix, validator) => {
      if (!validator(value) || (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))) {
        diagnostics.push(diagnostic('LITERAL_INVALID', `${path}/${suffix}`, 'Declared value does not satisfy the variable constraints.'));
      }
    };
    if (own(variable, 'default')) checkLiteral(variable.default, 'default', validateValue);
    variable.enum?.forEach((value, index) => checkLiteral(value, `enum/${index}`, validateEnumValue));
    variable.examples?.forEach((value, index) => checkLiteral(value, `examples/${index}`, validateValue));
  }
  return result(diagnostics);
}

function decode(raw, { type, delimiter }) {
  if (type === 'string') return { value: raw };
  if (type === 'array') return { value: raw === '' ? [] : raw.split(delimiter) };
  if (type === 'boolean') {
    if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
    return { error: 'Expected exactly "true" or "false".' };
  }
  const pattern = type === 'integer' ? /^-?(?:0|[1-9][0-9]*)$/ : /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
  if (!pattern.test(raw)) return { error: `Expected a decimal ${type} without surrounding whitespace.` };
  const value = Number(raw);
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    return { error: 'Expected a finite number within the supported integer range.' };
  }
  return { value };
}

/** Check string environment values. Defaults are resolved without mutating input. */
export function checkEnvironment(spec, environment) {
  const lint = lintSpec(spec);
  if (!lint.valid) return lint;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    return result([diagnostic('ENV_INPUT', '/', 'Environment must be an object containing string values.')]);
  }
  const diagnostics = [...lint.diagnostics];
  const values = Object.create(null);
  for (const [name, variable] of Object.entries(spec.variables)) {
    const path = `/variables/${pointer(name)}`;
    if (!own(environment, name) || environment[name] === undefined) {
      if (own(variable, 'default')) values[name] = Array.isArray(variable.default) ? [...variable.default] : variable.default;
      else if (variable.required) diagnostics.push(diagnostic('ENV_REQUIRED', path, 'Required environment variable is missing.'));
      continue;
    }
    if (typeof environment[name] !== 'string') {
      diagnostics.push(diagnostic('ENV_TYPE', path, 'Environment values must be strings.'));
      continue;
    }
    const decoded = decode(environment[name], variable);
    if (decoded.error) {
      diagnostics.push(diagnostic('ENV_TYPE', path, decoded.error));
      continue;
    }
    const validateValue = ajv.compile(valueSchema(variable));
    if (!validateValue(decoded.value)) {
      diagnostics.push(diagnostic('ENV_CONSTRAINT', path, 'Environment value does not satisfy the declared constraints.'));
      continue;
    }
    values[name] = decoded.value;
  }
  const checked = result(diagnostics);
  return checked.valid ? { ...checked, values } : checked;
}
