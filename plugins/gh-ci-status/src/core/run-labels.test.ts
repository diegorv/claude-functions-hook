import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLabel, clock, counts, linkOf, titleOf } from "./run-labels.ts";
import { at, run, running, T0 } from "./fixtures.ts";

test("clock: in flight counts up to now; finished shows the duration", () => {
  assert.equal(clock(running(), T0 + 42_000), "0m42s");
  assert.equal(clock(run(), T0 + 3 * 60_000), "1m00s");
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
