import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStandup } from '../src/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const exec = promisify(execFile);

async function mkTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'standup-test-'));
  await exec('git', ['-C', dir, 'init', '-q']);
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await exec('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'first commit, shipped X']);
  await exec('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'second commit, fixed Y']);
  return dir;
}

test('runStandup with --no-llm summarizes git activity locally', async () => {
  const dir = await mkTempRepo();
  // Spoof author so we don't depend on host git config
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

  // The author lookup uses the current process's git config; override by passing repos
  // but our log filter uses author. We'll just pass a wide enough since to get them.
  const out = await runStandup({ since: '1 week ago', noLlm: true, repos: [dir] });

  assert.ok(out.yesterday);
  assert.ok(out.today);
  assert.ok(Array.isArray(out.raw));
  await fs.rm(dir, { recursive: true, force: true });
});

test('runStandup handles empty repo gracefully', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'standup-empty-'));
  await exec('git', ['-C', dir, 'init', '-q']);
  const out = await runStandup({ since: 'yesterday', noLlm: true, repos: [dir] });
  assert.equal(out.raw.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
