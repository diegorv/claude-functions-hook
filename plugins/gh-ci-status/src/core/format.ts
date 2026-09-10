// Text formatting for the band. Pure functions over Run only.
import { inFlight, prNumber, type Run } from "./runs.ts";

// Fixed width below one hour (`0m10s`, `3m09s`) so the columns line up.
export function elapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}h${twoDigits(totalMinutes % 60)}m`;
  return `${totalMinutes}m${twoDigits(totalSeconds % 60)}s`;
}

// The first line, truncated with an ellipsis.
export function cut(text: string, maxLength: number): string {
  const firstLine = text.split("\n")[0].trim();
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine;
}

// The time column: how long the run has been going, or how long it took.
export function clock(run: Run, now: number): string {
  const startedAt = Date.parse(run.createdAt);
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
