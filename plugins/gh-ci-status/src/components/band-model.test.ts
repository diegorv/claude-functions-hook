import { test } from "node:test";
import assert from "node:assert/strict";
import { bandModel, type BandInput, type BandModel } from "./band-model.ts";
import { at, run, running, T0 } from "../core/fixtures.ts";
import { LABEL_WIDTH } from "../core/workflow-run.ts";

const input = (overrides: Partial<BandInput> = {}): BandInput => ({
  repo: "a/b",
  rows: [],
  waitingSince: null,
  now: T0 + 60_000,
  maxRows: 6,
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
  assert.equal(row.workflow.href, "https://github.com/a/b/actions/runs/1");
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
  assert.equal(short.workflow.pad, " ".repeat("Privacy".length - "CI".length));
});

test("long refs and titles are cut", () => {
  const rows = [run({ headBranch: "x".repeat(40), displayTitle: "y".repeat(80) })];
  const model = bandModel(input({ rows }))!;
  assert.equal(model.rows[0].ref.text.length, 24);
  assert.equal(model.rows[0].title?.text.length, 60);
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
  assert.equal(bandModel(input({ rows: [run({ workflowName: "" })] }))!.rows[0].workflow.text, "workflow");
});

test("an unknown conclusion still fits the status column", () => {
  const [row] = bandModel(input({ rows: [run({ conclusion: "action_required" })] }))!.rows;
  assert.equal(row.phase.label.length, LABEL_WIDTH);
});

test("finished rows keep their duration; updatedAt is the end", () => {
  const [row] = bandModel(input({ rows: [run({ updatedAt: at(189_000) })] }))!.rows;
  assert.equal(row.clock, "3m09s");
});
