// The band's view model: every rendering decision, as plain data. band.tsx
// maps this to elements and decides nothing, so this is where the drawing is
// tested.
import { byAttention, inFlight, phase, prNumber, LABEL_WIDTH, type Phase, type Run } from "../core/workflow-run.ts";
import { branchLabel, clock, counts, linkOf, REF_MAX, titleOf, workflowLabel } from "../core/run-labels.ts";
import { cells, cut, elapsed } from "../utils/text.ts";

export type BandInput = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // a recent push with no run yet, or null
  now: number;
  maxRows: number; // rows the band may take, every line of it included
  columns: number; // cells a row may take: the AbovePrompt's bodyColumns
};

// One text cell: a link when `href` is set, plain text otherwise. `pad` is the
// whitespace that aligns the column, kept outside the link.
export type Cell = { text: string; href: string | null; pad: string };

type RowModel = {
  ref: Cell; // #N linking to the PR, or the dim branch name
  phase: Phase & { href: string | null }; // links to the run when the workflow is dropped
  workflow: Cell | null; // links to the run; null when the band is too narrow
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
const GAP = 2; // between the row's columns (band.tsx)
const PHASE_CELLS = 2 + LABEL_WIDTH; // the dot, a space, the label
const REF_FLOOR = 6; // "#12345"
const WORKFLOW_FLOOR = 8;
const TITLE_FLOOR = 10;

const spaces = (count: number) => " ".repeat(Math.max(0, count));
const cell = (text: string, href: string | null, width = cells(text)): Cell => ({
  text,
  href,
  pad: spaces(width - cells(text)),
});

type Widths = { ref: number; workflow: number; clock: number; title: number };

// Cells for each column of a row `columns` wide, given what the widest of each
// needs. The ref, the phase and the clock always show; the workflow gets what
// is left, then the title, each dropped (0) when that is under its floor. When
// even the three do not fit, the ref is cut, down to its floor, and the
// workflow and the title are dropped.
export function columnWidths(needed: Widths, columns: number): Widths {
  let left = columns - needed.ref - GAP - PHASE_CELLS - GAP - needed.clock;
  const ref = left >= 0 ? needed.ref : Math.max(Math.min(needed.ref, REF_FLOOR), needed.ref + left);
  const fit = (want: number, floor: number) => {
    const room = Math.min(want, left - GAP);
    if (want === 0 || room < Math.min(want, floor)) return 0;
    left -= GAP + room;
    return room;
  };
  const workflow = fit(needed.workflow, WORKFLOW_FLOOR);
  return { ref, workflow, clock: needed.clock, title: fit(needed.title, TITLE_FLOOR) };
}

const widest = (texts: string[]) => Math.max(0, ...texts.map(cells));

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
  // Sorted before the cut, so a failure is never the row the cap hides.
  const shown = byAttention(input.rows).slice(0, fits ? input.rows.length : Math.max(0, Math.min(MAX_ROWS, room - 1)));
  const refs = shown.map((run) => cut(branchLabel(run), REF_MAX));
  const workflows = shown.map((run) => cut(workflowLabel(run), WORKFLOW_MAX));
  const clocks = shown.map((run) => clock(run, input.now));
  const titles = shown.map((run) => cut(titleOf(run), Infinity));
  const width = columnWidths(
    { ref: widest(refs), workflow: widest(workflows), clock: widest(clocks), title: widest(titles) },
    input.columns,
  );

  const rows = shown.map((run, index): RowModel => {
    const hasPr = prNumber(run) !== null;
    const p = phase(run);
    return {
      ref: cell(cut(refs[index], width.ref), hasPr ? linkOf(input.repo, run) : null, width.ref),
      phase: { ...p, label: cut(p.label, LABEL_WIDTH).padEnd(LABEL_WIDTH), href: width.workflow ? null : run.url },
      workflow: width.workflow ? cell(cut(workflows[index], width.workflow), run.url, width.workflow) : null,
      clock: clocks[index].padStart(width.clock),
      title: width.title && titles[index] ? cell(cut(titles[index], width.title), hasPr ? null : run.url) : null,
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
