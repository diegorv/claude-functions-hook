// Wires the pieces to the engine: its hooks, no logic of its own.
//
//   session.start        finds the repo through its remote and starts the poller
//   classic.PostToolUse  a push or merge in Bash wakes the poller, or finds the repo again
//                        when that failed at session start
//   ui.render            draws the band above the prompt from the poller's state, and the
//                        details pane its "details" Button opens
//   ui.close             notes that the pane is gone, so the next toggle opens it
//   command.run          /gh-ci opens or closes that pane, band or not; /gh-ci refresh polls
//                        now, /gh-ci status answers with the band's counts
import type { EngineInterface, Register } from "claude-code";
import { createGitHubClient } from "../infra/github.ts";
import { createPoller, needsRedraw, type Poller } from "../app/poller.ts";
import { createStarter, type Starter } from "../app/starter.ts";
import { createDetails, type DetailsCache } from "../app/details.ts";
import { triggersWorkflow } from "../core/trigger-commands.ts";
import { Band } from "../components/band.tsx";
import { bandModel } from "../components/band-model.ts";
import { Pane } from "../components/pane.tsx";
import { paneModel, shouldClose } from "../components/pane-model.ts";
import { counts } from "../core/run-labels.ts";
import { cut, elapsed } from "../utils/text.ts";

const TICK_MS = 1000; // the band's clocks move between polls
const PANE_ID = "ci";
const LAST_ERROR_CELLS = 120; // the gh failure /gh-ci shows while no repo is found

type Toggled = { kind: "opened" } | { kind: "closed" } | { kind: "unplaced"; reason: string };

// What /gh-ci says after it toggled the pane; opening needs no words, the pane is the answer.
function commandReply(toggled: Toggled): string | undefined {
  if (toggled.kind === "closed") return "Closed the CI pane.";
  if (toggled.kind === "unplaced") return `The CI pane did not open: ${toggled.reason}`;
  return undefined;
}

// Opens the details pane, or closes it when it is the one shown and this module
// drew it (shouldClose). Open but behind another tab, or listed after a reload
// with nothing drawing it, it is opened again, which raises it.
async function togglePane($: EngineInterface, details: DetailsCache, drawnHere: boolean): Promise<Toggled> {
  const listed = (await $.ui.panes()).find((pane) => pane.id === PANE_ID);
  if (shouldClose(listed?.isShown === true, drawnHere)) {
    await $.ui.close({ id: PANE_ID });
    return { kind: "closed" };
  }
  // Listed but not drawn here is what a reload leaves, and opening that again does not draw it: close it first.
  if (listed && !drawnHere) await $.ui.close({ id: PANE_ID });
  details.retryFailed();
  // Asked for (a press or a command), so the surface places it at any width; toasts stay on, it is not a dialog.
  const opened = await $.ui.open({ id: PANE_ID, title: "CI", focus: true, closeOnEscape: true });
  return opened.isPlaced ? { kind: "opened" } : { kind: "unplaced", reason: opened.reason };
}

// For a press's promise, which nothing awaits.
const logFailure = ($: EngineInterface) => (error: unknown) =>
  $.ui.log(error instanceof Error ? error.message : String(error), { to: "debug" });

