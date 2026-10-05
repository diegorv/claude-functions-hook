# claude-mods-diegorv

Claude Code mods, packaged as a plugin marketplace. A mod is a plugin whose
hooks module (TypeScript, here) runs inside the session. Mods need Claude Code
2.1.287 or later and are on by default.

| Plugin | What it does |
| --- | --- |
| [time](plugins/time) | The time you sent each message, drawn above it |
| [gh-ci-status](plugins/gh-ci-status) | GitHub Actions runs of the session's repo, pinned above the prompt, with links to the PR and the run |

## time

The time above a message is the one of its first drawing, which is when you
sent it, and it is kept per message, so a resize or a redraw does not move it.
A resumed session, or a reload of the plugin, draws the old messages with the
current time.

## gh-ci-status

```
⚙ owner/repo · Actions · 1 running · 1 finished
#167  ◐ Running    PR       0m37s  chore(ci): smoke-test PR
main  ● Success    Deploy   2m15s  Release 1.4.0
```

- Finds the repo the way `gh` does (`gh repo view`, the default remote), so
  `gh` must be on your `PATH` and logged in. Without a GitHub remote it logs
  one line and stays quiet. The check runs once, at session start, so a
  failure there, no network or an expired token, keeps it quiet for the
  whole session: after `gh auth login`, or once the network is back,
  restart the session (under `--plugin-dir`, editing any file of the plugin
  reloads it).
- Polls `gh run list` every 60 s, and every 15 s while a run is in flight or
  for 6 minutes after a push. A `git push`, `git subtree push`, `gh pr merge`,
  `gh workflow run` or `gh run rerun` in Bash wakes it.
- `#N` links to the PR (matched by branch through `gh pr list`, or from
  `refs/pull/N/head`); the workflow name links to the run.
- Shows runs from a push, a pull request, a manual dispatch, the merge
  queue, a release, or a workflow another one started, and leaves cron and
  issue bots out. Toasts when a run starts or finishes. A finished run stays
  for 5 minutes.

## Use

```bash
# mods need Claude Code 2.1.287 or later
claude --plugin-dir /path/to/claude-mods-diegorv/plugins
```

Or install them from the marketplace:

```
/plugin marketplace add diegorv/claude-mods-diegorv
/plugin install gh-ci-status@claude-mods-diegorv
/plugin install time@claude-mods-diegorv
```

The marketplace was renamed, and the install ids with it. If you installed
under the old name, run `/plugin marketplace remove claude-function-hooks`,
which also uninstalls its plugins, then the three lines above.

Tested with Claude Code 2.1.289; the API may still change between releases.
`/plugin` names the mods the session loaded, in a line such as
`1 mod active · time`. The old `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` flag is
ignored; remove it.

To turn one off, disable its plugin in the Installed tab of `/plugin`. To turn
off every installed mod, start the session with `--safe-mode`, which also
disables your other customizations, or, for every session, set
`"disableAllHooks": true` in `~/.claude/settings.json`, which also stops your
settings hooks and custom status line.

Under `--plugin-dir`, edits to a plugin's files reload it without restarting
the session.

## Develop

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc
npm run format     # prettier
npm run validate   # claude plugin validate
```

`claude plugin test` runs every `*.test.ts` in a plugin with the
`claude-code/testing` kit; these use `node:test`, so it is not used here.

The API's type declarations are not in git. Claude Code writes them to
`plugins/<name>/.claude-plugin/types/` each time it loads the plugins with
`--plugin-dir` (a one-prompt headless run,
`claude -p --plugin-dir plugins "ok"`, will do). Before `npm run typecheck`,
load the plugins once, and again after updating Claude Code.

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
  *.test.ts                    next to the file it tests, run with node:test
```
