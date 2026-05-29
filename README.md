# standup

Generate a standup update from your git commits and your editor activity. One command.

Free, MIT, by [Cosfounder](https://cosfounder.com).

## Why

You shouldn't have to remember what you did yesterday. `git log` does. Your editor knows what files you touched. This tool just stitches the two together into a 3-line standup.

```bash
$ standup
Yesterday: shipped invoice-update agent (#142), pair-debugged Stripe webhook retry, reviewed Maya's onboarding copy
Today: investor-update voice corpus pass, prep for 1:1s
Blocked: waiting on Mercury API access for the cap-table sync
```

Paste into Slack. Move on.

## Install

```bash
npm install -g @cosfounder/standup
```

Or run without install:

```bash
npx @cosfounder/standup
```

## Use

In any git repo:

```bash
standup                          # yesterday + today + blocked
standup --since "3 days ago"     # custom window
standup --json                   # structured output for piping
standup --copy                   # copy to clipboard (macOS)
```

## How it works

1. Pulls your commits across configured repos in the window
2. Pulls editor activity (VS Code recents, file modification times)
3. Asks an LLM (configurable: Claude, GPT, local Ollama) to summarize
4. Outputs the 3-line standup

If no LLM is configured, prints the raw commit/activity list. You write the summary.

## Config

`~/.standup/config.json`:

```json
{
  "repos": ["~/code/cosfounder", "~/code/recall"],
  "llm": { "provider": "anthropic", "model": "claude-haiku-4-7" },
  "format": "yesterday-today-blocked",
  "include_editor_activity": true
}
```

API key: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env.

## Privacy

Nothing leaves your machine unless you configure an LLM provider, in which case only the summarized commit messages are sent (not file contents). Local-only mode (`--no-llm`) is fully offline.

## Roadmap

- Slack integration (post the standup directly)
- Linear / GitHub PR linking
- Multi-day standup roll-ups (weekly summary)
- Team mode: roll up a team's individual standups into a manager view

## Why we're shipping a free tool

Two reasons. One, every developer should have this; it's a 4-hour build that saves everyone 5 minutes a day. Two, if you like this, you might like [Cosfounder](https://cosfounder.com) - the AI Chief of Staff for founders that does the same thing for your whole operating loop.

## License

MIT. See LICENSE.
