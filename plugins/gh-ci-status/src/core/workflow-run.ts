// The workflow run model: what a GitHub Actions run is, which phase it is in, which runs stay
// on the band, and what changed between one poll and the next. Imports nothing.

export type Run = {
  databaseId: number;
  status: "queued" | "in_progress" | "waiting" | "pending" | "requested" | "completed";
  conclusion: string | null; // success | failure | cancelled | skipped | timed_out | ...
  event: string; // what triggered the run: push, pull_request, schedule, issue_comment, ...
  workflowDatabaseId: number; // the workflow's id: a renamed workflow keeps it
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

// `color` is a theme key, so it follows the person's theme (light, dark,
// colorblind), except failures: raw red until a theme key for them is known.
export type Phase = { dot: string; label: string; color: string };

const LABELS = {
  running: "Running",
  queued: "Queued",
  waiting: "Waiting", // for a deployment's approval or wait timer
  success: "Success",
  failure: "Failed",
  timed_out: "Timed out",
  startup_failure: "Failed",
  action_required: "Needs you", // a run that waits on someone, such as approval for a fork's PR
  cancelled: "Cancelled",
  skipped: "Skipped",
  neutral: "Neutral",
  stale: "Stale",
} as const;

// The status column is as wide as the longest label; one GitHub adds later
// shows capitalized; the band cuts it to that width.
export const LABEL_WIDTH = Math.max(...Object.values(LABELS).map((label) => label.length));

export const inFlight = (run: Run): boolean => run.status !== "completed";

// When the run's latest attempt began: startedAt, which a rerun moves while
// createdAt stays; createdAt when startedAt is missing or unparsable.
export const attemptStartedAt = (run: Run): number =>
  Math.max(Date.parse(run.createdAt) || 0, Date.parse(run.startedAt) || 0);

// Runs a person starts from the terminal stay on the band; cron, issue bots and the like do not.
const PERSON_EVENTS = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "workflow_dispatch",
  "merge_group",
  "release",
  "workflow_run",
]);
export const startedByPerson = (run: Run): boolean => PERSON_EVENTS.has(run.event);

// The PR number: what withPrs matched by branch, the N in `refs/pull/N/head`, the branch
// GitHub uses for runs a PR triggered, or the N in `gh-readonly-queue/<base>/pr-N-<sha>`,
// the branch of a merge queue run. Null when there is no way to know.
export function prNumber(run: Run): number | null {
  if (run.pr !== undefined) return run.pr;
  const match =
    /^refs\/pull\/(\d+)\//.exec(run.headBranch) ?? /^gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]+$/.exec(run.headBranch);
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
  if (run.status === "in_progress") return { dot: "◐", label: LABELS.running, color: "warning" };
  if (run.status === "waiting") return { dot: "○", label: LABELS.waiting, color: "warning" };
  if (inFlight(run)) return { dot: "○", label: LABELS.queued, color: "warning" };
  switch (run.conclusion) {
    case "success":
      return { dot: "●", label: LABELS.success, color: "success" };
    case "failure":
    case "startup_failure":
      return { dot: "✗", label: LABELS[run.conclusion], color: "red" };
    case "timed_out":
      return { dot: "✗", label: LABELS.timed_out, color: "red" };
    case "action_required":
      return { dot: "!", label: LABELS.action_required, color: "warning" };
    case "cancelled":
      return { dot: "⊘", label: LABELS.cancelled, color: "inactive" };
    case "skipped":
    case "neutral":
    case "stale":
      return { dot: "·", label: LABELS[run.conclusion], color: "inactive" };
    default: {
      const label = (run.conclusion ?? "done").replaceAll("_", " ");
      return { dot: "·", label: label.charAt(0).toUpperCase() + label.slice(1), color: "inactive" };
    }
  }
}

// `cancelled` stays with the rest: a person usually cancelled it.
const NEEDS_ATTENTION = new Set(["failure", "startup_failure", "timed_out", "action_required"]);
export const needsAttention = (run: Run) => !inFlight(run) && NEEDS_ATTENTION.has(run.conclusion ?? "");
const group = (run: Run) => (inFlight(run) ? 0 : needsAttention(run) ? 1 : 2);

// In flight first, then what failed or waits on someone, then the rest; gh's
// newest-first order holds within each group (the sort is stable), so a row
// moves only when its state changes.
export const byAttention = (runs: Run[]): Run[] => runs.toSorted((a, b) => group(a) - group(b));

export type Holds = {
  holdMs: number; // how long a finished run stays on the band
  failedHoldMs: number; // how long one that needs attention can stay, at most
};

// Stays on the band: everything in flight; what needs attention (as byAttention
// groups it) until a newer run of the same workflow, branch and event shows up,
// or failedHoldMs after it ended; anything else holdMs after it ended.
export function visible(runs: Run[], now: number, holds: Holds): Run[] {
  const superseded = (run: Run) =>
    runs.some(
      (other) =>
        other.workflowDatabaseId === run.workflowDatabaseId &&
        other.headBranch === run.headBranch &&
        other.event === run.event &&
        // createdAt, not the attempt: a rerun of an older run tests older code, so it does not end a later failure
        Date.parse(other.createdAt) > Date.parse(run.createdAt),
    );
  return runs.filter((run) => {
    if (inFlight(run)) return true;
    const age = now - Date.parse(run.updatedAt);
    return needsAttention(run) ? age < holds.failedHoldMs && !superseded(run) : age < holds.holdMs;
  });
}

type Transitions = {
  seen: ReadonlySet<number>; // ids in flight after this poll
  started: Run[]; // entered flight now
  finished: Run[]; // were in flight and left it
};

// Compares what was in flight with the new list. Pure: returns the new set
// instead of mutating the old one.
// ponytail: only what the list returns; a run pushed out by 15 newer ones ends
// silently. gh run view <id> per orphan if it ever matters.
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

// A job of a run, as `gh run view --json jobs` lists it.
export type Job = {
  databaseId: number;
  name: string;
  conclusion: string | null;
  steps: { name: string; conclusion: string | null }[];
  url?: string; // the job's page; built from the run's when gh leaves it out
};

export type JobFailure = { job: string; step: string | null; url: string };

const FAILED_JOB = new Set(["failure", "timed_out", "startup_failure"]);

// The jobs that failed, each with the first step that did (null when no step
// failed, as when a job timed out between steps), linking to the job's page.
export function jobFailures(run: Run, jobs: Job[]): JobFailure[] {
  return jobs
    .filter((job) => FAILED_JOB.has(job.conclusion ?? ""))
    .map((job) => ({
      job: job.name,
      step: job.steps.find((step) => FAILED_JOB.has(step.conclusion ?? ""))?.name ?? null,
      url: job.url || `${run.url}/job/${job.databaseId}`,
    }));
}
