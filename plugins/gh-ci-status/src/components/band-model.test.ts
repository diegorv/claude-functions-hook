import { test } from "node:test";
import assert from "node:assert/strict";
import { bandModel, columnWidths, type BandInput, type BandModel } from "./band-model.ts";
import { at, run, running, T0 } from "../core/fixtures.ts";
import { LABEL_WIDTH } from "../core/workflow-run.ts";
import { cells } from "../utils/text.ts";

const input = (overrides: Partial<BandInput> = {}): BandInput => ({
  repo: "a/b",
  rows: [],
  waitingSince: null,
  now: T0 + 60_000,
  maxRows: 6,
  columns: 120,
  ...overrides,
});

test("null when there is nothing to draw", () => {
  assert.equal(bandModel(input()), null);
});

test("header: repo and Actions link; counts follow", () => {
  const model = bandModel(input({ rows: [running(), run({ databaseId: 2 })] }))!;
  assert.deepEqual(model.repo, { text: "a/b", href: "https://github.com/a/b", pad: "" });
  assert.equal(model.actions.href, "https://github.com/a/b/actions");
  assert.equal(model.counts, "1 running · 1 finished");
});

test("waiting: shown only after a push with nothing in flight", () => {
  assert.equal(bandModel(input({ waitingSince: T0 }))!.waitingFor, "1m00s");
  assert.equal(bandModel(input({ waitingSince: T0, rows: [running()] }))!.waitingFor, null);
});

test("a row with a PR: #N links to the PR, the title is plain text", () => {
  const model = bandModel(input({ rows: [running({ headBranch: "refs/pull/167/head" })] }))!;
  const [row] = model.rows;
  assert.deepEqual(row.ref, { text: "#167", href: "https://github.com/a/b/pull/167", pad: "" });
  assert.deepEqual(row.title, { text: "Fix login", href: null, pad: "" });
  assert.equal(row.workflow?.href, "https://github.com/a/b/actions/runs/1");
  assert.equal(row.clock, "1m00s");
  assert.equal(row.phase.label, "Running  ");
});

test("a row without a PR: the branch is plain, the title links to the run", () => {
  const [row] = bandModel(input({ rows: [run()] }))!.rows;
  assert.equal(row.ref.href, null);
  assert.equal(row.title?.href, "https://github.com/a/b/actions/runs/1");
});

test("a title that only repeats #N is dropped", () => {
  const [row] = bandModel(input({ rows: [run({ headBranch: "refs/pull/9/head", displayTitle: "PR #9" })] }))!.rows;
  assert.equal(row.title, null);
});

test("columns pad to the widest row, outside the link", () => {
  const rows = [
    run({ headBranch: "main", workflowName: "CI" }),
    run({ databaseId: 2, headBranch: "feature/long-name", workflowName: "Privacy" }),
  ];
  const [short, long] = bandModel(input({ rows }))!.rows;
  assert.equal(short.ref.pad, " ".repeat("feature/long-name".length - "main".length));
  assert.equal(long.ref.pad, "");
  assert.equal(short.workflow?.pad, " ".repeat("Privacy".length - "CI".length));
});

test("long refs are cut to 24 cells; the title takes what the row has left", () => {
  const rows = [run({ headBranch: "x".repeat(40), displayTitle: "y".repeat(200) })];
  const [row] = bandModel(input({ rows }))!.rows;
  assert.equal(row.ref.text.length, 24);
  assert.equal(row.title?.text.length, 120 - (24 + 2 + 2 + LABEL_WIDTH + 2 + 2 + 2 + 5 + 2)); // ref, phase, "CI", clock, gaps
});

test("columnWidths: the title goes first, then the workflow, then the ref is cut", () => {
  const needed = { ref: 4, workflow: 7, clock: 5, title: 20 };
  // ref 4 + phase 11 + clock 5 + two gaps = 24; the workflow takes 9 more, the title 22.
  assert.deepEqual(columnWidths(needed, 120), needed);
  assert.deepEqual(columnWidths(needed, 45), { ...needed, title: 10 }, "a title cut to its floor");
  assert.deepEqual(columnWidths(needed, 44), { ...needed, title: 0 }, "under its floor the title goes");
  assert.deepEqual(columnWidths(needed, 33), { ...needed, title: 0 });
  assert.deepEqual(columnWidths(needed, 30), { ...needed, workflow: 0, title: 0 }, "then the workflow");
  assert.deepEqual(columnWidths({ ...needed, ref: 20 }, 30), { ref: 10, workflow: 0, clock: 5, title: 0 });
  assert.equal(columnWidths({ ...needed, ref: 20 }, 10).ref, 6, "the ref stops at its floor");
});

test("columnWidths: a short workflow or title shows whole when it fits", () => {
  assert.equal(columnWidths({ ref: 4, workflow: 2, clock: 5, title: 3 }, 24 + 4 + 5).workflow, 2);
  assert.equal(columnWidths({ ref: 4, workflow: 2, clock: 5, title: 3 }, 24 + 4 + 5).title, 3);
});

