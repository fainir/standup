# standup

[![CI](https://github.com/fainir/standup/actions/workflows/ci.yml/badge.svg)](https://github.com/fainir/standup/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A one-command CLI that turns your recent git commits into a Yesterday / Today standup update, for developers who post a daily standup.

You shouldn't have to remember what you did yesterday. `git log` does. `standup` reads your own commits on every branch of one or more repos, starting from the last working day (Friday, when it is Monday), and prints two lines you can paste into Slack. If you have an Anthropic API key, Claude rewrites them into sentences and points out blockers.

## Quick start

Needs Node.js 20+ and git. Run it inside any repo:

```bash
npx @fainir/standup
```

Or install the `standup` command:

```bash
npm install -g @fainir/standup
standup
```

> If `ANTHROPIC_API_KEY` is set in your shell, your commit subjects are sent to the Claude API to be summarized. Add `--no-llm` to keep everything on your machine.

## Usage

All output below is real, from two demo repos on a Tuesday. They contain a commit on an unmerged `invoice-export` branch (included), plus a teammate's commit and a merge commit (both left out).

```console
$ cd ~/code/api
$ standup
Yesterday: api: Add CSV export for invoices; api: Add retry with backoff to Stripe webhook handler; api: Fix N+1 query in GET /invoices
Today: api: Bump Node to 22 in Dockerfile
```

Pick your own window with any date git understands:

```console
$ standup --since "last friday midnight"
Yesterday: api: Add CSV export for invoices; api: Add retry with backoff to Stripe webhook handler; api: Fix N+1 query in GET /invoices; api: Write migration for invoice status enum
Today: api: Bump Node to 22 in Dockerfile
```

Get JSON for scripts (trimmed to the first commit here):

```console
$ standup --json
{
  "yesterday": "api: Add CSV export for invoices; api: Add retry with backoff to Stripe webhook handler; api: Fix N+1 query in GET /invoices",
  "today": "api: Bump Node to 22 in Dockerfile",
  "blocked": null,
  "raw": [
    {
      "hash": "0c6f4193941bbafcada19fc6b5e0111509e7e1db",
      "ts": 1793111100000,
      "iso": "2026-10-27T16:25:00+02:00",
      "subject": "Bump Node to 22 in Dockerfile",
      "repo": "api"
    },
    ...
  ]
}
```

Several repos at once, from any directory (see [Configuration](#configuration)):

```console
$ cat ~/.standup/config.json
{
  "repos": ["~/code/api", "~/code/web"]
}
$ standup
Yesterday: api: Add CSV export for invoices; api: Add retry with backoff to Stripe webhook handler; web: Redesign onboarding checklist; api: Fix N+1 query in GET /invoices
Today: api: Bump Node to 22 in Dockerfile; web: Fix flaky login e2e test
```

Outside a repo it tells you, and exits with status 1:

```console
$ cd /tmp && standup
standup failed: /private/tmp: not a git repository (or any of the parent directories): .git
```

Each line lists up to five commits, newest first, then `+N more`. With no commits today, the local summary says `Today: continue yesterday's work`.

### Options

| Option | What it does |
| --- | --- |
| `--since <when>` | Start of the window. Any git date: `"3 days ago"`, `"last friday midnight"`, `"2026-10-01 00:00"`. Default: midnight at the start of the last working day. |
| `--json` | Print JSON (`yesterday`, `today`, `blocked`, `raw` commits) instead of text. |
| `--copy` | Also copy the output to the clipboard. macOS only (uses `pbcopy`). |
| `--no-llm` | Don't call Claude, even if `ANTHROPIC_API_KEY` is set. |
| `-h`, `--help` | Show help. |

## Configuration

Optional file: `~/.standup/config.json`.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `repos` | array of paths | the current directory | Repos to read. `~` is expanded. Repos that can't be read are skipped with a warning on stderr; if none can be read, `standup` exits with an error. |

Environment variables:

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | When set (and `--no-llm` is not passed), the commits are summarized by Claude (`claude-haiku-5-5`) and a `Blocked:` line is printed if Claude spots a blocker. |
| `ANTHROPIC_BASE_URL` | Optional. Send Claude API requests to another endpoint, such as a proxy. |

## How it works

1. For each repo, reads your `git config user.email`, so an email set only in one repo is respected.
2. Runs `git log --branches --remotes --no-merges --since=<window>`, keeping commits whose author email is exactly yours (case-insensitive).
3. Keeps the newest 50 commits and splits them at local midnight: earlier ones go under Yesterday, the rest under Today.
4. If `ANTHROPIC_API_KEY` is set, sends the list (time, repo folder name, subject) to Claude and asks for `{ yesterday, today, blocked }` as JSON. If the call fails or the reply is unusable, it prints the local summary and a warning instead.

Nothing leaves your machine in local mode. With Claude, only commit times, repo folder names and subjects are sent: no diffs or file contents.

## Limitations and FAQ

- **My commits are missing.** Commits are matched by author email. Ones made with a different address (another machine, GitHub's web editor with a noreply email) won't show. Check with `git log --format='%ae' | sort -u`. Remote branches count only after a `git fetch`.
- **`--since "last friday"` misses Friday morning.** Git fills in a missing time with the current time of day. Add `midnight` or `00:00`.
- **It only knows commit subjects.** No editor activity, pull requests or issue trackers yet.
- **Claude is the only LLM.** It is used automatically when `ANTHROPIC_API_KEY` is set; there is no OpenAI or local model option.
- **`--copy` is macOS only.** On Linux, pipe into `xclip` or `wl-copy` instead.

## Roadmap

- Slack integration (post the standup directly)
- Linear / GitHub PR linking
- Multi-day standup roll-ups (weekly summary)
- Team mode: roll up a team's individual standups into a manager view
- Editor activity and other LLM providers (OpenAI, local Ollama)

## Development

```bash
git clone https://github.com/fainir/standup
cd standup
npm install
npm test
```

The tests build throwaway git repos with backdated commits, use their own `HOME` and git config, and talk to a fake Claude API on localhost, so they need no network and no API key.

## License

MIT. See [LICENSE](LICENSE).

---

### More open source by [Nir Feinstein](https://nirfeinste.in)

- [agent-harness](https://github.com/fainir/agent-harness) - make Claude Code or Codex act as a product team, a CEO or a portfolio manager
- [frugal](https://github.com/fainir/frugal) - your agent finds the cheaper honest way before it pays for anything
- [flipback](https://github.com/fainir/flipback) - an automatic `/goal` for every turn: sends Claude Code back when it stops early
- [recall](https://github.com/fainir/recall) - your Claude Code memory in every agent, over MCP
- [All projects](https://nirfeinste.in/#open-source)
