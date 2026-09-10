import { test } from "node:test";
import assert from "node:assert/strict";
import { bandModel, type BandInput } from "./band-model.ts";
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

test("long refs and titles are cut; rows beyond maxRows are counted", () => {
  const rows = [1, 2, 3].map((id) => run({ databaseId: id, headBranch: "x".repeat(40), displayTitle: "y".repeat(80) }));
  const model = bandModel(input({ rows, maxRows: 2 }))!;
  assert.equal(model.rows.length, 2);
  assert.equal(model.hiddenCount, 1);
  assert.equal(model.rows[0].ref.text.length, 24);
  assert.equal(model.rows[0].title?.text.length, 60);
});

test("an unknown conclusion still fits the status column", () => {
  const [row] = bandModel(input({ rows: [run({ conclusion: "action_required" })] }))!.rows;
  assert.equal(row.phase.label.length, LABEL_WIDTH);
});

test("finished rows keep their duration; updatedAt is the end", () => {
  const [row] = bandModel(input({ rows: [run({ updatedAt: at(189_000) })] }))!.rows;
  assert.equal(row.clock, "3m09s");
});
