// standup - generate a standup from git activity.
// Public API:
//   runStandup({ since, noLlm, repos }) -> { yesterday, today, blocked, raw }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const exec = promisify(execFile);

export async function runStandup({ since = 'yesterday', noLlm = false, repos } = {}) {
  const cfg = await loadConfig();
  const targetRepos = repos || cfg.repos || [process.cwd()];

  const all = [];
  for (const repo of targetRepos) {
    try {
      const commits = await gitLog(repo, since);
      all.push(...commits.map(c => ({ ...c, repo: path.basename(repo) })));
    } catch (e) {
      // skip non-git or missing dirs
    }
  }

  const raw = all.sort((a, b) => b.ts - a.ts).slice(0, 50);

  if (noLlm || !process.env.ANTHROPIC_API_KEY) {
    return localSummary(raw);
  }

  return await llmSummary(raw);
}

async function gitLog(repo, since) {
  const { stdout } = await exec('git', [
    '-C', repo,
    'log',
    `--since=${since}`,
    '--pretty=format:%H|%aI|%s',
    '--author=' + (await currentAuthor()),
  ], { maxBuffer: 4 * 1024 * 1024 });
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [hash, iso, ...rest] = line.split('|');
    return { hash, ts: new Date(iso).getTime(), iso, subject: rest.join('|') };
  });
}

async function currentAuthor() {
  try {
    const { stdout } = await exec('git', ['config', 'user.email']);
    return stdout.trim();
  } catch { return ''; }
}

function localSummary(commits) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const isSameDay = (a, b) => a.toDateString() === b.toDateString();

  const yest = commits.filter(c => isSameDay(new Date(c.ts), yesterday));
  const tod  = commits.filter(c => isSameDay(new Date(c.ts), today));

  const summarize = list => list.length
    ? list.slice(0, 5).map(c => `${c.repo}: ${c.subject}`).join('; ')
    : '(no commits)';

  return {
    yesterday: summarize(yest),
    today: summarize(tod) === '(no commits)' ? 'continue yesterday\'s work' : summarize(tod),
    blocked: null,
    raw: commits,
  };
}

async function llmSummary(commits) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Summarize the following git commits into a standup update. Output STRICT JSON.
Schema: {"yesterday": string, "today": string, "blocked": string|null}.

Yesterday = what was completed yesterday (one sentence, comma-separated).
Today = the most likely focus for today (one sentence).
Blocked = anything that looks like a blocker in commit messages (or null).

Commits (most recent first):
${commits.map(c => `${c.iso} [${c.repo}] ${c.subject}`).join('\n')}`;

  const r = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = r.content.map(c => c.text || '').join('').trim();
  try {
    const j = JSON.parse(text);
    return { ...j, raw: commits };
  } catch {
    return localSummary(commits);
  }
}

async function loadConfig() {
  const p = path.join(os.homedir(), '.standup', 'config.json');
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
}