export const register: Register = (on) => {
  // Set once the repo is found; null until then, or when there is no GitHub repo.
  let watch: { repo: string; poller: Poller; details: DetailsCache } | null = null;
  // Set by session.start; finds the repo and starts the watch, again on a push while it is not found.
  let startWatch: Starter | null = null;
  // A push or merge seen before the watch started: the poller wakes on it once it does.
  let pendingWake = false;
  // The poller reads the time synchronously and $.clock.now() is async, so this copy is
  // refreshed before the poller starts, on every tick and on every drawing.
  let now = 0;
  // This module drew the pane since it last opened; cleared when it closes, false after a reload.
  let paneDrawn = false;

  on("session.start", ($, event, next) => {
    if (!event.isInteractive) return next(event); // -p and the SDK draw nowhere
    const github = createGitHubClient((argv, init) => $.process.run(argv, init), event.cwd);
    void $.command
      .register({
        name: "gh-ci",
        description: "Show or hide this repo's GitHub Actions runs and their failed jobs",
        argumentHint: "[refresh|status]",
      })
      .catch((error: unknown) =>
        $.ui.log(`/gh-ci: ${error instanceof Error ? error.message : String(error)}`, { to: "debug" }),
      );

    // Finding the repo takes a gh call; the session must not wait for it.
    startWatch = createStarter(
      () => github.repoName(),
      async (repo) => {
        now = await $.clock.now();
        const poller = createPoller(repo, {
          listRuns: github.listRuns,
          listPrs: github.listPrs,
          now: () => now,
          after: (ms, callback) => $.clock.after(ms, callback),
          onChange: () => $.ui.invalidate("ui.render"),
          toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs ? { timeoutMs } : undefined),
          log: (text) => $.ui.log(text, { to: "debug" }), // the band's header shows the outage
        });
        // No second poller: what can throw runs before this line, and once `watch` is set a push wakes it.
        watch = { repo, poller, details: createDetails(github.runJobs, () => $.ui.invalidate("ui.render")) };
        poller.start();
        if (pendingWake) {
          pendingWake = false;
          poller.wake();
        }
        // A timer's callback is synchronous; a refresh that fails is retried on the next tick.
        let lastShown = 0; // rows on the band at the last tick
        $.clock.every(TICK_MS, () => {
          void $.clock.now().then(
            (time) => {
              now = time;
              const counting = poller.live() || poller.staleSince() !== null;
              const shown = poller.rows().length;
              if (needsRedraw(counting, shown, lastShown)) $.ui.invalidate("ui.render");
              lastShown = shown;
            },
            () => {},
          );
        });
      },
      (text) => $.ui.log(text, { to: "debug" }),
    );
    startWatch();
    return next(event);
  });

  // classic.PostToolUse fires after the tool succeeded, so a denied or failed push never gets here.
  on("classic.PostToolUse", { tool_name: "Bash" }, ($, event, next) => {
    const command = (event.tool_input as { command?: unknown }).command;
    if (typeof command === "string" && triggersWorkflow(command)) {
      if (watch) watch.poller.wake();
      else {
        pendingWake = true;
        startWatch?.(); // the repo was not found at session start: a push is a good moment to look again
      }
    }
    return next(event);
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, event, next) => {
    if (event.props.hasSurvey || !watch) return next(event);
    const { repo, poller } = watch;
    now = await $.clock.now();
    const model = bandModel({
      repo,
      rows: poller.rows(),
      waitingSince: poller.waitingSince(),
      staleSince: poller.staleSince(),
      now,
      maxRows: event.props.maxRows,
      columns: event.props.bodyColumns,
    });
    const { details } = watch;
    return model
      ? Band($.ui.resolve(event), model, () => void togglePane($, details, paneDrawn).catch(logFailure($)))
      : next(event);
  });

  // Registered only in an interactive session (session.start), where the pane can draw.
  on("command.run", { command: "gh-ci" }, async ($, event) => {
    const args = event.args.trim();
    if (args !== "" && args !== "refresh" && args !== "status") return { text: "Usage: /gh-ci [refresh|status]" };
    if (!watch) {
      startWatch?.();
      const lastError = startWatch?.lastError();
      const reason = lastError ? ` Last error: ${cut(lastError, LAST_ERROR_CELLS)}` : "";
      return {
        text: `No GitHub repo found yet (gh repo view); looking again now. Run /gh-ci again in a moment.${reason}`,
      };
    }
    const { repo, poller } = watch;
    if (args === "refresh") {
      poller.refresh();
      return { text: "Refreshing CI runs." };
    }
    if (args === "status") {
      const staleSince = poller.staleSince();
      const stale = staleSince !== null ? ` · gh error for ${elapsed((await $.clock.now()) - staleSince)}` : "";
      return { text: `${repo}${stale} · ${counts(poller.rows()) || "no runs on the band"}` };
    }
    const text = commandReply(await togglePane($, watch.details, paneDrawn));
    return text ? { text } : {};
  });

  on("ui.render", { component: "Pane", surface: "terminal" }, async ($, event, next) => {
    if (event.requestId !== PANE_ID || !watch) return next(event);
    const { repo, poller, details } = watch;
    now = await $.clock.now();
    const runs = poller.fetched();
    details.keepOnly(new Set((runs ?? []).map((run) => run.databaseId)));
    const model = paneModel({
      repo,
      runs,
      staleSince: poller.staleSince(),
      now,
      columns: event.props.bodyColumns,
      details: details.of,
    });
    paneDrawn = true;
    return Pane($.ui.resolve(event), model, () => void $.ui.close({ id: PANE_ID }).catch(logFailure($)));
  });

  // The person's close (mark, Esc) or ours ends the drawing; the close goes on. An unload runs no
  // hook of ours, and the reloaded module starts with the flag false.
  on("ui.close", { id: PANE_ID }, ($, event, next) => {
    paneDrawn = false;
    return next(event);
  });
};
