import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { jsonSchemaToZod } from '../src/harness/utils/zodSchema';
import { buildSystemPrompt } from '../src/harness/utils/promptBuilder';
import { loadSkills, createReadSkillTool } from '../src/harness/skills';
import { Tool } from '../src/harness/types';
import { quiet, echoTool } from './helpers';

test('jsonSchemaToZod: coerces numeric and boolean strings', () => {
  const s = jsonSchemaToZod({ type: 'object', properties: { n: { type: 'number' }, b: { type: 'boolean' }, i: { type: 'integer' } }, required: ['n', 'b'] });
  assert.deepEqual(s.parse({ n: '2.5', b: 'TRUE', i: '3' }), { n: 2.5, b: true, i: 3 });
  assert.equal(s.safeParse({ n: 'abc', b: 'true' }).success, false);
});

test('jsonSchemaToZod: required vs optional properties', () => {
  const s = jsonSchemaToZod({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] });
  assert.equal(s.safeParse({ a: 'x' }).success, true);
  const bad = s.safeParse({ b: 'x' });
  assert.equal(bad.success, false);
});

test('jsonSchemaToZod: JSON-encoded arrays and objects are parsed', () => {
  const arr = jsonSchemaToZod({ type: 'array', items: { type: 'number' } });
  assert.deepEqual(arr.parse('[1,"2"]'), [1, 2]);
  const obj = jsonSchemaToZod({ type: 'object' });
  assert.deepEqual(obj.parse('{"k":1}'), { k: 1 });
});

test('jsonSchemaToZod: missing schema or unknown type accepts anything', () => {
  assert.equal(jsonSchemaToZod(undefined).safeParse(42).success, true);
  assert.equal(jsonSchemaToZod({ type: 'weird' }).safeParse({}).success, true);
});

test('F18: enum values are enforced', { todo: 'F18 open' }, () => {
  assert.equal(jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] }).safeParse('zzz').success, false);
});

test('F18: optional properties accept explicit null', { todo: 'F18 open' }, () => {
  const s = jsonSchemaToZod({ type: 'object', properties: { a: { type: 'string' } } });
  assert.equal(s.safeParse({ a: null }).success, true);
});

const tool = (description: string, extra: Partial<Tool> = {}): Tool => ({ ...echoTool(), description, ...extra });

test('buildSystemPrompt: fills tools (xml), skills and date', () => {
  const p = buildSystemPrompt('D={current_date}\nS:\n{available_skills}\nT:\n{available_tools}', [{ name: 'sk', description: 'a skill', content: '' }], [echoTool()], 'xml');
  assert.match(p, /D=\d{4}-\d{2}-\d{2}T/);
  assert.match(p, /- sk: a skill/);
  assert.match(p, /<name>echo<\/name>/);
  assert.match(p, /<parameter name="text" type="string">text<\/parameter>/);
});

test('buildSystemPrompt: json format lists tools as JSON', () => {
  const p = buildSystemPrompt('{available_tools}', [], [echoTool()], 'json');
  assert.equal(JSON.parse(p)[0].name, 'echo');
});

test('buildSystemPrompt: empty tools/skills leave empty sections', () => {
  assert.equal(buildSystemPrompt('[{available_tools}][{available_skills}]', [], []), '[][]');
});

test('F17: "$&" in a tool description stays literal', () => {
  const p = buildSystemPrompt('TOOLS:\n{available_tools}', [], [tool('Cost $& each')]);
  assert.match(p, /<description>Cost \$& each<\/description>/);
});

test('F17: placeholder text inside a description is not re-expanded', () => {
  const p = buildSystemPrompt('{available_tools}|{available_skills}', [{ name: 's', description: 'x', content: '' }], [tool('see {available_skills}')]);
  assert.match(p, /see \{available_skills\}/);
});

async function withSkillsDir<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mvh-skills-'));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadSkills: loads a valid skill and strips frontmatter', async () => {
  await withSkillsDir({ 'ok.md': '---\nname: ok\ndescription: fine\n---\nBody here\n', 'ignore.txt': 'x' }, async dir => {
    const skills = await loadSkills(dir);
    assert.deepEqual(skills, [{ name: 'ok', description: 'fine', content: 'Body here\n' }]);
  });
});

test('loadSkills: missing directory yields no skills', async () => {
  assert.deepEqual(await loadSkills('/nonexistent/mvh-skills-dir'), []);
});

test('F15: CRLF files and files without frontmatter are loaded', async () => {
  await withSkillsDir({
    'crlf.md': '---\r\nname: crlf\r\ndescription: windows\r\n---\r\nBody\r\n',
    'nofm.md': '# Plain skill\nSome text\n',
    'ok.md': '---\nname: ok\ndescription: fine\n---\nBody\n',
  }, async dir => {
    const skills = await loadSkills(dir);
    assert.deepEqual(skills.map(s => s.name).sort(), ['crlf', 'nofm', 'ok']);
    const crlf = skills.find(s => s.name === 'crlf')!;
    assert.equal(crlf.description, 'windows');
    assert.ok(!crlf.content.includes('\r'));
  });
});

test('loadSkills: frontmatter without description is skipped with a warning', async () => {
  await withSkillsDir({ 'bad.md': '---\nname: bad\n---\nBody\n' }, async dir => {
    const warnings: string[] = [];
    const saved = console.warn;
    console.warn = (...a: any[]) => { warnings.push(a.join(' ')); };
    try { assert.deepEqual(await loadSkills(dir), []); } finally { console.warn = saved; }
    assert.match(warnings[0], /bad\.md/);
  });
});

test('F15: duplicate skill names are rejected', { todo: 'F15 duplicate-name check open' }, async () => {
  await withSkillsDir({
    'a.md': '---\nname: same\ndescription: one\n---\nA\n',
    'b.md': '---\nname: same\ndescription: two\n---\nB\n',
  }, async dir => {
    const skills = await quiet(() => loadSkills(dir));
    assert.equal(skills.filter(s => s.name === 'same').length, 1);
  });
});

test('read_skill tool returns content and throws on unknown skill', async () => {
  const t = createReadSkillTool([{ name: 's', description: 'd', content: 'CONTENT' }]);
  assert.deepEqual(await t.execute({ skill_name: 's' }), { content: 'CONTENT' });
  await assert.rejects(() => t.execute({ skill_name: 'nope' }), /not found/);
});
