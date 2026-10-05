// The details pane's view model: every run the last poll listed, with the
// band's columns at the pane's width, and under each run that needs attention
// its failed jobs and steps. pane.tsx maps it to elements and decides nothing.
import { byAttention, needsAttention, type Run } from "../core/workflow-run.ts";
import { counts } from "../core/run-labels.ts";
import { cut, elapsed } from "../utils/text.ts";
import type { Details } from "../app/details.ts";
import { runRows, type RowModel } from "./band-model.ts";

export type PaneInput = {
  repo: string;
  runs: Run[] | null; // null before the first good poll
  staleSince: number | null;
  now: number;
  columns: number; // the Pane's bodyColumns
  details: (run: Run) => Details; // asked only for the runs that failed or timed out
};

export type PaneLine = { text: string; href: string | null }; // under a run: a failure, or why there is none

export type PaneModel = {
  header: string;
  note: string | null; // instead of rows: still loading, or nothing to list
  rows: { row: RowModel; lines: PaneLine[] }[];
};

const INDENT = "    ";

const lineOf = (text: string, href: string | null, columns: number): PaneLine => ({
  text: INDENT + cut(text, Math.max(1, columns - INDENT.length)), // cut trims, so the indent goes on after
  href,
});

function linesOf(details: Details, columns: number): PaneLine[] {
  const line = (text: string, href: string | null = null) => lineOf(text, href, columns);
  if (details.state === "loading") return [line("loading the jobs…")];
  if (details.state === "failed") return [line(`couldn't read the jobs: ${details.message}`)];
  if (details.failures.length === 0) return [line("no failed job listed")];
  return details.failures.map((failure) =>
    line(`✗ ${failure.step ? `${failure.step} · ${failure.job}` : failure.job}`, failure.url),
  );
}

// A run waiting for approval has no failed job to show, so it points at the run, where it is approved.
function linesFor(run: Run, input: PaneInput): PaneLine[] {
  if (!needsAttention(run)) return [];
  if (run.conclusion === "action_required")
    return [lineOf("waiting for approval: open the run", run.url, input.columns)];
  return linesOf(input.details(run), input.columns);
}

export function paneModel(input: PaneInput): PaneModel {
  const stale = input.staleSince !== null ? ` · gh error for ${elapsed(input.now - input.staleSince)}` : "";
  const runs = input.runs ?? [];
  const tally = counts(runs);
  const header = `${input.repo}${stale}${tally ? ` · ${tally}` : ""}`;
  if (input.runs === null) return { header, note: "Loading the runs…", rows: [] };
  if (runs.length === 0) return { header, note: "No runs from a push, a PR or a dispatch in the last list.", rows: [] };
  const sorted = byAttention(runs);
  const rows = runRows(input.repo, sorted, input.now, input.columns);
  return {
    header,
    note: null,
    rows: sorted.map((run, index) => ({
      row: rows[index],
      lines: linesFor(run, input),
    })),
  };
}
