// The Claude path, against a fake Messages API on localhost (no network, no key).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkRepo, commit } from './helpers.js';
import { runStandup } from '../src/index.js';

const requests = [];
let reply; // (req body) -> [status, json]
let server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      const [status, json] = reply(parsed);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => {
  server.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

const message = text => [200, {
  id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}];

async function repoWithCommit() {
  const dir = await mkRepo({ name: 'api' });
  await commit(dir, 'add retry to webhook handler');
  return dir;
}

test('summarizes with Claude when ANTHROPIC_API_KEY is set', async () => {
  requests.length = 0;
  reply = () => message('{"yesterday": "Nothing", "today": "Webhook retries", "blocked": null}');
  const dir = await repoWithCommit();

  const out = await runStandup({ repos: [dir] });

  assert.deepEqual(
    { yesterday: out.yesterday, today: out.today, blocked: out.blocked },
    { yesterday: 'Nothing', today: 'Webhook retries', blocked: null },
  );
  assert.equal(out.raw.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/messages');
  const { authorization, 'x-api-key': apiKey } = requests[0].headers;
  assert.ok(apiKey === 'test-key' || authorization === 'Bearer test-key', 'sends the API key');
  assert.equal(requests[0].body.model, 'claude-haiku-5-5');
  assert.equal(requests[0].body.output_config.format.type, 'json_schema');
  assert.match(requests[0].body.messages[0].content, /\[api\] add retry to webhook handler/);
});

test('accepts a reply wrapped in a ```json fence', async () => {
  reply = () => message('```json\n{"yesterday": "a", "today": "b", "blocked": "waiting on API access"}\n```');
  const out = await runStandup({ repos: [await repoWithCommit()] });
  assert.equal(out.today, 'b');
  assert.equal(out.blocked, 'waiting on API access');
});

test('falls back to the local summary with a warning when the reply is unusable', async () => {
  reply = () => message('Sure! Here is your standup.');
  const warnings = [];
  const out = await runStandup({ repos: [await repoWithCommit()], warn: m => warnings.push(m) });
  assert.equal(out.today, 'api: add retry to webhook handler');
  assert.match(warnings.join('\n'), /unusable/);
});

test('falls back to the local summary with a warning when the API call fails', async () => {
  reply = () => [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }];
  const warnings = [];
  const out = await runStandup({ repos: [await repoWithCommit()], warn: m => warnings.push(m) });
  assert.equal(out.today, 'api: add retry to webhook handler');
  assert.match(warnings.join('\n'), /Claude summary failed.*invalid x-api-key/);
});

test('does not call the API when there are no commits or with noLlm', async () => {
  requests.length = 0;
  reply = () => message('{}');
  await runStandup({ repos: [await mkRepo()] });
  await runStandup({ repos: [await repoWithCommit()], noLlm: true });
  assert.equal(requests.length, 0);
});
