/** @jsx h */
// Liga as peças ao engine: três hooks, nenhuma lógica própria.
//
//   session.start  descobre o repo pelo remote e inicia o poller
//   tool.call      um push ou merge no Bash acorda o poller
//   ui.render      desenha a faixa acima do prompt com o estado do poller
import type { Register } from "claude-code";
import { createGhClient } from "./gh.ts";
import { createPoller, type Poller } from "./poller.ts";
import { isWakeCommand } from "./wake.ts";
import { Band } from "./band.tsx";

const MAX_ROWS = 6;

export const register: Register = (on) => {
  let repo = "";
  let poller: Poller | null = null;

  on("session.start", async ($, e, next) => {
    const gh = createGhClient((argv, init) => $.process.run(argv, init), e.cwd);
    try {
      repo = await gh.repoName();
    } catch (err) {
      $.ui.log(`gh-ci-status: ${err instanceof Error ? err.message : String(err)}; staying quiet`);
      return next(e);
    }
    $.ui.log(`gh-ci-status: watching ${repo}`);

    poller = createPoller(repo, {
      listRuns: gh.listRuns,
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      onChange: () => $.ui.invalidate("ui.render"),
      toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs ? { timeoutMs } : undefined),
      log: (text) => $.ui.log(text),
    });
    poller.start();

    // Os relógios da faixa andam entre um poll e outro.
    $.clock.every(1000, () => {
      if (poller && (poller.rows().length > 0 || poller.waiting())) $.ui.invalidate("ui.render");
    });
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!isWakeCommand(typeof e.command === "string" ? e.command : "")) return next(e);
    const result = await next(e); // o push precisa terminar antes de o GitHub ter algo a dizer
    poller?.wake();
    return result;
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, e, next) => {
    if (e.props.hasSurvey || !poller) return next(e);
    const rows = poller.rows();
    if (rows.length === 0 && !poller.waiting()) return next(e);
    return Band($.ui.resolve(e), {
      repo,
      rows,
      waitingSince: poller.waiting() ? poller.waitingSince() : null,
      now: $.clock.now(),
      maxRows: MAX_ROWS,
    });
  });
};
