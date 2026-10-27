import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { exec, mkRepo, mkTempDir, commit } from './helpers.js';

const bin = fileURLToPath(new URL('../bin/standup.js', import.meta.url));

// Run the CLI and return { code, stdout, stderr } without throwing on failure.
async function run(args, cwd) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

test('prints a yesterday/today standup for the current repo', async () => {
  const dir = await mkRepo({ name: 'api' });
  await commit(dir, 'fix login redirect');

  const r = await run([], dir);

  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "Yesterday: (no commits)\nToday: api: fix login redirect\n");
});

test('--json and --since=<value> work', async () => {
  const dir = await mkRepo({ name: 'api' });
  await commit(dir, 'old work', { date: new Date(Date.now() - 5 * 86400e3) });

  const r = await run(['--json', '--since=6 days ago'], dir);

  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.yesterday, 'api: old work');
  assert.equal(out.raw[0].subject, 'old work');
});

test('--since without a value is a usage error', async () => {
  const dir = await mkRepo();
  for (const args of [['--since'], ['--since', '--json'], ['--since=']]) {
    const r = await run(args, dir);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, /--since needs a value/);
  }
});

test('unknown options are rejected', async () => {
  const dir = await mkRepo();
  const r = await run(['--sinse', '3 days ago'], dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option: --sinse/);
});

test('outside a git repo it says so and exits 1', async () => {
  const dir = await mkTempDir();
  const r = await run([], dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /standup failed: .*not a git repository/);
});

test('--help describes every option', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  for (const flag of ['--since', '--json', '--copy', '--no-llm', '--help']) {
    assert.ok(r.stdout.includes(flag), flag);
  }
});
