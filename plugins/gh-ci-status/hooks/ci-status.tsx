/** @jsx h */
import type { Register, Timer } from "claude-code";

// Workflows do GitHub Actions do repo da sessão, desenhados na faixa acima do
// prompt: um cabeçalho com as contagens e uma linha por run em andamento ou
// recém-terminado. Consulta `gh run list` e nunca inicia um turno.
// Um `git push` ou `gh pr merge` acorda o poll até o run aparecer.

type Run = {
  databaseId: number;
  status: string; // queued | in_progress | waiting | pending | requested | completed
  conclusion: string | null; // success | failure | cancelled | skipped | timed_out | ...
  name: string;
  headBranch: string;
  displayTitle: string;
  createdAt: string;
  updatedAt: string;
};

const ACTIVE_MS = 15_000;
const IDLE_MS = 60_000;
const HOLD_MS = 5 * 60_000; // quanto tempo um run terminado fica na faixa
const WATCH_MS = 6 * 60_000; // quanto tempo um push mantém o poll rápido
const MAX_ROWS = 6;
const FIELDS = "databaseId,status,conclusion,name,headBranch,displayTitle,createdAt,updatedAt";

const WAKES = /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$))/;

const inFlight = (r: Run) => r.status !== "completed";

const phase = (r: Run): { dot: string; label: string; color?: string; dim?: boolean } => {
  if (r.status === "in_progress") return { dot: "◐", label: "Running", color: "yellow" };
  if (inFlight(r)) return { dot: "○", label: "Queued", color: "yellow" };
  switch (r.conclusion) {
    case "success": return { dot: "●", label: "Success", color: "green" };
    case "failure": case "timed_out": case "startup_failure": return { dot: "✗", label: r.conclusion === "failure" ? "Failed" : r.conclusion, color: "red" };
    case "cancelled": return { dot: "⊘", label: "Cancelled", color: "red" };
    default: return { dot: "·", label: r.conclusion ?? "Done", dim: true };
  }
};

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

const cut = (t: string, max: number) => {
  const one = t.split("\n")[0].trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

const clock = (r: Run, now: number) => {
  const started = Date.parse(r.createdAt);
  const ended = Date.parse(r.updatedAt);
  return inFlight(r) ? elapsed(now - started) : `took ${elapsed(ended - started)} · ${elapsed(now - ended)} ago`;
};

export const register: Register = (on) => {
  let repo = "";
  let rows: Run[] = [];
  let pushedAt: number | null = null;
  let wake: (() => void) | null = null;

  const waiting = (now: number) => pushedAt !== null && now - pushedAt < WATCH_MS;
  const running = () => rows.filter(inFlight);

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const now = $.clock.now();
    if (rows.length === 0 && !waiting(now)) return next(e);

    const { Box, Text } = $.ui.resolve(e);
    const shown = rows.slice(0, MAX_ROWS);
    const hidden = rows.length - shown.length;
    const done = rows.length - running().length;
    const header = [`⚙ ${repo}`, running().length ? `${running().length} running` : "", done ? `${done} finished` : ""]
      .filter(Boolean)
      .join(" · ");

    // Regras do JSX deste runtime: array de .map() só dentro de Fragment; Box não aceita key.
    return (
      <Box flexDirection="column">
        <Text dimColor>{header}</Text>
        {waiting(now) && running().length === 0 ? (
          <Text dimColor>{`◌ waiting for a run   ${elapsed(now - pushedAt!)}`}</Text>
        ) : (
          <Text>{""}</Text>
        )}
        <>
          {shown.map((r) => {
            const p = phase(r);
            return (
              <Box gap={2}>
                <Text color={p.color} dimColor={p.dim}>{`${p.dot} ${p.label.padEnd(9)}`}</Text>
                <Text dimColor>{`${r.name} · ${r.headBranch}`}</Text>
                <Text>{clock(r, now)}</Text>
                <Text dimColor wrap="truncate-end">{cut(r.displayTitle, 60)}</Text>
              </Box>
            );
          })}
        </>
        {hidden > 0 ? <Text dimColor>{`  … and ${hidden} more`}</Text> : <Text>{""}</Text>}
      </Box>
    );
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const cmd = typeof e.command === "string" ? e.command : "";
    if (!WAKES.test(cmd) || /--dry-run/.test(cmd)) return next(e);
    const result = await next(e); // o push precisa terminar antes de o GitHub ter algo a dizer
    wake?.();
    return result;
  });

  on("session.start", async ($, e, next) => {
    const cwd = e.cwd;
    try {
      const r = await $.process.run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, timeoutMs: 15_000 });
      repo = r.stdout.trim();
      if (r.exitCode !== 0 || !repo) throw new Error(cut(r.stderr || "no GitHub remote", 120));
    } catch (err) {
      $.ui.log(`gh-ci-status: ${err instanceof Error ? err.message : String(err)}; staying quiet`);
      return next(e);
    }
    $.ui.log(`gh-ci-status: watching ${repo}`);

    let errorShown = false;
    let first = true; // o primeiro poll só aprende o que já está rodando, sem avisar
    const seenInFlight = new Set<number>();

    const poll = async (): Promise<boolean> => {
      let list: Run[];
      try {
        const r = await $.process.run(["gh", "run", "list", "--limit", "15", "--json", FIELDS], { cwd, timeoutMs: 25_000 });
        if (r.exitCode !== 0) throw new Error(cut(r.stderr || r.stdout || `exit ${r.exitCode}`, 120));
        list = JSON.parse(r.stdout) as Run[];
      } catch (err) {
        if (!errorShown) {
          errorShown = true;
          $.ui.log(`gh-ci-status: ${err instanceof Error ? err.message : String(err)}`);
        }
        return waiting($.clock.now());
      }
      errorShown = false;

      const now = $.clock.now();
      for (const r of list) {
        if (inFlight(r)) {
          if (!seenInFlight.has(r.databaseId)) {
            seenInFlight.add(r.databaseId);
            pushedAt = null; // chegou o run que o push esperava
            if (!first) $.ui.toast(`⚙ ${repo}: ${r.name} started (${r.headBranch})`);
          }
        } else if (seenInFlight.delete(r.databaseId)) {
          $.ui.toast(`⚙ ${repo}: ${r.name} ${phase(r).label} after ${elapsed(Date.parse(r.updatedAt) - Date.parse(r.createdAt))}`, { timeoutMs: 8000 });
        }
      }
      first = false;
      rows = list.filter((r) => inFlight(r) || now - Date.parse(r.updatedAt) < HOLD_MS);
      return running().length > 0 || waiting(now);
    };

    let timer: Timer | null = null;
    const loop = async () => {
      const active = await poll();
      $.ui.invalidate("ui.render");
      timer = $.clock.after(active ? ACTIVE_MS : IDLE_MS, loop);
    };

    wake = () => {
      pushedAt = $.clock.now();
      $.ui.invalidate("ui.render");
      timer?.cancel();
      timer = null;
      void loop();
    };

    $.clock.every(1000, () => {
      if (rows.length > 0 || waiting($.clock.now())) $.ui.invalidate("ui.render");
    });
    void loop();

    return next(e);
  });
};
