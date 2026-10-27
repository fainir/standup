#!/usr/bin/env node
import { runStandup } from '../src/index.js';

const args = parseArgs(process.argv.slice(2));
try {
  const out = await runStandup(args);
  const text = args.json ? JSON.stringify(out, null, 2) : formatHuman(out);
  console.log(text);
  if (args.copy) await copyToClipboard(text);
} catch (e) {
  console.error('standup failed:', e.message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { since: undefined, json: false, copy: false, noLlm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since' || a.startsWith('--since=')) {
      out.since = a === '--since' ? argv[++i] : a.slice('--since='.length);
      if (!out.since || out.since.startsWith('-')) usageError('--since needs a value, e.g. --since "3 days ago"');
    }
    else if (a === '--json') out.json = true;
    else if (a === '--copy') out.copy = true;
    else if (a === '--no-llm') out.noLlm = true;
    else if (a === '-h' || a === '--help') { help(); process.exit(0); }
    else usageError(`unknown option: ${a}`);
  }
  return out;
}

function usageError(msg) {
  console.error(`standup: ${msg}\nRun "standup --help" for usage.`);
  process.exit(2);
}

function help() {
  console.log(`Usage: standup [options]

Lists your commits (matched by git user.email) on every branch since the start
of the last working day, split into Yesterday and Today.

  --since <when>   start of the window, any git date such as "3 days ago"
                   (default: start of the last working day; Friday on Mondays)
  --json           emit JSON instead of formatted text
  --copy           also copy the output to the clipboard (macOS, uses pbcopy)
  --no-llm         don't summarize with Claude even if ANTHROPIC_API_KEY is set
  -h, --help       show help`);
}

function formatHuman(out) {
  const lines = [];
  lines.push(`Yesterday: ${out.yesterday}`);
  lines.push(`Today: ${out.today}`);
  if (out.blocked) lines.push(`Blocked: ${out.blocked}`);
  return lines.join('\n');
}

async function copyToClipboard(text) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const p = spawn('pbcopy');
    p.on('error', e => reject(e.code === 'ENOENT' ? new Error('--copy needs pbcopy, which only exists on macOS') : e));
    p.on('close', code => code === 0 ? resolve() : reject(new Error('pbcopy failed')));
    p.stdin.on('error', () => {}); // the 'error' handler above reports a missing pbcopy
    p.stdin.end(text);
  });
}
