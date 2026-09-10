import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLabel, clock, counts, cut, elapsed, linkOf, titleOf } from "./format.ts";
import { run, running, T0 } from "./fixtures.ts";

test("elapsed: fixed width, zero padded", () => {
  assert.equal(elapsed(-5), "0m00s");
  assert.equal(elapsed(9_000), "0m09s");
  assert.equal(elapsed(42_000), "0m42s");
  assert.equal(elapsed(189_000), "3m09s");
  assert.equal(elapsed(3_723_000), "1h02m");
});

test("cut: first line, with an ellipsis", () => {
  assert.equal(cut("abc\ndef", 10), "abc");
  assert.equal(cut("abcdefghij", 5), "abcd…");
});

test("clock: in flight counts up to now; finished shows the duration", () => {
  assert.equal(clock(running(1), T0 + 42_000), "0m42s");
  assert.equal(clock(run({ databaseId: 1 }), T0 + 3 * 60_000), "1m00s");
});

test("branchLabel and linkOf: the PR when known, the run otherwise", () => {
  const prRun = run({ databaseId: 1, headBranch: "refs/pull/167/head" });
  assert.equal(branchLabel(prRun), "#167");
  assert.equal(linkOf("a/b", prRun), "https://github.com/a/b/pull/167");
  const pushRun = run({ databaseId: 2 });
  assert.equal(branchLabel(pushRun), "main");
  assert.equal(linkOf("a/b", pushRun), "https://github.com/a/b/actions/runs/1");
});

test("titleOf: empty when it only repeats the #N", () => {
  const prBranch = "refs/pull/167/head";
  assert.equal(titleOf(run({ databaseId: 1, headBranch: prBranch, displayTitle: "PR #167" })), "");
  assert.equal(titleOf(run({ databaseId: 1, headBranch: prBranch, displayTitle: "#167" })), "");
  assert.equal(titleOf(run({ databaseId: 1, headBranch: prBranch, displayTitle: "Fix login" })), "Fix login");
  assert.equal(titleOf(run({ databaseId: 1, displayTitle: "PR #167" })), "PR #167", "kept when no PR is known");
});

test("counts: non-zero counts only", () => {
  assert.equal(counts([]), "");
  assert.equal(counts([running(1), running(2), run({ databaseId: 3 })]), "2 running · 1 finished");
});
