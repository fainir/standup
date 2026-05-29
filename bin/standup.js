#!/usr/bin/env node
import { runStandup } from '../src/index.js';

const args = parseArgs(process.argv.slice(2));
try {
  const out = await runStandup(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(formatHuman(out));
    if (args.copy) await copyToClipboard(formatHuman(out));
  }
} catch (e) {
  console.error('standup failed:', e.message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { since: 'yesterday', json: false, copy: false, noLlm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') out.since = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--copy') out.copy = true;
    else if (a === '--no-llm') out.noLlm = true;
    else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  }
  return out;
}

function help() {
  console.log(`Usage: standup [options]
  --since <when>   git --since value (default: yesterday)
  --json           emit JSON instead of formatted text
  --copy           copy result to clipboard (macOS)
  --no-llm         skip LLM summarization (print raw activity)
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
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('pbcopy failed')));
    p.stdin.end(text);
  });
}
