// O loop de poll: quando consultar, o que guardar, quando avisar. Tudo que
// toca o engine entra por `deps`, então roda em teste com um relógio falso.
import { inFlight, phase, transitions, visible, withPrs, type Pr, type Run } from "../domain/runs.ts";
import { branchLabel, elapsed } from "../domain/format.ts";

export type PollerConfig = {
  activeMs: number; // intervalo com run em andamento ou push esperando
  idleMs: number; // intervalo parado
  holdMs: number; // quanto tempo um run terminado fica na faixa
  watchMs: number; // quanto tempo um push mantém o ritmo rápido
};

export const DEFAULT_CONFIG: PollerConfig = {
  activeMs: 15_000,
  idleMs: 60_000,
  holdMs: 5 * 60_000,
  watchMs: 6 * 60_000,
};

export type Timer = { cancel: () => void };

export type PollerDeps = {
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>; // pode falhar: os runs ficam sem #N
  now: () => number;
  after: (ms: number, fn: () => void) => Timer;
  onChange: () => void; // a faixa precisa redesenhar
  toast: (text: string, timeoutMs?: number) => void;
  log: (text: string) => void;
};

export type Poller = {
  start: () => void;
  wake: () => void; // um push aconteceu: olha agora e fica no ritmo rápido
  rows: () => Run[];
  waitingSince: () => number | null; // quando o push aconteceu, enquanto nenhum run apareceu
};

type Pace = "active" | "idle";

export function createPoller(repo: string, deps: PollerDeps, cfg: PollerConfig = DEFAULT_CONFIG): Poller {
  let rows: Run[] = [];
  let pushedAt: number | null = null;
  let seen: ReadonlySet<number> = new Set();
  let first = true; // o primeiro poll só aprende o que já roda, sem avisar
  let errorLogged = false; // uma linha por pane, não uma por poll
  let timer: Timer | null = null;

  const waitingSince = (): number | null =>
    pushedAt !== null && deps.now() - pushedAt < cfg.watchMs ? pushedAt : null;
  const waiting = () => waitingSince() !== null;

  const fetchRuns = async (): Promise<Run[] | null> => {
    try {
      const [runs, prs] = await Promise.all([deps.listRuns(), deps.listPrs().catch(() => [] as Pr[])]);
      errorLogged = false;
      return withPrs(runs, prs);
    } catch (err) {
      if (!errorLogged) deps.log(err instanceof Error ? err.message : String(err));
      errorLogged = true;
      return null;
    }
  };

  const announce = (started: Run[], finished: Run[]) => {
    if (!first) {
      for (const r of started) deps.toast(`⚙ ${repo}: ${r.workflowName} started (${branchLabel(r)})`);
    }
    for (const r of finished) {
      const took = elapsed(Date.parse(r.updatedAt) - Date.parse(r.createdAt));
      deps.toast(`⚙ ${repo}: ${r.workflowName} ${phase(r).label} after ${took}`, 8000);
    }
    first = false;
  };

  const poll = async (): Promise<Pace> => {
    const list = await fetchRuns();
    if (list === null) return waiting() ? "active" : "idle";

    const t = transitions(seen, list);
    seen = t.seen;
    if (t.started.length > 0) pushedAt = null; // chegou o run que o push esperava
    announce(t.started, t.finished);
    rows = visible(list, deps.now(), cfg.holdMs);
    return rows.some(inFlight) || waiting() ? "active" : "idle";
  };

  const loop = async () => {
    const pace = await poll();
    deps.onChange();
    timer = deps.after(pace === "active" ? cfg.activeMs : cfg.idleMs, () => void loop());
  };

  return {
    start: () => void loop(),
    wake: () => {
      pushedAt = deps.now();
      deps.onChange();
      timer?.cancel();
      timer = null;
      void loop();
    },
    rows: () => rows,
    waitingSince,
  };
}
