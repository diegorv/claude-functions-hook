import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLabel, clock, counts, finishedToasts, linkOf, startedToast, titleOf } from "./run-labels.ts";
import { at, run, running, T0 } from "./fixtures.ts";

test("clock: in flight counts up to now; finished shows the duration", () => {
  assert.equal(clock(running(), T0 + 42_000), "0m42s");
  assert.equal(clock(run(), T0 + 3 * 60_000), "1m00s");
});

test("clock: a rerun counts from startedAt", () => {
  const rerun = run({ createdAt: at(-86_400_000), startedAt: at(0), updatedAt: at(42_000) });
  assert.equal(clock(rerun, T0 + 60_000), "0m42s");
});

test("branchLabel and linkOf: the PR when known, the run otherwise", () => {
  const prRun = run({ headBranch: "refs/pull/167/head" });
  assert.equal(branchLabel(prRun), "#167");
  assert.equal(linkOf("a/b", prRun), "https://github.com/a/b/pull/167");
  const pushRun = run({ databaseId: 2 });
  assert.equal(branchLabel(pushRun), "main");
  assert.equal(linkOf("a/b", pushRun), "https://github.com/a/b/actions/runs/1");
});

test("titleOf: empty when it only repeats the #N", () => {
  const prBranch = "refs/pull/167/head";
  assert.equal(titleOf(run({ headBranch: prBranch, displayTitle: "PR #167" })), "");
  assert.equal(titleOf(run({ headBranch: prBranch, displayTitle: "#167" })), "");
  assert.equal(titleOf(run({ headBranch: prBranch, displayTitle: "Fix login" })), "Fix login");
  assert.equal(titleOf(run({ displayTitle: "PR #167" })), "PR #167", "kept when no PR is known");
});

test("counts: non-zero counts only", () => {
  assert.equal(counts([]), "");
  assert.equal(counts([running(), running({ databaseId: 2 }), run({ databaseId: 3 })]), "2 running · 1 finished");
});

test("startedToast: names the workflow and #N, or the branch without a PR", () => {
  assert.equal(startedToast("a/b", running({ pr: 12 })), "⚙ a/b: CI started (#12)");
  assert.equal(startedToast("a/b", running()), "⚙ a/b: CI started (main)");
});

test("finishedToasts: a failure names the workflow, the phase, the clock and #N, for 10 s", () => {
  assert.deepEqual(finishedToasts("a/b", [run({ conclusion: "timed_out", pr: 7 })], T0), [
    { text: "⚙ a/b: CI timed out after 1m00s (#7)", timeoutMs: 10_000 },
  ]);
});

test("finishedToasts: action_required asks, with no clock", () => {
  assert.deepEqual(finishedToasts("a/b", [run({ conclusion: "action_required", pr: 123 })], T0), [
    { text: "⚙ a/b: CI needs you (#123)", timeoutMs: 10_000 },
  ]);
});

test("finishedToasts: one success is named; several are counted; the default timeout", () => {
  assert.deepEqual(finishedToasts("a/b", [run()], T0), [{ text: "⚙ a/b: CI passed after 1m00s (main)" }]);
  assert.deepEqual(finishedToasts("a/b", [run(), run({ databaseId: 2, workflowName: "Lint" })], T0), [
    { text: "⚙ a/b: 2 runs passed" },
  ]);
});

test("finishedToasts: cancelled, skipped and neutral say nothing", () => {
  const quiet = ["cancelled", "skipped", "neutral"].map((conclusion, index) =>
    run({ databaseId: index + 1, conclusion }),
  );
  assert.deepEqual(finishedToasts("a/b", quiet, T0), []);
});
