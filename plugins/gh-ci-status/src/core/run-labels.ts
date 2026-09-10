// Text derived from a workflow run: what each band column and toast says.
import { inFlight, prNumber, type Run } from "./workflow-run.ts";
import { elapsed } from "../utils/text.ts";

// The time column: how long the run has been going, or how long it took.
export function clock(run: Run, now: number): string {
  const startedAt = Date.parse(run.startedAt);
  const endedAt = inFlight(run) ? now : Date.parse(run.updatedAt);
  return elapsed(endedAt - startedAt);
}

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
