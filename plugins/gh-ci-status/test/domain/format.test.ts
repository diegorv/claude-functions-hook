import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLabel, clock, counts, cut, elapsed, linkOf, titleOf } from "../../src/domain/format.ts";
import { run, running, T0 } from "../helpers.ts";

test("elapsed", () => {
  assert.equal(elapsed(-5), "0m00s");
  assert.equal(elapsed(9_000), "0m09s");
  assert.equal(elapsed(42_000), "0m42s");
  assert.equal(elapsed(189_000), "3m09s");
  assert.equal(elapsed(3_723_000), "1h02m");
});

test("cut: primeira linha, com reticências", () => {
  assert.equal(cut("abc\ndef", 10), "abc");
  assert.equal(cut("abcdefghij", 5), "abcd…");
});

test("clock: em andamento vs terminado", () => {
  assert.equal(clock(running(1), T0 + 42_000), "0m42s");
  assert.equal(clock(run({ databaseId: 1 }), T0 + 3 * 60_000), "1m00s");
});

test("branchLabel e linkOf: PR quando dá, run quando não", () => {
  const pr = run({ databaseId: 1, headBranch: "refs/pull/167/head" });
  assert.equal(branchLabel(pr), "#167");
  assert.equal(linkOf("a/b", pr), "https://github.com/a/b/pull/167");
  const push = run({ databaseId: 2 });
  assert.equal(branchLabel(push), "main");
  assert.equal(linkOf("a/b", push), "https://github.com/a/b/actions/runs/1");
});

test("titleOf: some quando só repete o #N", () => {
  assert.equal(titleOf(run({ databaseId: 1, headBranch: "refs/pull/167/head", displayTitle: "PR #167" })), "");
  assert.equal(titleOf(run({ databaseId: 1, headBranch: "refs/pull/167/head", displayTitle: "#167" })), "");
  assert.equal(
    titleOf(run({ databaseId: 1, headBranch: "refs/pull/167/head", displayTitle: "Fix login" })),
    "Fix login",
  );
  assert.equal(titleOf(run({ databaseId: 1, displayTitle: "PR #167" })), "PR #167", "sem PR conhecido, mantém");
});

test("counts: só as contagens diferentes de zero", () => {
  assert.equal(counts([]), "");
  assert.equal(counts([running(1), running(2), run({ databaseId: 3 })]), "2 running · 1 finished");
});
