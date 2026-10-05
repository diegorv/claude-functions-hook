import { test } from "node:test";
import assert from "node:assert/strict";
import { paneModel, type PaneInput } from "./pane-model.ts";
import { run, running, T0 } from "../core/fixtures.ts";
import type { Details } from "../app/details.ts";
import { cells } from "../utils/text.ts";

const input = (overrides: Partial<PaneInput> = {}): PaneInput => ({
  repo: "a/b",
  runs: [],
  staleSince: null,
  now: T0 + 60_000,
  columns: 100,
  details: () => ({ state: "loading" }),
  ...overrides,
});

test("before the first poll it says it is loading; with no runs, that there are none", () => {
  assert.equal(paneModel(input({ runs: null })).note, "Loading the runs…");
  assert.match(paneModel(input()).note ?? "", /^No runs/);
});

test("every run, not capped at 6, failures first", () => {
  const runs = Array.from({ length: 9 }, (_, index) => run({ databaseId: index + 1 }));
  runs.push(run({ databaseId: 10, conclusion: "failure" }));
  const model = paneModel(input({ runs }));
  assert.equal(model.rows.length, 10);
  assert.equal(model.rows[0].row.phase.label.trim(), "Failed");
  assert.equal(model.header, "a/b · 10 finished");
});

test("only the runs that need attention ask for their jobs", () => {
  const asked: number[] = [];
  const details = (candidate: { databaseId: number }): Details => (
    asked.push(candidate.databaseId),
    { state: "loading" }
  );
  const model = paneModel(
    input({ runs: [running(), run({ databaseId: 2, conclusion: "failure" }), run({ databaseId: 3 })], details }),
  );
  assert.deepEqual(asked, [2]);
  assert.deepEqual(
    model.rows.map((entry) => entry.lines.length),
    [0, 1, 0],
  );
  assert.equal(model.rows[1].lines[0].text.trim(), "loading the jobs…");
});

test("each failed job and step is a line linking to the job; errors and empty lists say so", () => {
  const failed = run({ conclusion: "failure" });
  const loaded: Details = {
    state: "loaded",
    failures: [
      { job: "test", step: "Run npm test", url: "u1" },
      { job: "build", step: null, url: "u2" },
    ],
  };
  const lines = paneModel(input({ runs: [failed], details: () => loaded })).rows[0].lines;
  assert.deepEqual(lines, [
    { text: "    ✗ Run npm test · test", href: "u1" },
    { text: "    ✗ build", href: "u2" },
  ]);
  const error = paneModel(input({ runs: [failed], details: () => ({ state: "failed", message: "boom" }) }));
  assert.equal(error.rows[0].lines[0].text.trim(), "couldn't read the jobs: boom");
  const none = paneModel(input({ runs: [failed], details: () => ({ state: "loaded", failures: [] }) }));
  assert.equal(none.rows[0].lines[0].text.trim(), "no failed job listed");
});

test("lines fit the pane's width; the header shows a gh outage", () => {
  const failed = run({ conclusion: "failure" });
  const long: Details = { state: "loaded", failures: [{ job: "j".repeat(80), step: "s".repeat(80), url: "u" }] };
  const model = paneModel(input({ runs: [failed], details: () => long, columns: 40, staleSince: T0 }));
  assert.ok(cells(model.rows[0].lines[0].text) <= 40);
  assert.equal(model.header, "a/b · gh error for 1m00s · 1 finished");
});

test("a run waiting for approval points at the run, and asks for no jobs", () => {
  const asked: number[] = [];
  const waiting = run({ conclusion: "action_required", url: "https://github.com/a/b/actions/runs/5" });
  const model = paneModel(
    input({ runs: [waiting], details: (candidate) => (asked.push(candidate.databaseId), { state: "loading" }) }),
  );
  assert.deepEqual(model.rows[0].lines, [
    { text: "    waiting for approval: open the run", href: "https://github.com/a/b/actions/runs/5" },
  ]);
  assert.deepEqual(asked, []);
});
