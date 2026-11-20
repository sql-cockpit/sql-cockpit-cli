import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table, keyValue, toYaml, toJson, clean } from '../src/output.js';

test('table aligns columns', () => {
  const text = table([{ a: 'x', b: 1 }, { a: 'longer', b: 22 }], [
    { header: 'A', value: (r) => r.a },
    { header: 'B', value: (r) => r.b },
  ]);
  assert.equal(text, 'A       B\nx       1\nlonger  22');
});

test('table and keyValue strip control characters', () => {
  const text = table([{ a: 'bad\u001b[31mred\nline' }], [{ header: 'A', value: (r) => r.a }]);
  assert.ok(!text.includes('\u001b'));
  assert.ok(!text.split('\n')[1].includes('\n'));
  assert.equal(clean('a\tb'), 'a b');
  assert.equal(keyValue([['Name', 'Ada'], ['Skip', undefined], ['Empty', null]]), 'Name:  Ada\nEmpty: -');
});

test('yaml emitter handles nesting, lists and quoting', () => {
  const yaml = toYaml({
    name: 'Ada',
    count: 3,
    on: true,
    none: null,
    empty: [],
    obj: {},
    tricky: ['yes', '123', 'a: b', '', '#x', '@me', 'line\nbreak', '- x'],
    members: [{ id: 'a', role: 'admin' }, { id: 'b', tags: ['x'] }],
  });
  assert.equal(yaml, [
    'name: Ada',
    'count: 3',
    '"on": true',
    'none: null',
    'empty: []',
    'obj: {}',
    'tricky:',
    '- "yes"',
    '- "123"',
    '- "a: b"',
    '- ""',
    '- "#x"',
    '- "@me"',
    '- "line\\nbreak"',
    '- "- x"',
    'members:',
    '- id: a',
    '  role: admin',
    '- id: b',
    '  tags:',
    '  - x',
  ].join('\n'));
});

test('yaml scalars and empty roots', () => {
  assert.equal(toYaml([]), '[]');
  assert.equal(toYaml({}), '{}');
  assert.equal(toYaml('x'), 'x');
  assert.equal(toYaml({ email: 'a@b.com', url: 'https://x.y/z' }), 'email: a@b.com\nurl: https://x.y/z');
});

test('json output is indented', () => {
  assert.equal(toJson({ a: 1 }), '{\n  "a": 1\n}');
});
