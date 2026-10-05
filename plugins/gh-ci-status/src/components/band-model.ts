// The band's view model: every rendering decision, as plain data. band.tsx
// maps this to elements and decides nothing, so this is where the drawing is
// tested.
import { inFlight, phase, prNumber, LABEL_WIDTH, type Phase, type Run } from "../core/workflow-run.ts";
import { branchLabel, clock, counts, linkOf, REF_MAX, titleOf, workflowLabel } from "../core/run-labels.ts";
import { cut, elapsed } from "../utils/text.ts";

export type BandInput = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // a recent push with no run yet, or null
  now: number;
  maxRows: number; // rows the band may take, every line of it included
};

// One text cell: a link when `href` is set, plain text otherwise. `pad` is the
// whitespace that aligns the column, kept outside the link.
export type Cell = { text: string; href: string | null; pad: string };

type RowModel = {
  ref: Cell; // #N linking to the PR, or the dim branch name
  phase: Phase;
  workflow: Cell; // links to the run
  clock: string;
  title: Cell | null; // links to the run only when the row has no PR
};

export type BandModel = {
  repo: Cell;
  actions: Cell;
  counts: string;
  waitingFor: string | null; // elapsed since the push, while no run has shown up
  rows: RowModel[];
  hiddenCount: number;
};

const MAX_ROWS = 6; // runs shown at most; the rest go in the "… and N more" line
const WORKFLOW_MAX = 20;
const TITLE_MAX = 60;

const spaces = (count: number) => " ".repeat(Math.max(0, count));
const cell = (text: string, href: string | null, width = text.length): Cell => ({
  text,
  href,
  pad: spaces(width - text.length),
});

// Null when there is nothing to draw: no rows and no push being waited on.
export function bandModel(input: BandInput): BandModel | null {
  const waitingFor =
    input.waitingSince !== null && !input.rows.some(inFlight) ? elapsed(input.now - input.waitingSince) : null;
  if (input.rows.length === 0 && waitingFor === null) return null;

  // The runs get what the header and the waiting line leave; when they don't
  // all fit, one row of that goes to the "more" line. From 3 rows up the tree
  // never grows past maxRows; below that it can, and the engine scrolls it.
  const room = input.maxRows - 1 - (waitingFor !== null ? 1 : 0);
  const fits = input.rows.length <= Math.min(MAX_ROWS, room);
  const shown = input.rows.slice(0, fits ? input.rows.length : Math.max(0, Math.min(MAX_ROWS, room - 1)));
  const refs = shown.map((run) => cut(branchLabel(run), REF_MAX));
  const workflows = shown.map((run) => cut(workflowLabel(run), WORKFLOW_MAX));
  const refWidth = Math.max(0, ...refs.map((ref) => ref.length));
  const workflowWidth = Math.max(0, ...workflows.map((workflow) => workflow.length));

  const rows = shown.map((run, index): RowModel => {
    const hasPr = prNumber(run) !== null;
    const title = cut(titleOf(run), TITLE_MAX);
    const p = phase(run);
    return {
      ref: cell(refs[index], hasPr ? linkOf(input.repo, run) : null, refWidth),
      phase: { ...p, label: cut(p.label, LABEL_WIDTH).padEnd(LABEL_WIDTH) },
      workflow: cell(workflows[index], run.url, workflowWidth),
      clock: clock(run, input.now),
      title: title ? cell(title, hasPr ? null : run.url) : null,
    };
  });

  return {
    repo: cell(input.repo, `https://github.com/${input.repo}`),
    actions: cell("Actions", `https://github.com/${input.repo}/actions`),
    counts: counts(input.rows),
    waitingFor,
    rows,
    hiddenCount: input.rows.length - shown.length,
  };
}
