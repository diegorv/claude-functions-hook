import { test } from "node:test";
import assert from "node:assert/strict";
import { inFlight, LABEL_WIDTH, phase, prNumber, transitions, visible, withPrs } from "./workflow-run.ts";
import { at, run, running, T0 } from "./fixtures.ts";

test("inFlight: anything not completed", () => {
  assert.equal(inFlight(running()), true);
  assert.equal(inFlight(run({ status: "queued" })), true);
  assert.equal(inFlight(run()), false);
});

test("prNumber: from the pr field, or from refs/pull/N/head", () => {
  assert.equal(prNumber(run({ headBranch: "refs/pull/167/head" })), 167);
  assert.equal(prNumber(run({ headBranch: "feat/x", pr: 42 })), 42);
  assert.equal(prNumber(run({ headBranch: "feat/pull/2" })), null);
  assert.equal(prNumber(run()), null);
});

test("withPrs: matches by branch; a run with no PR is unchanged", () => {
  const runs = withPrs(
    [run({ headBranch: "feat/x" }), run({ databaseId: 2, headBranch: "main" })],
    [{ number: 42, headRefName: "feat/x" }],
  );
  assert.equal(prNumber(runs[0]), 42);
  assert.equal(prNumber(runs[1]), null);
});

test("phase: color per state", () => {
  assert.deepEqual(phase(running()), { dot: "◐", label: "Running", color: "yellow" });
  assert.equal(phase(run({ status: "queued" })).label, "Queued");
  assert.equal(phase(run()).color, "green");
  assert.equal(phase(run({ conclusion: "failure" })).label, "Failed");
  assert.equal(phase(run({ conclusion: "cancelled" })).dot, "⊘");
  assert.equal(phase(run({ conclusion: "skipped" })).dim, true);
});

test("phase: every known label fits the column", () => {
  const conclusions = ["success", "failure", "timed_out", "startup_failure", "cancelled"];
  const cases = [running(), run({ status: "queued" }), ...conclusions.map((conclusion) => run({ conclusion }))];
  for (const candidate of cases) {
    assert.ok(phase(candidate).label.length <= LABEL_WIDTH, phase(candidate).label);
  }
  assert.equal(phase(run({ conclusion: "startup_failure" })).label, "Failed");
  assert.equal(phase(run({ conclusion: "timed_out" })).label, "Timed out");
});

test("visible: in flight always; finished only within the hold", () => {
  const holdMs = 5 * 60_000;
  const runs = [
    running(),
    run({ databaseId: 2, updatedAt: at(4 * 60_000) }),
    run({ databaseId: 3, updatedAt: at(-10 * 60_000) }),
  ];
  assert.deepEqual(
    visible(runs, T0 + 5 * 60_000, holdMs).map((candidate) => candidate.databaseId),
    [1, 2],
  );
});

test("transitions: started, finished, and the next set", () => {
  const seen = new Set([1, 2]);
  const changes = transitions(seen, [
    run(),
    running({ databaseId: 2 }),
    running({ databaseId: 3 }),
    run({ databaseId: 9 }),
  ]);
  assert.deepEqual(
    changes.started.map((candidate) => candidate.databaseId),
    [3],
  );
  assert.deepEqual(
    changes.finished.map((candidate) => candidate.databaseId),
    [1],
  );
  assert.deepEqual([...changes.seen], [2, 3]);
  assert.deepEqual([...seen], [1, 2], "does not mutate the old set");
});
