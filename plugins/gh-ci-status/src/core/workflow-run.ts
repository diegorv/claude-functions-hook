// The workflow run model: what a GitHub Actions run is, which phase it is in, which runs stay
// on the band, and what changed between one poll and the next. Imports nothing.

export type Run = {
  databaseId: number;
  status: "queued" | "in_progress" | "waiting" | "pending" | "requested" | "completed";
  conclusion: string | null; // success | failure | cancelled | skipped | timed_out | ...
  workflowName: string;
  headBranch: string;
  displayTitle: string;
  createdAt: string;
  startedAt: string; // start of the latest attempt; a rerun keeps createdAt
  updatedAt: string;
  url: string; // the run's page on GitHub
  pr?: number; // filled in by withPrs when the branch has a PR
};

// isCrossRepository: from a fork; its branch name says nothing about this repo's runs
export type Pr = { number: number; headRefName: string; isCrossRepository: boolean };

export type Phase = { dot: string; label: string; color?: string; dim?: boolean };

const LABELS = {
  running: "Running",
  queued: "Queued",
  success: "Success",
  failure: "Failed",
  timed_out: "Timed out",
  startup_failure: "Failed",
  cancelled: "Cancelled",
} as const;

// The status column is as wide as the longest label.
export const LABEL_WIDTH = Math.max(...Object.values(LABELS).map((label) => label.length));

export const inFlight = (run: Run): boolean => run.status !== "completed";

// The PR number: what withPrs matched by branch, or the N in `refs/pull/N/head`,
// the branch GitHub uses for runs a PR triggered. Null when there is no way to know.
export function prNumber(run: Run): number | null {
  if (run.pr !== undefined) return run.pr;
  const match = /^refs\/pull\/(\d+)\//.exec(run.headBranch);
  return match ? Number(match[1]) : null;
}

// Pairs each run with the PR of its branch. A run with no PR is returned as is.
export function withPrs(runs: Run[], prs: Pr[]): Run[] {
  // gh lists newest first and a Map keeps the last entry, so reverse to let the newest PR win.
  const prByBranch = new Map(
    prs
      .filter((pr) => !pr.isCrossRepository)
      .toReversed()
      .map((pr) => [pr.headRefName, pr.number]),
  );
  return runs.map((run) => (prByBranch.has(run.headBranch) ? { ...run, pr: prByBranch.get(run.headBranch) } : run));
}

export function phase(run: Run): Phase {
  if (run.status === "in_progress") return { dot: "◐", label: LABELS.running, color: "yellow" };
  if (inFlight(run)) return { dot: "○", label: LABELS.queued, color: "yellow" };
  switch (run.conclusion) {
    case "success":
      return { dot: "●", label: LABELS.success, color: "green" };
    case "failure":
    case "startup_failure":
      return { dot: "✗", label: LABELS[run.conclusion], color: "red" };
    case "timed_out":
      return { dot: "✗", label: LABELS.timed_out, color: "red" };
    case "cancelled":
      return { dot: "⊘", label: LABELS.cancelled, color: "red" };
    default:
      return { dot: "·", label: run.conclusion ?? "Done", dim: true };
  }
}

// Stays on the band: everything in flight, plus what finished less than holdMs ago.
export function visible(runs: Run[], now: number, holdMs: number): Run[] {
  return runs.filter((run) => inFlight(run) || now - Date.parse(run.updatedAt) < holdMs);
}

export type Transitions = {
  seen: ReadonlySet<number>; // ids in flight after this poll
  started: Run[]; // entered flight now
  finished: Run[]; // were in flight and left it
};

// Compares what was in flight with the new list. Pure: returns the new set
// instead of mutating the old one.
export function transitions(seen: ReadonlySet<number>, runs: Run[]): Transitions {
  const nextSeen = new Set<number>();
  const started: Run[] = [];
  const finished: Run[] = [];
  for (const run of runs) {
    if (inFlight(run)) {
      nextSeen.add(run.databaseId);
      if (!seen.has(run.databaseId)) started.push(run);
    } else if (seen.has(run.databaseId)) {
      finished.push(run);
    }
  }
  return { seen: nextSeen, started, finished };
}
