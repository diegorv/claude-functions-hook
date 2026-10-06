// The pane's view model: the header's counts and one line per row of the tree,
// with how each line is styled. pane.tsx maps it to elements and decides nothing.
import { isEnded, type FlowState, type Status } from "../core/flow.ts";
import { countsOf, rowsOf, type Row } from "../core/rows.ts";

export type PaneLine = { text: string; color: string | null; isDim: boolean; isBold: boolean };

export type PaneModel = {
  header: string;
  lines: PaneLine[];
  note: string | null; // under the main loop while no agent has been seen
};

const GLYPHS: Record<Status, string> = {
  pending: "○",
  running: "●",
  waiting: "◐",
  idle: "○",
  completed: "✓",
  failed: "✗",
  killed: "⊘",
  gone: "?",
};

// Theme keys, so they follow the person's theme, except failures: raw red, as gh-ci-status does.
// A running row is uncolored: the colors are kept for what is done or needs attention.
const STATUS_COLORS: Partial<Record<Status, string>> = {
  completed: "success",
  failed: "red",
};
const SIGNAL_COLORS = { approval: "permission", "slow-tool": "warning", stale: "warning" } as const;

// `● Explore: find the bug · running 12s · Bash 3s · 4 calls`; the main loop
// reads `● main · running 12s · Bash 3s`, or `○ main · idle`.
function textOf(row: Row): string {
  const isRoot = row.depth === 0;
  const name = isRoot ? "main" : row.label ? `${row.type}: ${row.label}` : row.type;
  const clock = isRoot && row.status === "idle" ? "" : ` ${row.elapsed}`;
  const parts = [
    `${"  ".repeat(row.depth)}${GLYPHS[row.status]} ${name}`,
    `${row.status}${clock}`,
    row.activity,
    isRoot || row.toolCalls === 0 ? null : `${row.toolCalls} ${row.toolCalls === 1 ? "call" : "calls"}`,
    row.tokens,
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

// A row that needs attention takes its signal's color and bold; an ended one is dimmed.
const lineOf = (row: Row): PaneLine => ({
  text: textOf(row),
  color: row.signal ? SIGNAL_COLORS[row.signal] : (STATUS_COLORS[row.status] ?? null),
  isDim: row.signal === null && isEnded(row.status),
  isBold: row.signal !== null,
});

export function paneModel(state: FlowState, now: number): PaneModel {
  const counts = countsOf(state);
  const rows = rowsOf(state, now);
  return {
    header: `${counts.running} running · ${counts.done} done · ${counts.waiting} waiting`,
    lines: rows.map(lineOf),
    note: rows.length === 1 ? "No subagent or teammate yet." : null,
  };
}
