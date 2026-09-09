import { test } from "node:test";
import assert from "node:assert/strict";
import { inFlight, phase, prNumber, transitions, visible } from "../hooks/runs.ts";
import { run, running, T0 } from "./helpers.ts";

test("inFlight: tudo que não é completed", () => {
  assert.equal(inFlight(running(1)), true);
  assert.equal(inFlight(run({ databaseId: 1, status: "queued" })), true);
  assert.equal(inFlight(run({ databaseId: 1 })), false);
});

test("prNumber: só de refs/pull/N/head", () => {
  assert.equal(prNumber(run({ databaseId: 1, headBranch: "refs/pull/167/head" })), 167);
  assert.equal(prNumber(run({ databaseId: 1, headBranch: "feat/pull/2" })), null);
  assert.equal(prNumber(run({ databaseId: 1 })), null);
});

test("phase: cores por estado", () => {
  assert.deepEqual(phase(running(1)), { dot: "◐", label: "Running", color: "yellow" });
  assert.equal(phase(run({ databaseId: 1, status: "queued" })).label, "Queued");
  assert.equal(phase(run({ databaseId: 1 })).color, "green");
  assert.equal(phase(run({ databaseId: 1, conclusion: "failure" })).label, "Failed");
  assert.equal(phase(run({ databaseId: 1, conclusion: "cancelled" })).dot, "⊘");
  assert.equal(phase(run({ databaseId: 1, conclusion: "skipped" })).dim, true);
});

test("visible: em andamento sempre; terminado só dentro do hold", () => {
  const hold = 5 * 60_000;
  const list = [
    running(1),
    run({ databaseId: 2, updatedAt: new Date(T0 + 4 * 60_000).toISOString() }),
    run({ databaseId: 3, updatedAt: new Date(T0 - 10 * 60_000).toISOString() }),
  ];
  assert.deepEqual(visible(list, T0 + 5 * 60_000, hold).map((r) => r.databaseId), [1, 2]);
});

test("transitions: started, finished, e o novo conjunto", () => {
  const seen = new Set([1, 2]);
  const t = transitions(seen, [run({ databaseId: 1 }), running(2), running(3), run({ databaseId: 9 })]);
  assert.deepEqual(t.started.map((r) => r.databaseId), [3]);
  assert.deepEqual(t.finished.map((r) => r.databaseId), [1]);
  assert.deepEqual([...t.seen], [2, 3]);
  assert.deepEqual([...seen], [1, 2], "não muta o conjunto antigo");
});
