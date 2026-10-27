// Shared test setup: a throwaway HOME and global git config, so tests never
// read the developer's real ~/.gitconfig, ~/.standup/config.json or API key.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export const exec = promisify(execFile);

export const home = await fs.mkdtemp(path.join(os.tmpdir(), 'standup-home-'));
export const globalConfig = path.join(home, '.gitconfig');
export const ME = 'me@example.com';

process.env.HOME = home;
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_BASE_URL;
await writeGlobalConfig(ME);

export async function writeGlobalConfig(email) {
  const user = email ? `[user]\n\temail = ${email}\n\tname = Me\n` : '';
  await fs.writeFile(globalConfig, `${user}[init]\n\tdefaultBranch = main\n`);
}

export async function mkTempDir(prefix = 'standup-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function mkRepo({ name, email } = {}) {
  let dir = await mkTempDir();
  if (name) {
    dir = path.join(dir, name);
    await fs.mkdir(dir);
  }
  await exec('git', ['-C', dir, 'init', '-q']);
  if (email) await exec('git', ['-C', dir, 'config', 'user.email', email]);
  return dir;
}

// Commit with both author and committer date set to `date`.
export async function commit(dir, message, { date = new Date(), email } = {}) {
  const iso = date.toISOString();
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso };
  if (email) {
    Object.assign(env, {
      GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: email,
    });
  }
  await exec('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', message], { env });
}

export const hoursAfter = (date, hours) => new Date(date.getTime() + hours * 3600e3);

export const subjects = out => out.raw.map(c => c.subject);
