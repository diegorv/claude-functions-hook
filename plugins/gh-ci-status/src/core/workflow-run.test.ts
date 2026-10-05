import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attemptStartedAt,
  byAttention,
  inFlight,
  jobFailures,
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

// A real merge_group headBranch, from `gh run list -R Homebrew/brew --event merge_group`.
test("prNumber: from a merge queue branch, gh-readonly-queue/<base>/pr-N-<sha>", () => {
  assert.equal(
    prNumber(run({ headBranch: "gh-readonly-queue/main/pr-24172-5327ac6226b259291d4b66139b3f357f69d38e95" })),
    24172,
  );
  assert.equal(prNumber(run({ headBranch: "gh-readonly-queue/release/2.x/pr-7-abc123" })), 7);
  assert.equal(prNumber(run({ headBranch: "gh-readonly-queue/main" })), null);
  assert.equal(prNumber(run({ headBranch: "feat/pr-12-abc" })), null);
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

const holds = { holdMs: 5 * 60_000, failedHoldMs: 30 * 60_000 };
const ids = (runs: { databaseId: number }[]) => runs.map((candidate) => candidate.databaseId);

test("visible: in flight always; finished only within the hold", () => {
  const runs = [
    running(),
    run({ databaseId: 2, updatedAt: at(4 * 60_000) }),
    run({ databaseId: 3, updatedAt: at(-10 * 60_000) }),
  ];
  assert.deepEqual(ids(visible(runs, T0 + 5 * 60_000, holds)), [1, 2]);
});

test("visible: what needs attention stays up to 30 minutes, the rest 5", () => {
  const runs = ["failure", "timed_out", "startup_failure", "action_required", "success", "cancelled"].map(
    (conclusion, index) => run({ databaseId: index + 1, workflowName: `W${index}`, conclusion, updatedAt: at(0) }),
  );
  assert.deepEqual(ids(visible(runs, T0 + 10 * 60_000, holds)), [1, 2, 3, 4]);
  assert.deepEqual(ids(visible(runs, T0 + 30 * 60_000, holds)), []);
});

test("visible: a failure leaves once a newer run of the same workflow and branch shows up", () => {
  const failed = run({ databaseId: 1, conclusion: "failure", createdAt: at(0), updatedAt: at(60_000) });
  const later = T0 + 10 * 60_000;
  const retry = running({ databaseId: 2, createdAt: at(5 * 60_000) });
  assert.deepEqual(ids(visible([retry, failed], later, holds)), [2], "a newer run in flight replaces it");
  const fixed = run({ databaseId: 2, createdAt: at(5 * 60_000), updatedAt: at(6 * 60_000) });
  assert.deepEqual(ids(visible([fixed, failed], later, holds)), [2], "so does a newer one that finished");
  const otherBranch = running({ databaseId: 3, headBranch: "other", createdAt: at(5 * 60_000) });
  const otherWorkflow = running({ databaseId: 4, workflowDatabaseId: 20, createdAt: at(5 * 60_000) });
  assert.deepEqual(ids(visible([otherBranch, otherWorkflow, failed], later, holds)), [3, 4, 1]);
  const older = run({ databaseId: 5, createdAt: at(-60_000), updatedAt: at(-30_000) });
  assert.deepEqual(ids(visible([failed, older], later, holds)), [1], "an older run does not");
});

test("visible: a newer push run does not hide a failed pull_request run of the same workflow and branch", () => {
  const failed = run({ databaseId: 1, event: "pull_request", conclusion: "failure", updatedAt: at(60_000) });
  const push = running({ databaseId: 2, event: "push", createdAt: at(5 * 60_000) });
  assert.deepEqual(ids(visible([push, failed], T0 + 10 * 60_000, holds)), [2, 1]);
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

test("attemptStartedAt: a rerun's startedAt; createdAt when startedAt is missing", () => {
  assert.equal(attemptStartedAt(run({ createdAt: at(0), startedAt: at(600_000) })), T0 + 600_000);
  assert.equal(attemptStartedAt(run({ createdAt: at(0), startedAt: "" })), T0);
  assert.equal(attemptStartedAt(run({ createdAt: at(0), startedAt: "0001-01-01T00:00:00Z" })), T0);
});

test("visible: a rerun of an older run does not end a later failure", () => {
  const holds = { holdMs: 5 * 60_000, failedHoldMs: 30 * 60_000 };
  const failed = run({
    databaseId: 2,
    conclusion: "failure",
    createdAt: at(0),
    startedAt: at(0),
    updatedAt: at(60_000),
  });
  const rerunOfOlder = running({ databaseId: 1, createdAt: at(-600_000), startedAt: at(120_000) });
  assert.deepEqual(
    visible([failed, rerunOfOlder], T0 + 180_000, holds).map((candidate) => candidate.databaseId),
    [2, 1],
  );
});

test("jobFailures: the failed jobs, each with its first failed step, linking to the job", () => {
  const jobs = [
    { databaseId: 1, name: "lint", conclusion: "success", steps: [] },
    {
      databaseId: 2,
      name: "test",
      conclusion: "failure",
      steps: [
        { name: "Set up job", conclusion: "success" },
        { name: "Run npm test", conclusion: "failure" },
        { name: "Post", conclusion: "skipped" },
      ],
    },
    { databaseId: 3, name: "e2e", conclusion: "timed_out", steps: [{ name: "Run", conclusion: "success" }] },
  ];
  assert.deepEqual(jobFailures(run(), jobs), [
    { job: "test", step: "Run npm test", url: "https://github.com/a/b/actions/runs/1/job/2" },
    { job: "e2e", step: null, url: "https://github.com/a/b/actions/runs/1/job/3" },
  ]);
});

test("jobFailures: the job's own url when gh gives one", () => {
  const job = {
    databaseId: 2,
    name: "test",
    conclusion: "failure",
    steps: [],
    url: "https://github.com/a/b/actions/runs/1/job/77",
  };
  assert.equal(jobFailures(run(), [job])[0].url, "https://github.com/a/b/actions/runs/1/job/77");
});
