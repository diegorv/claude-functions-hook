# claude-function-hooks

Function hooks for Claude Code, packaged as a plugin marketplace. Function
hooks are early access: TypeScript modules that run inside the session,
behind the `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` flag. The API may change
between releases.

| Plugin | What it does |
| --- | --- |
| [time](plugins/time) | The time you sent each message, drawn above it |
| [gh-ci-status](plugins/gh-ci-status) | GitHub Actions runs of the session's repo, pinned above the prompt, with links to the PR and the run |

## gh-ci-status

```
⚙ owner/repo · Actions · 1 running · 2 finished
#167  ◐ Running    PR       0m37s  chore(ci): smoke-test PR
main  ● Success    Deploy   2m15s  Release 1.4.0
```

- Finds the repo through the `origin` remote with `gh`, so `gh` must be on
  your `PATH` and logged in. Without a GitHub remote it stays quiet.
- Polls `gh run list` every 60 s, and every 15 s while a run is in flight.
  A `git push`, `gh pr merge` or `gh workflow run` in Bash wakes it.
- `#N` links to the PR (matched by branch through `gh pr list`, or from
  `refs/pull/N/head`); the workflow name links to the run.
- Toasts when a run starts or finishes. A finished run stays for 5 minutes.

## Use

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-function-hooks/plugins
```

Edits to a hook module reload without restarting the session.

## Develop

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc per plugin
npm run format     # prettier
npm run validate   # claude plugin validate
```

The API's type declarations (`.claude/types/`) are not in git. Generate them
with `/plugin-types` in a Claude Code session at the root of this repo, and
regenerate after updating Claude Code.

## Plugin layout

```
plugins/gh-ci-status/
  .claude-plugin/plugin.json   manifest
  hooks/hooks.json             points at the entry module
  src/core/                    the run model and the text derived from it, no I/O
  src/utils/                   generic helpers (text)
  src/app/                     use cases (the poller), dependencies injected
  src/infra/                   external clients (GitHub through gh)
  src/components/              the band's view model and its JSX
  src/hooks/                   the wiring to the engine
  *.test.ts                    next to the file it tests, run on Node
```
