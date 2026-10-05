import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byAttention,
  inFlight,
  LABEL_WIDTH,
  phase,
  prNumber,
  startedByPerson,
  transitions,
  visible,
  withPrs,
} from "./workflow-run.ts";
import { at, run, running, T0 } from "./fixtures.ts";

test("inFlight: anything not completed", () => {
  assert.equal(inFlight(running()), true);
  assert.equal(inFlight(run({ status: "queued" })), true);
  assert.equal(inFlight(run()), false);
});

test("startedByPerson: push and PR runs yes, schedule and issue_comment no", () => {
  assert.equal(startedByPerson(run({ event: "push" })), true);
  assert.equal(startedByPerson(run({ event: "pull_request" })), true);
  assert.equal(startedByPerson(run({ event: "schedule" })), false);
  assert.equal(startedByPerson(run({ event: "issue_comment" })), false);
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
    [{ number: 42, headRefName: "feat/x", isCrossRepository: false }],
  );
  assert.equal(prNumber(runs[0]), 42);
  assert.equal(prNumber(runs[1]), null);
});

test("withPrs: a fork PR never matches by branch", () => {
  const prs = [{ number: 14218, headRefName: "trunk", isCrossRepository: true }];
  assert.equal(prNumber(withPrs([run({ headBranch: "trunk" })], prs)[0]), null);
});

test("withPrs: a branch reused by two PRs gets the newest", () => {
  const prs = [
    { number: 14397, headRefName: "fix-workflow", isCrossRepository: false },
    { number: 14347, headRefName: "fix-workflow", isCrossRepository: false },
  ];
  assert.equal(prNumber(withPrs([run({ headBranch: "fix-workflow" })], prs)[0]), 14397);
});

test("phase: color per state, by theme key; failures raw red", () => {
  assert.deepEqual(phase(running()), { dot: "◐", label: "Running", color: "warning" });
  assert.equal(phase(run({ status: "queued" })).label, "Queued");
  assert.equal(phase(run({ status: "queued" })).color, "warning");
  assert.equal(phase(run()).color, "success");
  assert.equal(phase(run({ conclusion: "failure" })).label, "Failed");
  assert.equal(phase(run({ conclusion: "failure" })).color, "red");
  assert.equal(phase(run({ conclusion: "timed_out" })).color, "red");
  assert.equal(phase(run({ conclusion: "cancelled" })).dot, "⊘");
  assert.equal(phase(run({ conclusion: "cancelled" })).color, "inactive");
  assert.equal(phase(run({ conclusion: "skipped" })).color, "inactive");
  assert.equal(phase(run({ conclusion: "some_new_state" })).color, "inactive");
  assert.equal(phase(run({ conclusion: "startup_failure" })).label, "Failed");
  assert.equal(phase(run({ conclusion: "timed_out" })).label, "Timed out");
});

test("phase: every conclusion gets a capitalized label that fits the column", () => {
  assert.equal(LABEL_WIDTH, 9, "the column does not grow");
  for (const conclusion of ["skipped", "neutral", "stale", "action_required"]) {
    const label = phase(run({ conclusion })).label;
    assert.match(label, /^[A-Z]/);
    assert.ok(label.length <= LABEL_WIDTH, label);
  }
  assert.equal(phase(run({ conclusion: "some_new_state" })).label, "Some new state");
  assert.equal(phase(run({ conclusion: null })).label, "Done");
});

test("phase: action_required asks for attention; skipped stays inactive", () => {
  assert.deepEqual(phase(run({ conclusion: "action_required" })), { dot: "!", label: "Needs you", color: "warning" });
  assert.equal(phase(run({ conclusion: "skipped" })).color, "inactive");
});

test("phase: a run waiting on a deployment says so", () => {
  assert.deepEqual(phase(run({ status: "waiting", conclusion: null })), {
    dot: "○",
    label: "Waiting",
    color: "warning",
  });
});

test("byAttention: in flight, then failed or waiting on someone, then the rest; gh's order within each", () => {
  const runs = [
    run({ databaseId: 1 }),
    run({ databaseId: 2, conclusion: "failure" }),
    running({ databaseId: 3 }),
    run({ databaseId: 4, conclusion: "cancelled" }),
    run({ databaseId: 5, conclusion: "timed_out" }),
    run({ databaseId: 6, status: "queued", conclusion: null }),
    run({ databaseId: 7, conclusion: "action_required" }),
    run({ databaseId: 8, conclusion: "skipped" }),
  ];
  assert.deepEqual(
    byAttention(runs).map((candidate) => candidate.databaseId),
    [3, 6, 2, 5, 7, 1, 4, 8],
  );
  assert.equal(runs[0].databaseId, 1, "the input is left as it was");
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
