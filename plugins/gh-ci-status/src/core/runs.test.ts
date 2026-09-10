import { test } from "node:test";
import assert from "node:assert/strict";
import { inFlight, LABEL_WIDTH, phase, prNumber, transitions, visible, withPrs } from "./runs.ts";
import { run, running, T0 } from "./fixtures.ts";

test("inFlight: anything not completed", () => {
  assert.equal(inFlight(running(1)), true);
  assert.equal(inFlight(run({ databaseId: 1, status: "queued" })), true);
  assert.equal(inFlight(run({ databaseId: 1 })), false);
});

test("prNumber: from the pr field, or from refs/pull/N/head", () => {
  assert.equal(prNumber(run({ databaseId: 1, headBranch: "refs/pull/167/head" })), 167);
  assert.equal(prNumber(run({ databaseId: 1, headBranch: "feat/x", pr: 42 })), 42);
  assert.equal(prNumber(run({ databaseId: 1, headBranch: "feat/pull/2" })), null);
  assert.equal(prNumber(run({ databaseId: 1 })), null);
});

test("withPrs: matches by branch; a run with no PR is unchanged", () => {
  const runs = withPrs(
    [run({ databaseId: 1, headBranch: "feat/x" }), run({ databaseId: 2, headBranch: "main" })],
    [{ number: 42, headRefName: "feat/x" }],
  );
  assert.equal(prNumber(runs[0]), 42);
  assert.equal(prNumber(runs[1]), null);
});

test("phase: color per state", () => {
  assert.deepEqual(phase(running(1)), { dot: "◐", label: "Running", color: "yellow" });
  assert.equal(phase(run({ databaseId: 1, status: "queued" })).label, "Queued");
  assert.equal(phase(run({ databaseId: 1 })).color, "green");
  assert.equal(phase(run({ databaseId: 1, conclusion: "failure" })).label, "Failed");
  assert.equal(phase(run({ databaseId: 1, conclusion: "cancelled" })).dot, "⊘");
  assert.equal(phase(run({ databaseId: 1, conclusion: "skipped" })).dim, true);
});

test("phase: every known label fits the column", () => {
  const conclusions = ["success", "failure", "timed_out", "startup_failure", "cancelled"];
  const cases = [
    running(1),
    run({ databaseId: 1, status: "queued" }),
    ...conclusions.map((conclusion) => run({ databaseId: 1, conclusion })),
  ];
  for (const candidate of cases) {
    assert.ok(phase(candidate).label.length <= LABEL_WIDTH, phase(candidate).label);
  }
  assert.equal(phase(run({ databaseId: 1, conclusion: "startup_failure" })).label, "Failed");
  assert.equal(phase(run({ databaseId: 1, conclusion: "timed_out" })).label, "Timed out");
});

test("visible: in flight always; finished only within the hold", () => {
  const holdMs = 5 * 60_000;
  const runs = [
    running(1),
    run({ databaseId: 2, updatedAt: new Date(T0 + 4 * 60_000).toISOString() }),
    run({ databaseId: 3, updatedAt: new Date(T0 - 10 * 60_000).toISOString() }),
  ];
  assert.deepEqual(
    visible(runs, T0 + 5 * 60_000, holdMs).map((candidate) => candidate.databaseId),
    [1, 2],
  );
});

test("transitions: started, finished, and the next set", () => {
  const seen = new Set([1, 2]);
  const changes = transitions(seen, [run({ databaseId: 1 }), running(2), running(3), run({ databaseId: 9 })]);
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
