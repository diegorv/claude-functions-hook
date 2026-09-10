// The poll loop: when to ask, what to keep, when to notify. Everything that
// touches the engine comes in through `deps`, so tests run it on a fake clock.
import { inFlight, phase, transitions, visible, withPrs, type Pr, type Run } from "../core/workflow-run.ts";
import { branchLabel, clock } from "../core/run-labels.ts";
import { cut } from "../utils/text.ts";

type PollerConfig = {
  activeMs: number; // interval while a run is in flight or a push is waiting
  idleMs: number; // interval while nothing is happening
  holdMs: number; // how long a finished run stays on the band
  watchMs: number; // how long a push keeps the active pace
};

export const DEFAULT_CONFIG: PollerConfig = {
  activeMs: 15_000,
  idleMs: 60_000,
  holdMs: 5 * 60_000,
  watchMs: 6 * 60_000,
};

type Timer = { cancel: () => void };

export type PollerDeps = {
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>; // may fail: runs then show no #N
  now: () => number;
  after: (ms: number, callback: () => void) => Timer;
  onChange: () => void; // the band needs a redraw
  toast: (text: string, timeoutMs?: number) => void;
  log: (text: string) => void;
};

export type Poller = {
  start: () => void;
  wake: () => void; // a push happened: look now and keep the active pace
  rows: () => Run[];
  waitingSince: () => number | null; // when the push happened, while no run has shown up
  live: () => boolean; // something on the band is counting up: a run in flight, or a push being waited on
};

export function createPoller(repo: string, deps: PollerDeps, config: PollerConfig = DEFAULT_CONFIG): Poller {
  let rows: Run[] = [];
  let pushedAt: number | null = null;
  let seen: ReadonlySet<number> = new Set();
  let firstPoll = true; // the first poll only learns what is already running, without notifying
  let errorLogged = false; // one line per outage, not one per poll
  let timer: Timer | null = null;
  let polling = false; // one poll at a time: a wake mid-poll must not start a second chain of timers

  const waitingSince = (): number | null =>
    pushedAt !== null && deps.now() - pushedAt < config.watchMs ? pushedAt : null;
  const waiting = () => waitingSince() !== null;
  const live = () => rows.some(inFlight) || waiting();

  const fetchRuns = async (): Promise<Run[] | null> => {
    try {
      const [runs, prs] = await Promise.all([deps.listRuns(), deps.listPrs().catch(() => [] as Pr[])]);
      errorLogged = false;
      return withPrs(runs, prs);
    } catch (error) {
      if (!errorLogged) deps.log(error instanceof Error ? error.message : String(error));
      errorLogged = true;
      return null;
    }
  };

  const announce = (started: Run[], finished: Run[]) => {
    if (!firstPoll) {
      for (const run of started) deps.toast(`⚙ ${repo}: ${cut(run.workflowName, 60)} started (${branchLabel(run)})`);
    }
    for (const run of finished) {
      deps.toast(`⚙ ${repo}: ${cut(run.workflowName, 60)} ${phase(run).label} after ${clock(run, deps.now())}`, 8000);
    }
    firstPoll = false;
  };

  const poll = async (): Promise<boolean> => {
    const runs = await fetchRuns();
    if (runs === null) return waiting();

    const changes = transitions(seen, runs);
    seen = changes.seen;
    const since = pushedAt; // narrowed copy: TS resets `let` narrowing inside the callback
    if (since !== null && runs.some((run) => Date.parse(run.createdAt) >= since)) pushedAt = null; // the push's run is here
    announce(changes.started, changes.finished);
    rows = visible(runs, deps.now(), config.holdMs);
    return live();
  };

  const loop = async () => {
    if (polling) return; // a wake during a poll: the running poll already sees pushedAt and keeps the active pace
    polling = true;
    const active = await poll().finally(() => (polling = false));
    deps.onChange();
    timer = deps.after(active ? config.activeMs : config.idleMs, () => void loop());
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
    rows: () => visible(rows, deps.now(), config.holdMs),
    waitingSince,
    live,
  };
}
