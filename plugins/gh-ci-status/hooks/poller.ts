// O loop de poll: quando consultar, o que guardar, quando avisar. Tudo que
// toca o engine entra por `deps`, então roda em teste com um relógio falso.
import { inFlight, phase, transitions, visible, withPrs, type Pr, type Run } from "./runs.ts";
import { branchLabel, elapsed } from "./format.ts";

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

export type PollerDeps = {
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>; // pode falhar: os runs ficam sem #N
  now: () => number;
  after: (ms: number, fn: () => void) => { cancel: () => void };
  onChange: () => void; // a faixa precisa redesenhar
  toast: (text: string, timeoutMs?: number) => void;
  log: (text: string) => void;
};

export type Poller = {
  start: () => void;
  wake: () => void; // um push aconteceu: olha agora e fica no ritmo rápido
  rows: () => Run[];
  waiting: () => boolean; // push recente e nenhum run apareceu ainda
  waitingSince: () => number | null;
};

export function createPoller(repo: string, deps: PollerDeps, cfg: PollerConfig = DEFAULT_CONFIG): Poller {
  let rows: Run[] = [];
  let pushedAt: number | null = null;
  let seen: ReadonlySet<number> = new Set();
  let first = true; // o primeiro poll só aprende o que já roda, sem avisar
  let errorShown = false;
  let timer: { cancel: () => void } | null = null;

  const waiting = () => pushedAt !== null && deps.now() - pushedAt < cfg.watchMs;

  // true = manter o ritmo rápido
  const poll = async (): Promise<boolean> => {
    let list: Run[];
    try {
      const [runs, prs] = await Promise.all([deps.listRuns(), deps.listPrs().catch(() => [] as Pr[])]);
      list = withPrs(runs, prs);
    } catch (err) {
      if (!errorShown) deps.log(err instanceof Error ? err.message : String(err));
      errorShown = true; // uma linha por pane, não uma por poll
      return waiting();
    }
    errorShown = false;

    const t = transitions(seen, list);
    seen = t.seen;
    if (t.started.length > 0) pushedAt = null; // chegou o run que o push esperava
    if (!first) {
      for (const r of t.started) deps.toast(`⚙ ${repo}: ${r.workflowName} started (${branchLabel(r)})`);
    }
    for (const r of t.finished) {
      const took = elapsed(Date.parse(r.updatedAt) - Date.parse(r.createdAt));
      deps.toast(`⚙ ${repo}: ${r.workflowName} ${phase(r).label} after ${took}`, 8000);
    }
    first = false;
    rows = visible(list, deps.now(), cfg.holdMs);
    return rows.some(inFlight) || waiting();
  };

  const loop = async () => {
    const active = await poll();
    deps.onChange();
    timer = deps.after(active ? cfg.activeMs : cfg.idleMs, () => void loop());
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
    waiting,
    waitingSince: () => pushedAt,
  };
}
