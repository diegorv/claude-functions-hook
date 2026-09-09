/** @jsx h */
// Liga as peças ao engine: três hooks, nenhuma lógica própria.
//
//   session.start  descobre o repo pelo remote e inicia o poller
//   tool.call      um push ou merge no Bash acorda o poller
//   ui.render      desenha a faixa acima do prompt com o estado do poller
import type { Register } from "claude-code";
import { createGhClient } from "../infra/gh.ts";
import { createPoller, type Poller } from "../app/poller.ts";
import { inFlight } from "../domain/runs.ts";
import { isWakeCommand } from "../domain/wake.ts";
import { Band } from "../ui/band.tsx";

const MAX_ROWS = 6;
const TICK_MS = 1000; // os relógios da faixa andam entre um poll e outro

export const register: Register = (on) => {
  // Preenchido por session.start; null até lá, ou quando não há repo no GitHub.
  let watch: { repo: string; poller: Poller } | null = null;

  on("session.start", async ($, e, next) => {
    const gh = createGhClient((argv, init) => $.process.run(argv, init), e.cwd);
    let repo: string;
    try {
      repo = await gh.repoName();
    } catch (err) {
      $.ui.log(`${err instanceof Error ? err.message : String(err)}; staying quiet`);
      return next(e);
    }

    const poller = createPoller(repo, {
      listRuns: gh.listRuns,
      listPrs: gh.listPrs,
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      onChange: () => $.ui.invalidate("ui.render"),
      toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs ? { timeoutMs } : undefined),
      log: (text) => $.ui.log(text),
    });
    watch = { repo, poller };
    poller.start();

    $.clock.every(TICK_MS, () => {
      if (poller.rows().some(inFlight) || poller.waitingSince() !== null) $.ui.invalidate("ui.render");
    });
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!isWakeCommand(typeof e.command === "string" ? e.command : "")) return next(e);
    const result = await next(e); // o push precisa terminar antes de o GitHub ter algo a dizer
    watch?.poller.wake();
    return result;
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, e, next) => {
    if (e.props.hasSurvey || !watch) return next(e);
    const { repo, poller } = watch;
    const rows = poller.rows();
    const waitingSince = poller.waitingSince();
    if (rows.length === 0 && waitingSince === null) return next(e);
    return Band($.ui.resolve(e), { repo, rows, waitingSince, now: $.clock.now(), maxRows: MAX_ROWS });
  });
};