const rowCells = (row: BandModel["rows"][number]) =>
  cells(row.ref.text + row.ref.pad) +
  2 +
  cells(`${row.phase.dot} ${row.phase.label}`) +
  (row.workflow ? 2 + cells(row.workflow.text + row.workflow.pad) : 0) +
  2 +
  cells(row.clock) +
  (row.title ? 2 + cells(row.title.text) : 0);

test("every row fits the band's width, and the status keeps its label", () => {
  const rows = [
    running({ headBranch: "refs/pull/167/head", workflowName: "🚀 Deploy production", displayTitle: "修正: ログイン" }),
    run({ databaseId: 2, headBranch: "dependabot/npm_and_yarn/x-1.2.3", conclusion: "timed_out" }),
  ];
  for (let columns = 30; columns <= 140; columns++) {
    for (const row of bandModel(input({ rows, columns }))!.rows) {
      assert.ok(rowCells(row) <= columns, `${rowCells(row)} cells in ${columns}`);
      assert.equal(row.phase.label.trim().length > 0, true);
      assert.equal(row.phase.label.length, LABEL_WIDTH);
    }
  }
});

test("a row too narrow for its workflow links its status to the run instead", () => {
  const [wide] = bandModel(input({ rows: [run()] }))!.rows;
  assert.equal(wide.phase.href, null);
  const [narrow] = bandModel(input({ rows: [run()], columns: 24 }))!.rows; // ref, status and clock only
  assert.equal(narrow.workflow, null);
  assert.equal(narrow.title, null);
  assert.equal(narrow.phase.href, "https://github.com/a/b/actions/runs/1");
});

test("the clock column pads to the widest clock shown", () => {
  const rows = [running(), run({ databaseId: 2, updatedAt: at(725_000) })];
  const [short, long] = bandModel(input({ rows }))!.rows;
  assert.equal(short.clock, " 1m00s");
  assert.equal(long.clock, "12m05s");
});

const runs = (count: number) => Array.from({ length: count }, (_, index) => run({ databaseId: index + 1 }));
const drawn = (model: BandModel) =>
  1 + (model.waitingFor !== null ? 1 : 0) + model.rows.length + (model.hiddenCount > 0 ? 1 : 0);

test("rows: every run that fits under the header, with no 'more' line", () => {
  const model = bandModel(input({ rows: runs(3), maxRows: 4 }))!;
  assert.equal(model.rows.length, 3);
  assert.equal(model.hiddenCount, 0);
});

test("rows: when they don't fit, the last row of the band says how many were cut", () => {
  const model = bandModel(input({ rows: runs(4), maxRows: 4 }))!;
  assert.equal(model.rows.length, 2); // header, 2 runs, the "more" line
  assert.equal(model.hiddenCount, 2);
  assert.ok(drawn(model) <= 4);
});

test("rows: the waiting line takes a row only while it shows", () => {
  const model = bandModel(input({ rows: runs(3), maxRows: 4, waitingSince: T0 }))!;
  assert.equal(model.rows.length, 1); // header, waiting line, 1 run, the "more" line
  assert.equal(model.hiddenCount, 2);
  assert.ok(drawn(model) <= 4);
});

test("rows: at most 6 runs, however tall the band may be", () => {
  const model = bandModel(input({ rows: runs(8), maxRows: 40 }))!;
  assert.equal(model.rows.length, 6);
  assert.equal(model.hiddenCount, 2);
  assert.ok(drawn(model) <= 40);
  assert.equal(bandModel(input({ rows: runs(6), maxRows: 7 }))!.hiddenCount, 0);
});

test("rows: a band with room for the header only counts every run", () => {
  const model = bandModel(input({ rows: runs(3), maxRows: 2 }))!;
  assert.equal(model.rows.length, 0);
  assert.equal(model.hiddenCount, 3);
  assert.ok(drawn(model) <= 2);
});

test("rows: below 3 rows the waiting line can push the band one row past maxRows", () => {
  const model = bandModel(input({ rows: runs(3), maxRows: 2, waitingSince: T0 }))!;
  assert.equal(model.rows.length, 0);
  assert.equal(model.hiddenCount, 3);
  assert.equal(drawn(model), 3); // header, waiting line, the "more" line: the engine scrolls it
});

test("a run without a workflow name still gets a label", () => {
  assert.equal(bandModel(input({ rows: [run({ workflowName: "" })] }))!.rows[0].workflow?.text, "workflow");
});

test("an unknown conclusion still fits the status column", () => {
  const [row] = bandModel(input({ rows: [run({ conclusion: "action_required" })] }))!.rows;
  assert.equal(row.phase.label.length, LABEL_WIDTH);
});

test("finished rows keep their duration; updatedAt is the end", () => {
  const [row] = bandModel(input({ rows: [run({ updatedAt: at(189_000) })] }))!.rows;
  assert.equal(row.clock, "3m09s");
});
