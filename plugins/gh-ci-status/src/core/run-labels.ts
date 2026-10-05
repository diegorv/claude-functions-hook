// Text derived from a workflow run: what each band column and toast says.
import { attemptStartedAt, inFlight, needsAttention, phase, prNumber, type Run } from "./workflow-run.ts";
import { cut, elapsed } from "../utils/text.ts";

// The time column: how long the run has been going, or how long it took.
export function clock(run: Run, now: number): string {
  const startedAt = attemptStartedAt(run);
  const endedAt = inFlight(run) ? now : Date.parse(run.updatedAt);
  return elapsed(endedAt - startedAt);
}

export const workflowLabel = (run: Run): string => run.workflowName || "workflow"; // runs of organization rulesets come without a name

export const REF_MAX = 24; // the ref column's width, on the band and in a toast

// `#167` when the run has a PR; otherwise the branch name.
export function branchLabel(run: Run): string {
  const number = prNumber(run);
  return number === null ? run.headBranch : `#${number}`;
}

// The row's title, or empty when it only repeats the #N of the first column
// (a `run-name: PR #N` in the workflow does that).
export function titleOf(run: Run): string {
  const number = prNumber(run);
  const titleWithoutPrefix = run.displayTitle.trim().replace(/^PR\s*/i, "");
  return number !== null && titleWithoutPrefix === `#${number}` ? "" : run.displayTitle;
}

// Where the row leads: the PR when known, otherwise the run.
export function linkOf(repo: string, run: Run): string {
  const number = prNumber(run);
  return number === null ? run.url : `https://github.com/${repo}/pull/${number}`;
}

// "1 running · 2 finished", non-zero counts only; empty when there is nothing.
export function counts(runs: Run[]): string {
  const running = runs.filter(inFlight).length;
  const finished = runs.length - running;
  return [running ? `${running} running` : "", finished ? `${finished} finished` : ""].filter(Boolean).join(" · ");
}

export type Toast = { text: string; timeoutMs?: number }; // no timeoutMs: the engine's default (4 s)

const FAILURE_TOAST_MS = 10_000;
const name = (run: Run) => cut(workflowLabel(run), 60);
const ref = (run: Run) => cut(branchLabel(run), REF_MAX);

export const startedToast = (repo: string, run: Run): string => `⚙ ${repo}: ${name(run)} started (${ref(run)})`;

// What one poll saw finish: the successes in one toast, first, so on a
// one-line notification bar a failure is what stays; then each run that needs
// attention on its own, longer; cancelled, skipped and the like in none, since
// a person or a newer push usually caused them and the band still shows them.
export function finishedToasts(repo: string, runs: Run[], now: number): Toast[] {
  const toasts: Toast[] = [];
  const passed = runs.filter((run) => run.conclusion === "success");
  if (passed.length === 1) {
    const [run] = passed;
    toasts.push({ text: `⚙ ${repo}: ${name(run)} passed after ${clock(run, now)} (${ref(run)})` });
  } else if (passed.length > 1) {
    toasts.push({ text: `⚙ ${repo}: ${passed.length} runs passed` });
  }
  for (const run of runs.filter(needsAttention)) {
    toasts.push({
      text:
        run.conclusion === "action_required"
          ? `⚙ ${repo}: ${name(run)} needs you (${ref(run)})`
          : `⚙ ${repo}: ${name(run)} ${phase(run).label.toLowerCase()} after ${clock(run, now)} (${ref(run)})`,
      timeoutMs: FAILURE_TOAST_MS,
    });
  }
  return toasts;
}
