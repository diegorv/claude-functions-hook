/** @jsx h */
// Wires the pieces to the engine: three hooks, no logic of its own.
//
//   session.start  finds the repo through its remote and starts the poller
//   tool.call      a push or merge in Bash wakes the poller
//   ui.render      draws the band above the prompt from the poller's state
import type { Register } from "claude-code";
import { createGitHubClient } from "../infra/github.ts";
import { createPoller, type Poller } from "../app/poller.ts";
import { inFlight } from "../core/runs.ts";
import { isWakeCommand } from "../core/wake.ts";
import { Band } from "../components/band.tsx";

const MAX_ROWS = 6;
const TICK_MS = 1000; // the band's clocks move between polls

export const register: Register = (on) => {
  // Set by session.start; null until then, or when there is no GitHub repo.
  let watch: { repo: string; poller: Poller } | null = null;

  on("session.start", async ($, event, next) => {
    const github = createGitHubClient((argv, init) => $.process.run(argv, init), event.cwd);
    let repo: string;
    try {
      repo = await github.repoName();
    } catch (error) {
      $.ui.log(`${error instanceof Error ? error.message : String(error)}; staying quiet`);
      return next(event);
    }

    const poller = createPoller(repo, {
      listRuns: github.listRuns,
      listPrs: github.listPrs,
      now: () => $.clock.now(),
      after: (ms, callback) => $.clock.after(ms, callback),
      onChange: () => $.ui.invalidate("ui.render"),
      toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs ? { timeoutMs } : undefined),
      log: (text) => $.ui.log(text),
    });
    watch = { repo, poller };
    poller.start();

    $.clock.every(TICK_MS, () => {
      if (poller.rows().some(inFlight) || poller.waitingSince() !== null) $.ui.invalidate("ui.render");
    });
    return next(event);
  });

  on("tool.call", { tool: "Bash" }, async ($, event, next) => {
    if (!isWakeCommand(typeof event.command === "string" ? event.command : "")) return next(event);
    const result = await next(event); // the push has to finish before GitHub has anything to say
    watch?.poller.wake();
    return result;
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, event, next) => {
    if (event.props.hasSurvey || !watch) return next(event);
    const { repo, poller } = watch;
    const rows = poller.rows();
    const waitingSince = poller.waitingSince();
    if (rows.length === 0 && waitingSince === null) return next(event);
    return Band($.ui.resolve(event), { repo, rows, waitingSince, now: $.clock.now(), maxRows: MAX_ROWS });
  });
};
