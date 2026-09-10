/** @jsx h */
// Wires the pieces to the engine: three hooks, no logic of its own.
//
//   session.start        finds the repo through its remote and starts the poller
//   classic.PostToolUse  a push or merge in Bash wakes the poller
//   ui.render            draws the band above the prompt from the poller's state
import type { Register } from "claude-code";
import { createGitHubClient } from "../infra/github.ts";
import { createPoller, type Poller } from "../app/poller.ts";
import { triggersWorkflow } from "../core/trigger-commands.ts";
import { Band } from "../components/band.tsx";
import { bandModel } from "../components/band-model.ts";

const MAX_ROWS = 6;
const TICK_MS = 1000; // the band's clocks move between polls

export const register: Register = (on) => {
  // Set by session.start; null until then, or when there is no GitHub repo.
  let watch: { repo: string; poller: Poller } | null = null;

  on("session.start", ($, event, next) => {
    if (!event.interactive) return next(event); // -p and the SDK draw nowhere
    const github = createGitHubClient((argv, init) => $.process.run(argv, init), event.cwd);

    // Finding the repo takes a gh call; the session must not wait for it.
    void github.repoName().then(
      (repo) => {
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
          if (poller.live()) $.ui.invalidate("ui.render");
        });
      },
      (error) => $.ui.log(`${error instanceof Error ? error.message : String(error)}; staying quiet`),
    );
    return next(event);
  });

  // classic.PostToolUse fires after the tool succeeded, so a denied or failed push never gets here.
  on("classic.PostToolUse", { tool_name: "Bash" }, ($, event, next) => {
    const command = (event.tool_input as { command?: unknown }).command;
    if (watch && typeof command === "string" && triggersWorkflow(command)) watch.poller.wake();
    return next(event);
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, event, next) => {
    if (event.props.hasSurvey || !watch) return next(event);
    const { repo, poller } = watch;
    const model = bandModel({
      repo,
      rows: poller.rows(),
      waitingSince: poller.waitingSince(),
      now: $.clock.now(),
      maxRows: Math.max(1, Math.min(MAX_ROWS, event.props.maxRows - 3)), // header, waiting line, "more" line
    });
    return model ? Band($.ui.resolve(event), model) : next(event);
  });
};
