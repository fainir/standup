import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { home, ME, exec, mkRepo, mkTempDir, commit, hoursAfter, subjects, writeGlobalConfig } from './helpers.js';
import { runStandup, startOfLastWorkday, localSummary } from '../src/index.js';

const now = new Date();
const lastWorkday = startOfLastWorkday(now);
const DAY = 24;

test('startOfLastWorkday is midnight of the previous weekday', () => {
  const cases = [
    ['2026-10-26T09:30:00', '2026-10-23T00:00:00'], // Mon -> Fri
    ['2026-10-27T00:05:00', '2026-10-26T00:00:00'], // Tue -> Mon
    ['2026-10-30T23:59:00', '2026-10-29T00:00:00'], // Fri -> Thu
    ['2026-10-31T12:00:00', '2026-10-30T00:00:00'], // Sat -> Fri
    ['2026-11-01T12:00:00', '2026-10-30T00:00:00'], // Sun -> Fri
  ];
  for (const [input, expected] of cases) {
    assert.equal(startOfLastWorkday(new Date(input)).getTime(), new Date(expected).getTime(), input);
  }
});

test('default window covers the whole last working day, split into yesterday and today', async () => {
  const dir = await mkRepo();
  await commit(dir, 'too old', { date: hoursAfter(lastWorkday, -1) });
  await commit(dir, 'early on the last working day', { date: hoursAfter(lastWorkday, 0.5) });
  await commit(dir, 'shipped today');

  const out = await runStandup({ noLlm: true, repos: [dir] });

  assert.deepEqual(subjects(out), ['shipped today', 'early on the last working day']);
  assert.equal(out.yesterday, `${path.basename(dir)}: early on the last working day`);
  assert.equal(out.today, `${path.basename(dir)}: shipped today`);
  assert.equal(out.blocked, null);
});

test('a custom --since window shows older commits under yesterday', async () => {
  const dir = await mkRepo({ name: 'api' });
  await commit(dir, 'three days ago', { date: hoursAfter(now, -3 * DAY) });

  const out = await runStandup({ since: '4 days ago', noLlm: true, repos: [dir] });

  assert.equal(out.yesterday, 'api: three days ago');
  assert.equal(out.today, "continue yesterday's work");
});

test('only commits whose author email is exactly yours are included', async () => {
  const dir = await mkRepo();
  await commit(dir, 'mine');
  await commit(dir, 'teammate', { email: 'other@example.com' });
  await commit(dir, 'lookalike', { email: `not${ME}` });
  await commit(dir, 'mine, different case', { email: ME.toUpperCase() });

  const out = await runStandup({ noLlm: true, repos: [dir] });

  assert.deepEqual(subjects(out).sort(), ['mine', 'mine, different case']);
});

test("uses each repo's own user.email, not the one from the current directory", async () => {
  const dir = await mkRepo({ email: 'work@example.com' });
  await commit(dir, 'work commit');
  await commit(dir, 'global identity commit', { email: ME });

  const out = await runStandup({ noLlm: true, repos: [dir] });

  assert.deepEqual(subjects(out), ['work commit']);
});

test('fails clearly when git user.email is not set instead of listing everyone', async () => {
  const dir = await mkRepo();
  await commit(dir, 'someone', { email: 'someone@example.com' });
  await writeGlobalConfig(null);
  try {
    await assert.rejects(runStandup({ noLlm: true, repos: [dir] }), /user\.email is not set/);
  } finally {
    await writeGlobalConfig(ME);
  }
});

