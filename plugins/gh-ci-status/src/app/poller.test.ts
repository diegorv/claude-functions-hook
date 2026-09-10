import { test } from "node:test";
import assert from "node:assert/strict";
import { createPoller, DEFAULT_CONFIG, type PollerDeps } from "./poller.ts";
import type { Run } from "../core/runs.ts";
import { run, running, T0 } from "../core/fixtures.ts";

// Fake engine: `after` stores the callback, `tick` moves the clock to it and
// fires it; each listRuns call consumes the next response in the list.
function fakeEngine(responses: (() => Promise<Run[]>)[]) {
  let now = T0;
  let pending: { at: number; callback: () => void } | null = null;
  let responseIndex = 0;
  const toasts: string[] = [];
  const logs: string[] = [];
  let changeCount = 0;

  const deps: PollerDeps = {
    listRuns: () => responses[Math.min(responseIndex++, responses.length - 1)](),
    listPrs: () => Promise.reject(new Error("prs off")), // a failure here must not break the poll
    now: () => now,
    after: (ms, callback) => {
      pending = { at: now + ms, callback };
      return { cancel: () => (pending = null) };
    },
    onChange: () => changeCount++,
    toast: (text) => toasts.push(text),
    log: (text) => logs.push(text),
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    deps,
    toasts,
    logs,
    changeCount: () => changeCount,
    nextDelay: () => (pending ? pending.at - now : null),
    setNow: (epochMs: number) => (now = epochMs),
    settle,
    async tick() {
      const due = pending;
      pending = null;
      if (due) {
        now = Math.max(now, due.at); // the clock never goes backwards
        due.callback();
      }
      await settle();
    },
  };
}

test("the first poll learns without notifying; active pace with a run in flight", async () => {
  const engine = fakeEngine([() => Promise.resolve([running(1)])]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  assert.deepEqual(engine.toasts, []);
  assert.equal(poller.rows().length, 1);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs);
  assert.equal(engine.changeCount(), 1);
});

test("a run that finishes becomes a toast and the pace drops to idle", async () => {
  const engine = fakeEngine([
    () => Promise.resolve([running(1)]),
    () => Promise.resolve([run({ databaseId: 1, updatedAt: new Date(T0 + 90_000).toISOString() })]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  await engine.tick();
  assert.deepEqual(engine.toasts, ["⚙ a/b: CI Success after 1m30s"]);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.idleMs);
  assert.equal(poller.rows().length, 1, "a finished run stays on the band within the hold");
});

test("wake: cancels the timer, enters waiting, and a new run clears the waiting", async () => {
  const engine = fakeEngine([
    () => Promise.resolve([]),
    () => Promise.resolve([]),
    () => Promise.resolve([running(7)]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  assert.equal(poller.waitingSince(), null);
  poller.wake();
  await engine.settle();
  assert.equal(poller.waitingSince(), T0);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs, "waiting keeps the active pace");
  await engine.tick();
  assert.equal(poller.waitingSince(), null, "the run showed up");
  assert.deepEqual(engine.toasts, ["⚙ a/b: CI started (main)"]);
});

test("waiting expires after watchMs and the pace goes back to idle", async () => {
  const engine = fakeEngine([() => Promise.resolve([])]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  poller.wake();
  await engine.settle();
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs);
  engine.setNow(T0 + DEFAULT_CONFIG.watchMs);
  assert.equal(poller.waitingSince(), null);
  await engine.tick();
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.idleMs);
});

test("a gh error is logged once per outage and polling continues", async () => {
  const engine = fakeEngine([
    () => Promise.reject(new Error("boom")),
    () => Promise.reject(new Error("boom")),
    () => Promise.resolve([]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  await engine.tick();
  await engine.tick();
  assert.deepEqual(engine.logs, ["boom"]);
  assert.equal(poller.rows().length, 0);
});
