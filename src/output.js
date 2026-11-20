import { UsageError } from './errors.js';

export const OUTPUT_FORMATS = ['table', 'json', 'yaml'];

export function checkOutputFormat(value) {
  const format = value ?? 'table';
  if (!OUTPUT_FORMATS.includes(format)) {
    throw new UsageError(`--output must be one of: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  return format;
}

/** Removes control characters so portal text cannot move the cursor or recolour the terminal. */
export function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
}

/** Like clean() but keeps line breaks, for multi-line ticket text. */
export function cleanBlock(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ');
}

function width(text) {
  return [...text].length;
}

function pad(text, size) {
  return text + ' '.repeat(Math.max(0, size - width(text)));
}

/** Aligned columns. columns: [{ header, value: (row) => any }] */
export function table(rows, columns) {
  const cells = rows.map((row) => columns.map((col) => clean(col.value(row))));
  const headers = columns.map((col) => col.header);
  const widths = headers.map((h, i) => Math.max(width(h), ...cells.map((r) => width(r[i]))));
  const line = (values) => values.map((v, i) => (i === values.length - 1 ? v : pad(v, widths[i]))).join('  ').trimEnd();
  return [line(headers), ...cells.map(line)].join('\n');
}

/** Two aligned columns of label and value; rows with an undefined value are skipped. */
export function keyValue(pairs) {
  const shown = pairs.filter(([, v]) => v !== undefined);
  const size = Math.max(0, ...shown.map(([k]) => width(k)));
  return shown.map(([k, v]) => `${pad(`${k}:`, size + 1)} ${clean(v === null || v === '' ? '-' : v)}`.trimEnd()).join('\n');
}

export function toJson(data) {
  return JSON.stringify(data, null, 2);
}

const YAML_RESERVED = /^(?:true|false|yes|no|on|off|null|y|n|~)$/i;
const YAML_NUMBERISH = /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$|^0[xob]|^[-+]?\.(?:inf|nan)$/i;

function yamlString(value) {
  if (
    value !== '' &&
    /^[A-Za-z0-9_./+()-][A-Za-z0-9 _./@:+()-]*$/.test(value) &&
    !/:(?: |$)/.test(value) &&
    !value.endsWith(' ') &&
    !YAML_RESERVED.test(value) &&
    !YAML_NUMBERISH.test(value) &&
    !/^[-?:] /.test(value) &&
    value !== '-'
  ) {
    return value;
  }
  // A JSON string is a valid YAML double-quoted scalar.
  return JSON.stringify(value);
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return yamlString(String(value));
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function isEmptyContainer(value) {
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
}

function yamlLines(value, indent) {
  const pre = ' '.repeat(indent);
  if (Array.isArray(value)) {
    const lines = [];
    for (const item of value) {
      if (isContainer(item) && !isEmptyContainer(item)) {
        const inner = yamlLines(item, indent + 2);
        lines.push(`${pre}- ${inner[0].slice(indent + 2)}`, ...inner.slice(1));
      } else {
        lines.push(`${pre}- ${isContainer(item) ? (Array.isArray(item) ? '[]' : '{}') : yamlScalar(item)}`);
      }
    }
    return lines;
  }
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    const k = yamlString(key);
    if (isContainer(item)) {
      if (isEmptyContainer(item)) lines.push(`${pre}${k}: ${Array.isArray(item) ? '[]' : '{}'}`);
      else lines.push(`${pre}${k}:`, ...yamlLines(item, Array.isArray(item) ? indent : indent + 2));
    } else {
      lines.push(`${pre}${k}: ${yamlScalar(item)}`);
    }
  }
  return lines;
}

/** A small YAML emitter for JSON data (block style, double-quoted strings when needed). */
export function toYaml(data) {
  if (!isContainer(data)) return yamlScalar(data);
  if (isEmptyContainer(data)) return Array.isArray(data) ? '[]' : '{}';
  return yamlLines(data, 0).join('\n');
}

/** Short local-time-free date: 2026-11-20 14:05 UTC. */
export function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function yesNo(value) {
  if (value === undefined || value === null) return '';
  return value ? 'yes' : 'no';
}