test('includes commits on other branches and skips merge commits', async () => {
  const dir = await mkRepo();
  await commit(dir, 'on main');
  await exec('git', ['-C', dir, 'checkout', '-q', '-b', 'feature']);
  await commit(dir, 'on feature branch');
  await exec('git', ['-C', dir, 'checkout', '-q', 'main']);
  await exec('git', ['-C', dir, 'checkout', '-q', '-b', 'topic']);
  await commit(dir, 'on topic branch');
  await exec('git', ['-C', dir, 'checkout', '-q', 'main']);
  await exec('git', ['-C', dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'topic'", 'topic']);

  const out = await runStandup({ noLlm: true, repos: [dir] });

  assert.deepEqual(subjects(out).sort(), ['on feature branch', 'on main', 'on topic branch']);
});

test('labels commits with the repo name even when run from a subdirectory', async () => {
  const dir = await mkRepo({ name: 'web' });
  await fs.mkdir(path.join(dir, 'src'));
  await commit(dir, 'hello');

  const out = await runStandup({ noLlm: true, repos: [path.join(dir, 'src')] });

  assert.equal(out.raw[0].repo, 'web');
});

test('handles a repo with no commits yet', async () => {
  const dir = await mkRepo();
  const out = await runStandup({ noLlm: true, repos: [dir] });
  assert.deepEqual(out.raw, []);
  assert.equal(out.yesterday, '(no commits)');
});

test('errors when the only directory is not a git repo', async () => {
  const dir = await mkTempDir();
  await assert.rejects(runStandup({ noLlm: true, repos: [dir] }), /not a git repository/);
  await assert.rejects(runStandup({ noLlm: true, repos: [path.join(dir, 'missing')] }), /No such file or directory/);
});

test('reads several repos and warns about the ones it cannot read', async () => {
  const a = await mkRepo({ name: 'alpha' });
  const b = await mkRepo({ name: 'beta' });
  const notRepo = await mkTempDir();
  await commit(a, 'alpha work', { date: hoursAfter(now, -2) });
  await commit(b, 'beta work', { date: hoursAfter(now, -1) });

  const warnings = [];
  const out = await runStandup({ noLlm: true, repos: [a, notRepo, b], warn: m => warnings.push(m) });

  assert.deepEqual(out.raw.map(c => `${c.repo}: ${c.subject}`), ['beta: beta work', 'alpha: alpha work']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /skipping .*not a git repository/);
});

test('reads repos from ~/.standup/config.json and expands ~', async () => {
  const a = path.join(home, 'code', 'from-tilde');
  await fs.mkdir(a, { recursive: true });
  await exec('git', ['-C', a, 'init', '-q']);
  await commit(a, 'tilde repo work');
  const b = await mkRepo({ name: 'absolute' });
  await commit(b, 'absolute repo work');
  await fs.mkdir(path.join(home, '.standup'), { recursive: true });
  const cfgPath = path.join(home, '.standup', 'config.json');
  await fs.writeFile(cfgPath, JSON.stringify({ repos: ['~/code/from-tilde', b] }));
  try {
    const out = await runStandup({ noLlm: true });
    assert.deepEqual(out.raw.map(c => c.repo).sort(), ['absolute', 'from-tilde']);
  } finally {
    await fs.rm(cfgPath);
  }
});

test('reports a broken config file instead of ignoring it', async () => {
  await fs.mkdir(path.join(home, '.standup'), { recursive: true });
  const cfgPath = path.join(home, '.standup', 'config.json');
  try {
    await fs.writeFile(cfgPath, '{"repos": ["~/a",]}');
    await assert.rejects(runStandup({ noLlm: true }), /config\.json is not valid JSON/);
    await fs.writeFile(cfgPath, '{"repos": "~/a"}');
    await assert.rejects(runStandup({ noLlm: true }), /"repos" must be an array/);
  } finally {
    await fs.rm(cfgPath);
  }
});

test('localSummary shows at most five commits per line and counts the rest', () => {
  const midnight = new Date(2026, 9, 27);
  const at = h => ({ repo: 'r', subject: `c${h}`, ts: hoursAfter(midnight, h).getTime() });
  const commits = [at(10), at(9), at(8), at(7), at(6), at(5), at(4), at(-2)];

  const out = localSummary(commits, hoursAfter(midnight, 12));

  assert.equal(out.today, 'r: c10; r: c9; r: c8; r: c7; r: c6; +2 more');
  assert.equal(out.yesterday, 'r: c-2');
});
