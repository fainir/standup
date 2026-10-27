// standup - generate a standup from git activity.
// Public API:
//   runStandup({ since, noLlm, repos, warn }) -> { yesterday, today, blocked, raw }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const exec = promisify(execFile);

const MODEL = 'claude-haiku-5-5';

export async function runStandup({ since, noLlm = false, repos, warn = defaultWarn } = {}) {
  if (!repos?.length) repos = (await loadConfig()).repos;
  const targetRepos = (repos?.length ? repos : [process.cwd()]).map(expandHome);
  const windowStart = since || startOfLastWorkday(new Date()).toISOString();

  const all = [];
  const failed = [];
  for (const repo of targetRepos) {
    try {
      all.push(...await gitLog(repo, windowStart));
    } catch (e) {
      failed.push(`${repo}: ${e.message}`);
    }
  }
  if (failed.length === targetRepos.length) throw new Error(failed.join('\n'));
  for (const f of failed) warn(`skipping ${f}`);

  const raw = all.sort((a, b) => b.ts - a.ts).slice(0, 50);

  if (noLlm || !process.env.ANTHROPIC_API_KEY || !raw.length) {
    return localSummary(raw);
  }

  return await llmSummary(raw, warn);
}

// Midnight at the start of the previous weekday, so Monday's standup covers Friday.
export function startOfLastWorkday(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

async function gitLog(repo, since) {
  const { stdout: top } = await git(repo, ['rev-parse', '--show-toplevel']);
  const email = await authorEmail(repo);
  if (!email) {
    throw new Error('git user.email is not set, so your commits cannot be told apart (git config --global user.email you@example.com)');
  }
  const { stdout } = await git(repo, [
    'log',
    '--branches', '--remotes', // all branches, not just the checked-out one
    '--no-merges',
    `--since=${since}`,
    '--fixed-strings', '--regexp-ignore-case', `--author=<${email}>`,
    '--pretty=format:%H|%aI|%s',
  ]);
  if (!stdout.trim()) return [];
  const name = path.basename(top.trim());
  return stdout.trim().split('\n').map(line => {
    const [hash, iso, ...rest] = line.split('|');
    return { hash, ts: new Date(iso).getTime(), iso, subject: rest.join('|'), repo: name };
  });
}

async function authorEmail(repo) {
  try {
    const { stdout } = await git(repo, ['config', 'user.email']);
    return stdout.trim();
  } catch { return ''; }
}

async function git(repo, args) {
  try {
    return await exec('git', ['-C', repo, ...args], { maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('git is not installed or not on PATH');
    const first = (e.stderr || '').trim().split('\n')[0].replace(/^fatal: /, '');
    throw new Error(first || e.message);
  }
}

// Commits before today's midnight go under "yesterday", the rest under "today".
export function localSummary(commits, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const earlier = commits.filter(c => c.ts < midnight);
  const today = commits.filter(c => c.ts >= midnight);

  const summarize = list => {
    if (!list.length) return '(no commits)';
    const shown = list.slice(0, 5).map(c => `${c.repo}: ${c.subject}`);
    if (list.length > 5) shown.push(`+${list.length - 5} more`);
    return shown.join('; ');
  };

  return {
    yesterday: summarize(earlier),
    today: today.length ? summarize(today) : 'continue yesterday\'s work',
    blocked: null,
    raw: commits,
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    yesterday: { type: 'string' },
    today: { type: 'string' },
    blocked: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['yesterday', 'today', 'blocked'],
  additionalProperties: false,
};

async function llmSummary(commits, warn) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Summarize the following git commits into a standup update. Output STRICT JSON.
Schema: {"yesterday": string, "today": string, "blocked": string|null}.

Today is ${new Date().toDateString()}.
Yesterday = what was completed before today (one sentence, comma-separated).
Today = the most likely focus for today (one sentence).
Blocked = anything that looks like a blocker in commit messages (or null).

Commits (most recent first):
${commits.map(c => `${c.iso} [${c.repo}] ${c.subject}`).join('\n')}`;

  let r;
  try {
    r = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    warn(`Claude summary failed (${e.message}), showing the local summary instead`);
    return localSummary(commits);
  }

  const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const j = parseSummary(text);
  if (!j) {
    warn(`Claude returned an unusable summary (stop_reason: ${r.stop_reason}), showing the local summary instead`);
    return localSummary(commits);
  }
  return { ...j, raw: commits };
}

function parseSummary(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let j;
  try { j = JSON.parse(body); } catch { return null; }
  if (typeof j?.yesterday !== 'string' || typeof j.today !== 'string') return null;
  return { yesterday: j.yesterday, today: j.today, blocked: j.blocked || null };
}

function expandHome(p) {
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

async function loadConfig() {
  const p = path.join(os.homedir(), '.standup', 'config.json');
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${e.message}`);
  }
  const repos = cfg?.repos;
  if (repos !== undefined && !(Array.isArray(repos) && repos.every(r => typeof r === 'string'))) {
    throw new Error(`${p}: "repos" must be an array of directory paths`);
  }
  return cfg || {};
}

function defaultWarn(msg) {
  console.error(`standup: ${msg}`);
}
