import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLabel, clock, cut, elapsed, header, linkOf } from "../hooks/format.ts";
import { run, running, T0 } from "./helpers.ts";

test("elapsed", () => {
  assert.equal(elapsed(-5), "0s");
  assert.equal(elapsed(42_000), "42s");
  assert.equal(elapsed(80_000), "1m 20s");
  assert.equal(elapsed(3_723_000), "1h 2m");
});

test("cut: primeira linha, com reticências", () => {
  assert.equal(cut("abc\ndef", 10), "abc");
  assert.equal(cut("abcdefghij", 5), "abcd…");
});

test("clock: em andamento vs terminado", () => {
  assert.equal(clock(running(1), T0 + 42_000), "42s");
  assert.equal(clock(run({ databaseId: 1 }), T0 + 3 * 60_000), "took 1m 0s · 2m 0s ago");
});

test("branchLabel e linkOf: PR quando dá, run quando não", () => {
  const pr = run({ databaseId: 1, headBranch: "refs/pull/167/head" });
  assert.equal(branchLabel(pr), "#167");
  assert.equal(linkOf("a/b", pr), "https://github.com/a/b/pull/167");
  const push = run({ databaseId: 2 });
  assert.equal(branchLabel(push), "main");
  assert.equal(linkOf("a/b", push), "https://github.com/a/b/actions/runs/1");
});

test("header: só as contagens diferentes de zero", () => {
  assert.equal(header("a/b", []), "⚙ a/b");
  assert.equal(header("a/b", [running(1), running(2), run({ databaseId: 3 })]), "⚙ a/b · 2 running · 1 finished");
});
