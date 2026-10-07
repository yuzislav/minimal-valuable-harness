import test from 'node:test';
import assert from 'node:assert/strict';
import { OutputParser } from '../src/harness/parsers/OutputParser';
import { JsonOutputParser } from '../src/harness/parsers/JsonOutputParser';

test('XML parser: parses a call with arguments and unescapes entities', () => {
  const r = new OutputParser().parseToolCalls('Sure.\n<tool_call><name>echo</name><arguments><text>a &lt;b&gt; &amp; c</text></arguments></tool_call>');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.calls, [{ name: 'echo', args: { text: 'a <b> & c' } }]);
});

test('XML parser: plain text yields no calls and no errors', () => {
  assert.deepEqual(new OutputParser().parseToolCalls('Just an answer.'), { calls: [], errors: [] });
});

test('XML parser: parallel calls keep order', () => {
  const r = new OutputParser().parseToolCalls(
    '<tool_call><name>a</name></tool_call><tool_call><name>b</name><arguments><x>1</x></arguments></tool_call>');
  assert.deepEqual(r.calls.map(c => c.name), ['a', 'b']);
  assert.deepEqual(r.calls[1].args, { x: '1' });
});

test('XML parser: reports missing name, unclosed tag and bad arguments format', () => {
  const p = new OutputParser();
  assert.match(p.parseToolCalls('<tool_call><arguments><a>1</a></arguments></tool_call>').errors[0], /Missing or invalid <name>/);
  assert.match(p.parseToolCalls('<tool_call><name>x</name>').errors.join('\n'), /unclosed or mismatched/);
  assert.match(p.parseToolCalls('<tool_call><name>x</name><arguments>plain</arguments></tool_call>').errors[0], /Invalid arguments format/);
});

test('XML parser: invalid JSON-looking argument is reported', () => {
  const r = new OutputParser().parseToolCalls('<tool_call><name>x</name><arguments><o>{bad}</o></arguments></tool_call>');
  assert.match(r.errors[0], /looks like JSON but is invalid/);
});

test('F18: argument containing HTML tags is not a nested-XML error', { todo: 'F18 open' }, () => {
  const r = new OutputParser().parseToolCalls('<tool_call><name>exec</name><arguments><code>console.log("<b>hi</b>")</code></arguments></tool_call>');
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.errors, []);
});

test('F18: prose quoting the <tool_call> syntax is not executed', { todo: 'F18 open' }, () => {
  const r = new OutputParser().parseToolCalls('To call a tool write <tool_call><name>weather</name></tool_call> in your reply.');
  assert.equal(r.calls.length, 0);
});

test('F18: prose with an HTML <tool> element is not an error', { todo: 'F18 open' }, () => {
  assert.deepEqual(new OutputParser().parseToolCalls('Use the <tool>wrench</tool> element').errors, []);
});

test('JSON parser: parses a fenced array, a bare object and plain text', () => {
  const p = new JsonOutputParser();
  const fenced = p.parseToolCalls('```json\n[{"name":"weather","arguments":{"cityName":"Rome"}}]\n```');
  assert.deepEqual(fenced.calls, [{ name: 'weather', args: { cityName: 'Rome' } }]);
  assert.deepEqual(p.parseToolCalls('{"name":"a","arguments":{}}').calls, [{ name: 'a', args: {} }]);
  assert.deepEqual(p.parseToolCalls('Hello there.'), { calls: [], errors: [] });
});

test('JSON parser: invalid JSON in a fence is reported', () => {
  assert.match(new JsonOutputParser().parseToolCalls('```json\n[{oops}]\n```').errors[0], /Failed to parse JSON/);
});

test('F5: missing tool name uses the custom message', () => {
  const r = new JsonOutputParser().parseToolCalls('```json\n[{"arguments":{}}]\n```');
  assert.match(r.errors[0], /Missing 'name' property/);
});

test('F7: prose containing brackets is a plain answer', { todo: 'F7 open' }, () => {
  for (const text of ['The array [1, 2, 3] sums to 6.', 'See [the docs](https://x.y)', 'Config is {"a": 1}.']) {
    assert.deepEqual(new JsonOutputParser().parseToolCalls(text), { calls: [], errors: [] }, text);
  }
});

test('F7: the args alias is honoured', { todo: 'F7 open' }, () => {
  const r = new JsonOutputParser().parseToolCalls('```json\n[{"name":"weather","args":{"cityName":"Rome"}}]\n```');
  assert.deepEqual(r.calls, [{ name: 'weather', args: { cityName: 'Rome' } }]);
});

test('F7: every json fence is read, not only the first', { todo: 'F7 open' }, () => {
  const r = new JsonOutputParser().parseToolCalls('```json\n[{"name":"a"}]\n```\n```json\n[{"name":"b"}]\n```');
  assert.deepEqual(r.calls.map(c => c.name), ['a', 'b']);
});
